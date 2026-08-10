import { EVENT_STORE, STORE } from '../dataStore';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import {
  makeEvent,
  makeSession,
  type DayPlan,
  type Event,
  type MergeGroup,
  type Session,
  type Settings,
  type Task,
  type TaskSegment,
} from '../schema';
import { computeTaskSegments } from './mergeSegments';
import { currentMergeMemberId } from './mergeMemberLock';
import { deriveLocalDate } from '../time';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';
import { assertSessionHasNoPendingRecovery } from './recoveryGuard';

export type StandardBreakType = 'shortBreak' | 'longBreak';

function eventFields(clock: InitializationClock, correlationId: string) {
  return { now: clock.now, timezone: clock.timezone, correlationId } as const;
}

/**
 * 终结一条合并 focus 时该写的成员分段（§3.3 关键规则 13）。
 * 非合并 Session 恒为空数组——单任务专注的任务耗时就是 actualDuration 本身。
 *
 * 成员被勾完成的时刻取自本轮的 `task.completed` 事件（append-only 的事实记录），
 * 不读 Task.completedAt：后者会被"取消完成再重新完成"改写，不是本轮的历史事实。
 */
async function segmentsForTermination(
  transaction: { getAll<T>(store: string): Promise<T[]> },
  session: Session,
  endedAt: string,
  actualDuration: number,
): Promise<TaskSegment[]> {
  if (session.mergeGroupId === null) return [];
  const events = await transaction.getAll<Event>(EVENT_STORE);
  const completedAt = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'task.completed') continue;
    if (event.sessionId !== session.id || event.taskId === null) continue;
    const existing = completedAt.get(event.taskId);
    if (existing === undefined || Date.parse(event.occurredAt) < Date.parse(existing)) {
      completedAt.set(event.taskId, event.occurredAt);
    }
  }
  return computeTaskSegments({
    taskIds: session.taskIds,
    startedAt: session.startedAt,
    endedAt,
    actualDuration,
    completedAt,
  });
}

function assertNoActiveSession(sessions: readonly Session[]): void {
  if (sessions.some((session) => session.status === 'active')) {
    throw new Error('已有进行中的标准 Session');
  }
}

function workEndedFocusIds(events: readonly Event[]): Set<string> {
  return new Set(
    events.flatMap((event) =>
      event.type === 'dayPlan.workEnded' && event.payload.endedAfterFocusSessionId !== null
        ? [event.payload.endedAfterFocusSessionId]
        : [],
    ),
  );
}

function assertNoOpenBreakOpportunity(
  sessions: readonly Session[],
  events: readonly Event[],
): void {
  const breakSources = new Set(
    sessions
      .filter((session) => session.type === 'shortBreak' || session.type === 'longBreak')
      .map((session) => session.sourceFocusSessionId),
  );
  const workEndedSources = workEndedFocusIds(events);
  if (
    sessions.some(
      (session) =>
        session.type === 'focus' &&
        session.status === 'completed' &&
        !breakSources.has(session.id) &&
        !workEndedSources.has(session.id),
    )
  ) {
    throw new Error('上一个 completed focus 的标准 break 机会尚未创建');
  }
}

function completedFocusOrdinal(sessions: readonly Session[], sourceFocusSessionId: string): number {
  const completed = sessions
    .filter(
      (session): session is Session & { endedAt: string } =>
        session.type === 'focus' && session.status === 'completed' && session.endedAt !== null,
    )
    .sort(
      (left, right) =>
        Date.parse(left.endedAt) - Date.parse(right.endedAt) || left.id.localeCompare(right.id),
    );
  const index = completed.findIndex((session) => session.id === sourceFocusSessionId);
  if (index < 0) throw new Error('sourceFocusSessionId 不在 completed focus 序列中');
  return index + 1;
}

