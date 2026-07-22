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
  type Session,
  type Settings,
  type Task,
} from '../schema';
import { deriveLocalDate } from '../time';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';
import { assertSessionHasNoPendingRecovery } from './recoveryGuard';

export type StandardBreakType = 'shortBreak' | 'longBreak';

function eventFields(clock: InitializationClock, correlationId: string) {
  return { now: clock.now, timezone: clock.timezone, correlationId } as const;
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
          .filter((session) => session.type === 'focus' && session.taskId === task.id)
          .reduce((maximum, session) => Math.max(maximum, session.pomodoroIndex ?? 0), 0) + 1;
      const session = makeSession({
        now: input.now,
        startedAt: input.now,
        timezone: input.timezone,
        type: 'focus',
        taskId: task.id,
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
        updatedAt: input.now,
      };
      await transaction.put(STORE.sessions, completed);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'focus.completed',
          taskId: session.taskId!,
          sessionId: session.id,
          dayPlanId: session.dayPlanId,
          payload: {
            pomodoroIndex: session.pomodoroIndex!,
            plannedDuration: session.plannedDuration!,
            actualDuration: input.actualDuration,
          },
        }),
      );
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
      const discarded: Session = {
        ...session,
        status: 'discarded',
        endedAt: input.now,
        actualDuration: input.actualDuration,
        updatedAt: input.now,
      };
      await transaction.put(STORE.sessions, discarded);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'focus.discarded',
          taskId: session.taskId!,
          sessionId: session.id,
          dayPlanId: session.dayPlanId,
          payload: {
            pomodoroIndex: session.pomodoroIndex!,
            actualDuration: input.actualDuration,
            reason: 'userInitiated',
            triggeredByInterruptEventId: null,
          },
        }),
      );
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
        taskId: sourceFocus.taskId,
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
  input: InitializationClock & { sessionId: string },
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
      if (
        !session ||
        session.type !== 'focus' ||
        session.status !== 'completed' ||
        session.taskId === null
      ) {
        throw new Error('番茄完成确认必须关联 completed focus');
      }
      const task = await transaction.get<Task>(STORE.tasks, session.taskId);
      if (!task || (task.status !== 'active' && task.status !== 'splitNeeded')) {
        throw new Error('只有未完成的有效 Task 可以确认番茄完成');
      }
      const sessions = await transaction.getAll<Session>(STORE.sessions);
      const validFocusCountAtCompletion = sessions.filter(
        (candidate) =>
          candidate.type === 'focus' &&
          candidate.status === 'completed' &&
          candidate.taskId === task.id,
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
