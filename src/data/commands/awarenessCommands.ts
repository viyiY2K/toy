import { EVENT_STORE, STORE } from '../dataStore';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import {
  makeEnergyRecord,
  makeEvent,
  makeTask,
  type DayPlan,
  type EnergyRecord,
  type Event,
  type Session,
  type Task,
} from '../schema';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';
import { assertSessionHasNoPendingRecovery } from './recoveryGuard';

type StandaloneEnergySource = 'dayStart' | 'beforeFocus' | 'onReturn';
type SessionEnergySource = 'afterFocus' | 'afterShortBreak' | 'afterLongBreak';

interface EnergyInputBase extends InitializationClock {
  energyLevel: number;
  note?: string | null;
}

export type RecordEnergyInput =
  | (EnergyInputBase & { source: StandaloneEnergySource; sessionId?: never })
  | (EnergyInputBase & { source: SessionEnergySource; sessionId: string });

export interface RecordInterruptInput extends InitializationClock {
  sessionId: string;
  kind: 'internal' | 'external';
  offsetSeconds: number;
  note?: string | null;
}

function isPendingTriageTask(task: Task | undefined): task is Task {
  return task?.status === 'active'
    && task.parentId === null
    && task.metadata.triageStatus === 'pending';
}

function eventFields(clock: InitializationClock, correlationId: string) {
  return { now: clock.now, timezone: clock.timezone, correlationId } as const;
}

const SESSION_TYPE_FOR_ENERGY: Record<SessionEnergySource, Session['type']> = {
  afterFocus: 'focus',
  afterShortBreak: 'shortBreak',
  afterLongBreak: 'longBreak',
};

/** 用户显式提交一次 Phase 1 能量记录；不自动生成、不提供编辑/删除入口。 */
export async function recordEnergy(
  input: RecordEnergyInput,
): Promise<TaskCommandResult<EnergyRecord>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [
        STORE.energyRecords,
        STORE.sessions,
        STORE.tasks,
        STORE.dayPlans,
        EVENT_STORE,
      ],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'EnergyRecord', operation: 'create' },
    },
    async (transaction) => {
      let session: Session | undefined;
      let taskId: string | null = null;
      let dayPlanId: string | null = initialized.dayPlan.id;
      if ('sessionId' in input && input.sessionId !== undefined) {
        session = await transaction.get<Session>(STORE.sessions, input.sessionId);
        const expectedType = SESSION_TYPE_FOR_ENERGY[input.source];
        if (!session || session.type !== expectedType || session.status !== 'completed') {
          throw new Error(`${input.source} 必须关联对应的 completed Session`);
        }
        dayPlanId = session.dayPlanId;
        if (session.type === 'focus') {
          taskId = session.taskId;
        } else if (session.sourceFocusSessionId) {
          const sourceFocus = await transaction.getIncludingDeleted<Session>(
            STORE.sessions,
            session.sourceFocusSessionId,
          );
          taskId = sourceFocus?.taskId ?? null;
        }
      }

      const energyRecord = makeEnergyRecord({
        now: input.now,
        occurredAt: input.now,
        timezone: input.timezone,
        source: input.source,
        energyLevel: input.energyLevel,
        mood: null,
        sessionId: session?.id ?? null,
        note: input.note ?? null,
      });
      await transaction.put(STORE.energyRecords, energyRecord);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'energy.recorded',
          energyRecordId: energyRecord.id,
          sessionId: session?.id ?? null,
          taskId,
          dayPlanId,
          payload: {
            source: input.source,
            energyLevel: input.energyLevel,
            mood: null,
            note: input.note ?? null,
          },
        }),
      );
      return { value: energyRecord, correlationId: transaction.correlationId };
    },
  );
}

/** active focus 内记录一次打扰；Session 本体不存次数或打扰数组。 */
export async function recordInterrupt(
  input: RecordInterruptInput,
): Promise<TaskCommandResult<Event<'interrupt.internal' | 'interrupt.external'>>> {
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
      diagnosticContext: { entityType: 'Event', operation: 'appendEvent' },
    },
    async (transaction) => {
      const session = await transaction.get<Session>(STORE.sessions, input.sessionId);
      if (
        !session ||
        session.type !== 'focus' ||
        session.status !== 'active' ||
        session.taskId === null
      ) {
        throw new Error('打扰只能记录在 active focus Session 中');
      }
      await assertSessionHasNoPendingRecovery(transaction, session.id);
      const common = {
        ...eventFields(input, transaction.correlationId),
        taskId: session.taskId,
        sessionId: session.id,
        dayPlanId: session.dayPlanId,
        payload: { offsetSeconds: input.offsetSeconds, note: input.note ?? null },
      };
      const event =
        input.kind === 'internal'
          ? makeEvent({ ...common, type: 'interrupt.internal' })
          : makeEvent({ ...common, type: 'interrupt.external' });
      await transaction.appendEvent(event);
      return { value: event, correlationId: transaction.correlationId };
    },
  );
}