export async function startFocus(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<Session>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.sessions, STORE.settings, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', operation: 'create' },
    },
    async (transaction) => {
      const [task, settings, dayPlan, sessions, historicalSessions, events] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.taskId),
        transaction.get<Settings>(STORE.settings, initialized.settings.id),
        transaction.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
        transaction.getAll<Session>(STORE.sessions),
        transaction.getAllIncludingDeleted<Session>(STORE.sessions),
        transaction.getAll<Event>(EVENT_STORE),
      ]);
      if (!task || task.status !== 'active') throw new Error('只有 active Task 可以开始标准 focus');
      if (!settings || !dayPlan) throw new Error('当前 Settings/DayPlan 不可用');
      assertNoActiveSession(sessions);
      assertNoOpenBreakOpportunity(historicalSessions, events);
      const pomodoroIndex =
        historicalSessions
          .filter((session) => session.type === 'focus' && session.taskIds.includes(task.id))
          .reduce((maximum, session) => Math.max(maximum, session.pomodoroIndex ?? 0), 0) + 1;
      const session = makeSession({
        now: input.now,
        startedAt: input.now,
        timezone: input.timezone,
        type: 'focus',
        taskIds: [task.id],
        plannedDuration: settings.focusMinutes * 60,
        pomodoroIndex,
        dayPlanId: dayPlan.id,
      });
      await transaction.put(STORE.sessions, session);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'focus.started',
          taskId: task.id,
          sessionId: session.id,
          dayPlanId: dayPlan.id,
          payload: {
            pomodoroIndex,
            plannedDuration: session.plannedDuration!,
            taskEstimateAtStart: task.estimatedPomodoros,
          },
        }),
      );
      return { value: session, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 从合并卡片启动一轮合并专注（v4.1 §3.3 关键规则 5/11、§3.8 关键规则 4/6）。
 *
 * 与单任务 `startFocus` 的三点差别：
 * 1. `taskIds` 是**快照**：取组内此刻尚未完成的成员——已经在更早一轮里完成过的成员
 *    早就通过那一轮记过有效番茄，不再重复计（§3.3 关键规则 11）。本轮中途才完成的
 *    成员仍留在快照里，照样拿这一轮的 credit。
 * 2. `pomodoroIndex` 记的是**这个组的第几轮**，不是各成员各自的序号——合并组一旦成立
 *    就被当作与标准任务同级别的一个整体来编号（§3.3 关键规则 5）。
 * 3. `focus.started` 按快照里每个成员各发一条，共享 sessionId / mergeGroupId /
 *    correlationId，`taskEstimateAtStart` 各自取自己的预估（§7.5）。
 *
 * `status='limitReached'` 的组不允许开启新一轮（§3.8 字段一致性约束 7），必须先移出
 * 剩余未完成成员或整体解散。
 */
export async function startMergeGroupFocus(
  input: InitializationClock & { mergeGroupId: string },
): Promise<TaskCommandResult<Session>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [
        STORE.tasks,
        STORE.sessions,
        STORE.settings,
        STORE.dayPlans,
        STORE.mergeGroups,
        EVENT_STORE,
      ],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', operation: 'create' },
    },
    async (transaction) => {
      const [group, settings, dayPlan, sessions, historicalSessions, events] = await Promise.all([
        transaction.get<MergeGroup>(STORE.mergeGroups, input.mergeGroupId),
        transaction.get<Settings>(STORE.settings, initialized.settings.id),
        transaction.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
        transaction.getAll<Session>(STORE.sessions),
        transaction.getAllIncludingDeleted<Session>(STORE.sessions),
        transaction.getAll<Event>(EVENT_STORE),
      ]);
      if (!group) throw new Error('合并组不存在');
      // 红线 28：completed 与 dissolved 都是终态，但语义不同，报错文案也要分开。
      if (group.status === 'completed') throw new Error('合并组已完成，不能再开启新一轮');
      if (group.status === 'dissolved') throw new Error('合并组已解散');
      if (group.status === 'limitReached') {
        throw new Error('合并组已达上限，必须先移出剩余成员或整体解散');
      }
      if (!settings || !dayPlan) throw new Error('当前 Settings/DayPlan 不可用');
      assertNoActiveSession(sessions);
      assertNoOpenBreakOpportunity(historicalSessions, events);

      const members: Task[] = [];
      for (const taskId of group.taskIds) {
        const task = await transaction.get<Task>(STORE.tasks, taskId);
        if (task && task.status === 'active') members.push(task);
      }
      /*
       * 开新一轮要求 ≥ 2 个未完成成员。用户已明确拍板本条为通用规则，并据此**推翻**了
       * 早先"续轮排除已完成成员后只剩 1 个也照开"的决定（commit 5559660）：只剩一件
       * 事要做时，它就该作为独立任务自己跑一个完整番茄，而不是继续挂在合并组里。
       * 成员数量不足只阻止下一轮开始，不打断正在进行的 Session。
       */
      if (members.length < 2) {
        throw new Error('合并组未完成的成员不足 2 个，无法开启新一轮');
      }

      const pomodoroIndex =
        historicalSessions
          .filter((session) => session.mergeGroupId === group.id)
          .reduce((maximum, session) => Math.max(maximum, session.pomodoroIndex ?? 0), 0) + 1;
      const session = makeSession({
        now: input.now,
        startedAt: input.now,
        timezone: input.timezone,
        type: 'focus',
        taskIds: members.map((task) => task.id),
        mergeGroupId: group.id,
        plannedDuration: settings.focusMinutes * 60,
        pomodoroIndex,
        dayPlanId: dayPlan.id,
      });
      await transaction.put(STORE.sessions, session);
      for (const task of members) {
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'focus.started',
            taskId: task.id,
            sessionId: session.id,
            dayPlanId: dayPlan.id,
            mergeGroupId: group.id,
            payload: {
              pomodoroIndex,
              plannedDuration: session.plannedDuration!,
              taskEstimateAtStart: task.estimatedPomodoros,
            },
          }),
        );
      }
      return { value: session, correlationId: transaction.correlationId };
    },
  );
}

export async function completeFocus(
  input: InitializationClock & { sessionId: string; actualDuration: number },
): Promise<TaskCommandResult<Session>> {
  return executeAtomicWrite(
    {
      storeNames: [
        STORE.sessions,
        STORE.tasks,
        STORE.dayPlans,
        STORE.unresolvedIntervals,
        EVENT_STORE,
      ],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', entityId: input.sessionId, operation: 'update' },
    },
    async (transaction) => {
      const session = await transaction.get<Session>(STORE.sessions, input.sessionId);
      if (!session || session.type !== 'focus' || session.status !== 'active') {
        throw new Error('只有 active focus 可以完成');
      }
      await assertSessionHasNoPendingRecovery(transaction, session.id);
      const completed: Session = {
        ...session,
        status: 'completed',
        endedAt: input.now,
        actualDuration: input.actualDuration,
        taskSegments: await segmentsForTermination(
          transaction,
          session,
          input.now,
          input.actualDuration,
        ),
        updatedAt: input.now,
      };
      await transaction.put(STORE.sessions, completed);
      // §7.5：合并 focus 按 taskIds 每个成员各发一条，共享 sessionId / mergeGroupId / correlationId。
      for (const taskId of session.taskIds) {
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'focus.completed',
            taskId,
            sessionId: session.id,
            dayPlanId: session.dayPlanId,
            mergeGroupId: session.mergeGroupId,
            payload: {
              pomodoroIndex: session.pomodoroIndex!,
              plannedDuration: session.plannedDuration!,
              actualDuration: input.actualDuration,
            },
          }),
        );
      }
      return { value: completed, correlationId: transaction.correlationId };
    },
  );
}

export async function discardFocus(
  input: InitializationClock & { sessionId: string; actualDuration: number },
): Promise<TaskCommandResult<Session>> {
  return executeAtomicWrite(
    {
      storeNames: [
        STORE.sessions,
        STORE.tasks,
        STORE.dayPlans,
        STORE.unresolvedIntervals,
        EVENT_STORE,
      ],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', entityId: input.sessionId, operation: 'update' },
    },
    async (transaction) => {
      const session = await transaction.get<Session>(STORE.sessions, input.sessionId);
      if (!session || session.type !== 'focus' || session.status !== 'active') {
        throw new Error('只有 active focus 可以作废');
      }
      await assertSessionHasNoPendingRecovery(transaction, session.id);
      /*
       * 作废的合并 focus 一样写分段（§3.3 关键规则 13 末段）：用户确实投入了这段时间，
       * 当前成员的分段止于作废时刻，尚未轮到的成员记 0、不分等待时间。这些耗时按
       * §8.3.5 计入各成员的作废专注时长，但不计入任何有效番茄。
       */
      const discarded: Session = {
        ...session,
        status: 'discarded',
        endedAt: input.now,
        actualDuration: input.actualDuration,
        taskSegments: await segmentsForTermination(
          transaction,
          session,
          input.now,
          input.actualDuration,
        ),
        updatedAt: input.now,
      };
      await transaction.put(STORE.sessions, discarded);
      for (const taskId of session.taskIds) {
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'focus.discarded',
            taskId,
            sessionId: session.id,
            dayPlanId: session.dayPlanId,
            mergeGroupId: session.mergeGroupId,
            payload: {
              pomodoroIndex: session.pomodoroIndex!,
              actualDuration: input.actualDuration,
              reason: 'userInitiated',
              triggeredByInterruptEventId: null,
            },
          }),
        );
      }
      return { value: discarded, correlationId: transaction.correlationId };
    },
  );
}