/** active 标准 focus 中快速捕获一条待分流 Task，原 focus 不变。 */
export async function captureTriageTask(
  input: InitializationClock & { sessionId: string; title: string },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [
        STORE.tasks,
        STORE.sessions,
        STORE.dayPlans,
        STORE.unresolvedIntervals,
        EVENT_STORE,
      ],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', operation: 'create' },
    },
    async (transaction) => {
      const [session, tasks] = await Promise.all([
        transaction.get<Session>(STORE.sessions, input.sessionId),
        transaction.getAll<Task>(STORE.tasks),
      ]);
      if (!session || session.type !== 'focus' || session.status !== 'active') {
        throw new Error('待分流事项只能在 active focus Session 中捕获');
      }
      await assertSessionHasNoPendingRecovery(transaction, session.id);
      const sortIndex = tasks
        .filter(
          (task) =>
            task.parentId === null
            && task.status === 'active'
            && task.metadata.triageStatus === 'pending',
        )
        .reduce((maximum, task) => Math.max(maximum, task.sortIndex), 0) + 1000;
      const task = makeTask({
        now: input.now,
        title: input.title,
        estimatedPomodoros: 1,
        sortIndex,
        metadata: { source: 'triageCapture', triageStatus: 'pending' },
      });
      await transaction.put(STORE.tasks, task);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.created',
          taskId: task.id,
          payload: {
            title: task.title,
            parentId: null,
            estimatedPomodoros: 1,
            source: 'triageCapture',
          },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'triage.captured',
          taskId: task.id,
          sessionId: session.id,
          dayPlanId: session.dayPlanId,
          payload: { title: task.title },
        }),
      );
      return { value: task, correlationId: transaction.correlationId };
    },
  );
}

export async function moveTriageTaskToList(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const [task, tasks] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.taskId),
        transaction.getAll<Task>(STORE.tasks),
      ]);
      if (!isPendingTriageTask(task)) throw new Error('只有 pending triage Task 可以移入活动清单');
      const sortIndex = tasks
        .filter(
          (candidate) =>
            candidate.parentId === null
            && (candidate.status === 'active' || candidate.status === 'splitNeeded')
            && candidate.metadata.triageStatus !== 'pending',
        )
        .reduce((maximum, candidate) => Math.max(maximum, candidate.sortIndex), 0) + 1000;
      const updated: Task = {
        ...task,
        sortIndex,
        metadata: { ...task.metadata, triageStatus: null },
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'triage.movedToList',
          taskId: task.id,
          payload: {},
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function moveTriageTaskToToday(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<{ task: Task; dayPlan: DayPlan }>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const [task, dayPlan] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.taskId),
        transaction.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
      ]);
      if (!isPendingTriageTask(task)) throw new Error('只有 pending triage Task 可以移入今日');
      if (!dayPlan) throw new Error('当前 appDate DayPlan 不存在');
      if (dayPlan.taskIds.includes(task.id)) throw new Error('pending triage Task 不得已在今日');
      const addedAtIndex = dayPlan.taskIds.length;
      const updatedTask: Task = {
        ...task,
        metadata: { ...task.metadata, triageStatus: null },
        updatedAt: input.now,
      };
      const updatedDayPlan: DayPlan = {
        ...dayPlan,
        taskIds: [...dayPlan.taskIds, task.id],
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, updatedTask);
      await transaction.put(STORE.dayPlans, updatedDayPlan);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'triage.movedToToday',
          taskId: task.id,
          dayPlanId: dayPlan.id,
          payload: { addedAtIndex },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.taskAdded',
          taskId: task.id,
          dayPlanId: dayPlan.id,
          payload: { addedAtIndex, source: 'button' },
        }),
      );
      return {
        value: { task: updatedTask, dayPlan: updatedDayPlan },
        correlationId: transaction.correlationId,
      };
    },
  );
}

export async function dismissTriageTask(
  input: InitializationClock & { taskId: string; dismissReason?: string | null },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'softDelete' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!isPendingTriageTask(task)) throw new Error('只有 pending triage Task 可以 dismiss');
      const deleted = await transaction.softDelete(STORE.tasks, task.id, input.now, {
        deletedReason: 'triageDismissed',
      });
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'triage.dismissed',
          taskId: task.id,
          payload: { dismissReason: input.dismissReason ?? null },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.deleted',
          taskId: task.id,
          payload: { deletedReason: 'triageDismissed' },
        }),
      );
      return { value: deleted, correlationId: transaction.correlationId };
    },
  );
}