export async function startBreak(
  input: InitializationClock & { sourceFocusSessionId: string; suggestedRest?: string | null },
): Promise<TaskCommandResult<Session>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.sessions, STORE.settings, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', operation: 'create' },
    },
    async (transaction) => {
      const [sourceFocus, settings, dayPlan, sessions, historicalSessions, events] = await Promise.all([
        transaction.get<Session>(STORE.sessions, input.sourceFocusSessionId),
        transaction.get<Settings>(STORE.settings, initialized.settings.id),
        transaction.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
        transaction.getAll<Session>(STORE.sessions),
        transaction.getAllIncludingDeleted<Session>(STORE.sessions),
        transaction.getAll<Event>(EVENT_STORE),
      ]);
      if (!sourceFocus || sourceFocus.type !== 'focus' || sourceFocus.status !== 'completed') {
        throw new Error('标准 break 必须关联 completed focus');
      }
      if (!settings || !dayPlan) throw new Error('当前 Settings/DayPlan 不可用');
      assertNoActiveSession(sessions);
      if (
        historicalSessions.some(
          (session) =>
            (session.type === 'shortBreak' || session.type === 'longBreak') &&
            session.sourceFocusSessionId === sourceFocus.id,
        )
      ) {
        throw new Error('该 focus 的标准 break 机会已经创建');
      }
      if (workEndedFocusIds(events).has(sourceFocus.id)) {
        throw new Error('该 focus 的标准 break 机会已由收工豁免');
      }
      const focusOrdinal = completedFocusOrdinal(sessions, sourceFocus.id);
      const type: StandardBreakType =
        focusOrdinal % settings.longBreakEvery === 0 ? 'longBreak' : 'shortBreak';
      const plannedDuration =
        (type === 'longBreak' ? settings.longBreakMinutes : settings.shortBreakMinutes) * 60;
      const session = makeSession({
        now: input.now,
        startedAt: input.now,
        timezone: input.timezone,
        type,
        plannedDuration,
        sourceFocusSessionId: sourceFocus.id,
        suggestedRest: input.suggestedRest ?? null,
        dayPlanId: dayPlan.id,
      });
      await transaction.put(STORE.sessions, session);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'break.started',
          sessionId: session.id,
          dayPlanId: dayPlan.id,
          payload: { breakType: type, plannedDuration, sourceFocusSessionId: sourceFocus.id },
        }),
      );
      return { value: session, correlationId: transaction.correlationId };
    },
  );
}

export async function skipPendingBreak(
  input: InitializationClock & { sourceFocusSessionId: string },
): Promise<TaskCommandResult<Session>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.sessions, STORE.settings, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', operation: 'create' },
    },
    async (transaction) => {
      const [sourceFocus, settings, dayPlan, sessions, historicalSessions, events] =
        await Promise.all([
          transaction.get<Session>(STORE.sessions, input.sourceFocusSessionId),
          transaction.get<Settings>(STORE.settings, initialized.settings.id),
          transaction.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
          transaction.getAll<Session>(STORE.sessions),
          transaction.getAllIncludingDeleted<Session>(STORE.sessions),
          transaction.getAll<Event>(EVENT_STORE),
        ]);
      if (!sourceFocus || sourceFocus.type !== 'focus' || sourceFocus.status !== 'completed') {
        throw new Error('只有 completed focus 的待开始标准 break 可以跳过');
      }
      if (!settings || !dayPlan) throw new Error('当前 Settings/DayPlan 不可用');
      assertNoActiveSession(sessions);
      if (
        historicalSessions.some(
          (session) =>
            (session.type === 'shortBreak' || session.type === 'longBreak') &&
            session.sourceFocusSessionId === sourceFocus.id,
        ) || workEndedFocusIds(events).has(sourceFocus.id)
      ) {
        throw new Error('该 focus 的标准 break 机会已经关闭');
      }

      const focusOrdinal = completedFocusOrdinal(sessions, sourceFocus.id);
      const type: StandardBreakType =
        focusOrdinal % settings.longBreakEvery === 0 ? 'longBreak' : 'shortBreak';
      const plannedDuration =
        (type === 'longBreak' ? settings.longBreakMinutes : settings.shortBreakMinutes) * 60;
      const skipped = makeSession({
        now: input.now,
        startedAt: input.now,
        timezone: input.timezone,
        type,
        status: 'skipped',
        endedAt: input.now,
        plannedDuration,
        actualDuration: 0,
        skipKind: 'explicitSkip',
        sourceFocusSessionId: sourceFocus.id,
        dayPlanId: dayPlan.id,
      });
      await transaction.put(STORE.sessions, skipped);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'break.skipped',
          sessionId: skipped.id,
          dayPlanId: dayPlan.id,
          payload: { breakType: type, skipKind: 'explicitSkip', plannedDuration },
        }),
      );
      return { value: skipped, correlationId: transaction.correlationId };
    },
  );
}

export async function skipActiveBreak(
  input: InitializationClock & { sessionId: string },
): Promise<TaskCommandResult<Session>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.sessions, STORE.dayPlans, STORE.unresolvedIntervals, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', entityId: input.sessionId, operation: 'update' },
    },
    async (transaction) => {
      const session = await transaction.get<Session>(STORE.sessions, input.sessionId);
      if (
        !session ||
        (session.type !== 'shortBreak' && session.type !== 'longBreak') ||
        session.status !== 'active'
      ) {
        throw new Error('只有同一运行期的 active shortBreak/longBreak 可以主动跳过');
      }
      await assertSessionHasNoPendingRecovery(transaction, session.id);
      const skipped: Session = {
        ...session,
        status: 'skipped',
        endedAt: input.now,
        actualDuration: 0,
        skipKind: 'explicitSkip',
        updatedAt: input.now,
      };
      await transaction.put(STORE.sessions, skipped);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'break.skipped',
          sessionId: session.id,
          dayPlanId: session.dayPlanId,
          payload: {
            breakType: session.type,
            skipKind: 'explicitSkip',
            plannedDuration: session.plannedDuration!,
          },
        }),
      );
      return { value: skipped, correlationId: transaction.correlationId };
    },
  );
}

export async function endWorkAfterFocus(
  input: InitializationClock & { sourceFocusSessionId: string },
): Promise<TaskCommandResult<Event<'dayPlan.workEnded'>>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.sessions, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'DayPlan', entityId: initialized.dayPlan.id, operation: 'update' },
    },
    async (transaction) => {
      const [sourceFocus, dayPlan, sessions, historicalSessions, events] = await Promise.all([
        transaction.get<Session>(STORE.sessions, input.sourceFocusSessionId),
        transaction.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
        transaction.getAll<Session>(STORE.sessions),
        transaction.getAllIncludingDeleted<Session>(STORE.sessions),
        transaction.getAll<Event>(EVENT_STORE),
      ]);
      if (!sourceFocus || sourceFocus.type !== 'focus' || sourceFocus.status !== 'completed') {
        throw new Error('只有 completed focus 后可以明确结束今天工作');
      }
      if (!dayPlan) throw new Error('当前 DayPlan 不可用');
      assertNoActiveSession(sessions);
      if (
        historicalSessions.some(
          (session) =>
            (session.type === 'shortBreak' || session.type === 'longBreak') &&
            session.sourceFocusSessionId === sourceFocus.id,
        ) || workEndedFocusIds(events).has(sourceFocus.id)
      ) {
        throw new Error('该 focus 的标准 break 机会已经关闭');
      }

      const workEnded = makeEvent({
        ...eventFields(input, transaction.correlationId),
        type: 'dayPlan.workEnded',
        taskId: sourceFocus.taskIds[0] ?? null,
        sessionId: sourceFocus.id,
        dayPlanId: dayPlan.id,
        payload: {
          appDate: initialized.appDate,
          localDate: deriveLocalDate(input.now, input.timezone),
          endedAfterFocusSessionId: sourceFocus.id,
          reason: 'userEndedWork',
        },
      });
      await transaction.appendEvent(workEnded);
      return { value: workEnded, correlationId: transaction.correlationId };
    },
  );
}

export async function completeBreak(
  input: InitializationClock & {
    sessionId: string;
    actualDuration: number;
    actualRest: string | null;
  },
): Promise<TaskCommandResult<Session>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.sessions, STORE.dayPlans, STORE.unresolvedIntervals, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Session', entityId: input.sessionId, operation: 'update' },
    },
    async (transaction) => {
      const session = await transaction.get<Session>(STORE.sessions, input.sessionId);
      if (
        !session ||
        (session.type !== 'shortBreak' && session.type !== 'longBreak') ||
        session.status !== 'active'
      ) {
        throw new Error('只有 active shortBreak/longBreak 可以完成');
      }
      await assertSessionHasNoPendingRecovery(transaction, session.id);
      const completed: Session = {
        ...session,
        status: 'completed',
        endedAt: input.now,
        actualDuration: input.actualDuration,
        actualRest: input.actualRest,
        updatedAt: input.now,
      };
      await transaction.put(STORE.sessions, completed);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'break.completed',
          sessionId: session.id,
          dayPlanId: session.dayPlanId,
          payload: {
            breakType: session.type,
            plannedDuration: session.plannedDuration!,
            actualDuration: input.actualDuration,
            actualRest: input.actualRest,
          },
        }),
      );
      return { value: completed, correlationId: transaction.correlationId };
    },
  );
}

export async function completeTaskFromPomodoro(
  input: InitializationClock & { sessionId: string; taskId?: string },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.sessions, STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', operation: 'update' },
    },
    async (transaction) => {
      const session = await transaction.get<Session>(STORE.sessions, input.sessionId);
      /*
       * 两个入口共用本命令：
       * 1. 到点后的收尾确认（status='completed'）——单任务与合并都走这里；
       * 2. 合并专注**进行中**逐个勾选成员完成（status='active' 且 mergeGroupId 非 null）。
       *    第 2 条是 §3.8 关键规则 11 要求的入口：没有它，时间就无法按成员切分。
       * 进行中的单任务 focus 不在此列——独立任务提前做完要先作废当前番茄再走完成流程
       * （§3.3 关键规则 14），不允许一边保持 active 一边把任务改成 completed。
       */
      const midMergeRound =
        session?.status === 'active' && session.mergeGroupId !== null;
      if (
        !session ||
        session.type !== 'focus' ||
        (session.status !== 'completed' && !midMergeRound) ||
        session.taskIds.length === 0
      ) {
        throw new Error('番茄完成确认必须关联 completed focus，或进行中的合并 focus');
      }
      /*
       * 合并 focus 一次涉及多个任务，必须由调用方点名确认的是哪一个；
       * 单任务 focus 只有一个成员，允许省略以保持既有调用方不变。
       */
      const targetTaskId = input.taskId ?? (session.taskIds.length === 1 ? session.taskIds[0]! : null);
      if (targetTaskId === null) {
        throw new Error('合并 focus 完成确认必须指明 taskId');
      }
      if (!session.taskIds.includes(targetTaskId)) {
        throw new Error('taskId 不在本次 focus 的关联任务中');
      }
      const task = await transaction.get<Task>(STORE.tasks, targetTaskId);
      if (!task || (task.status !== 'active' && task.status !== 'splitNeeded')) {
        throw new Error('只有未完成的有效 Task 可以确认番茄完成');
      }
      /*
       * 进行中的合并轮只允许勾**当前成员**：分段模型是严格顺序的（§3.3 关键规则 13），
       * 跳过当前成员去勾后面的未来成员，时间就没法切了。当前成员 = 本轮参与成员里第一个
       * 还没完成的那个——注意不能用字面 taskIds[0]，已完成的成员仍留在快照里。
       */
      if (midMergeRound) {
        const current = await currentMergeMemberId(transaction, session);
        if (current !== targetTaskId) {
          throw new Error('合并专注进行中只能勾选当前正在执行的成员');
        }
      }
      /*
       * §8.5.1 + 红线 24/26：合并 focus 不给任何成员记有效番茄，因此这里只数
       * **非合并**的 completed focus。合并组成员因合并资格要求（§3.8 关键规则 9，
       * 参与合并前不得有过任何 focus 记录）天然为 0——这不是给合并场景开的特例分支，
       * 而是同一个定义算出来的结果。
       */
      const sessions = await transaction.getAll<Session>(STORE.sessions);
      const validFocusCountAtCompletion = sessions.filter(
        (candidate) =>
          candidate.type === 'focus' &&
          candidate.status === 'completed' &&
          candidate.mergeGroupId === null &&
          candidate.taskIds.includes(task.id),
      ).length;
      const completed: Task = {
        ...task,
        status: 'completed',
        completedAt: input.now,
        completionSource: 'pomodoro',
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, completed);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.completed',
          taskId: task.id,
          sessionId: session.id,
          payload: {
            completionSource: 'pomodoro',
            completedAt: input.now,
            validFocusCountAtCompletion,
          },
        }),
      );
      return { value: completed, correlationId: transaction.correlationId };
    },
  );
}
