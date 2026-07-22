import { EVENT_STORE, STORE } from '../dataStore';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import { makeEvent, makeTask, type DayPlan, type Session, type Task } from '../schema';
import {
  executeAtomicWrite,
  type ValidatedAtomicWriteTransaction,
} from '../writes/executeAtomicWrite';

export interface TaskCommandResult<T> {
  value: T;
  correlationId: string;
}

export interface CreateManualTaskInput extends InitializationClock {
  title: string;
  estimatedPomodoros?: number;
  destination: 'list' | 'today';
}

export interface MoveTaskToTodayInput extends InitializationClock {
  taskId: string;
  source: 'drag' | 'button';
  addedAtIndex?: number;
}

export interface CreateSubtaskInput extends InitializationClock {
  parentId: string;
  title: string;
  estimatedPomodoros?: number;
}

export interface SplitTaskInput extends InitializationClock {
  taskId: string;
  newTitle: string;
  estimatedPomodoros: number;
}

const CURRENT_TASK_STATUSES = new Set<Task['status']>(['active', 'splitNeeded', 'completed']);

function isActiveTask(task: Task): boolean {
  return task.status === 'active' || task.status === 'splitNeeded';
}

function compareTaskSortIndex(left: Task, right: Task): number {
  return left.sortIndex - right.sortIndex || left.id.localeCompare(right.id);
}

function currentChildren(tasks: readonly Task[], parentId: string): Task[] {
  return tasks
    .filter((task) => task.parentId === parentId && CURRENT_TASK_STATUSES.has(task.status))
    .sort(compareTaskSortIndex);
}

function assertIndex(index: number, upperInclusive: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index > upperInclusive) {
    throw new Error(`${label} 必须是 0–${upperInclusive} 的整数`);
  }
}

async function currentDayPlan(
  transaction: ValidatedAtomicWriteTransaction,
  dayPlanId: string,
): Promise<DayPlan> {
  const dayPlan = await transaction.get<DayPlan>(STORE.dayPlans, dayPlanId);
  if (!dayPlan) throw new Error('当前 appDate DayPlan 不存在');
  return dayPlan;
}

function eventFields(
  clock: InitializationClock,
  correlationId: string,
): Pick<Parameters<typeof makeEvent>[0], 'now' | 'timezone' | 'correlationId'> {
  return { now: clock.now, timezone: clock.timezone, correlationId };
}

/** 手动创建活动任务或今日任务；今日创建不冒充已有任务 movedToToday。 */
export async function createManualTask(
  input: CreateManualTaskInput,
): Promise<TaskCommandResult<Task>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', operation: 'create' },
    },
    async (transaction) => {
      const tasks = await transaction.getAll<Task>(STORE.tasks);
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      const todayIds = new Set(dayPlan.taskIds);
      const sortIndex =
        tasks
          .filter(
            (task) =>
              task.parentId === null &&
              (task.status === 'active' || task.status === 'splitNeeded') &&
              !todayIds.has(task.id) &&
              task.metadata.triageStatus !== 'pending',
          )
          .reduce((maximum, task) => Math.max(maximum, task.sortIndex), 0) + 1000;
      const task = makeTask({
        now: input.now,
        title: input.title,
        estimatedPomodoros: input.estimatedPomodoros ?? 1,
        sortIndex,
        metadata: { source: 'manual' },
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
            estimatedPomodoros: task.estimatedPomodoros,
            source: 'manual',
          },
        }),
      );

      if (input.destination === 'today') {
        const addedAtIndex = dayPlan.taskIds.length;
        const updatedDayPlan = {
          ...dayPlan,
          updatedAt: input.now,
          taskIds: [...dayPlan.taskIds, task.id],
        };
        await transaction.put(STORE.dayPlans, updatedDayPlan);
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'dayPlan.taskAdded',
            taskId: task.id,
            dayPlanId: dayPlan.id,
            payload: { addedAtIndex, source: 'button' },
          }),
        );
      }
      return { value: task, correlationId: transaction.correlationId };
    },
  );
}

/** 新建普通子任务；Task 与 task.created/subtask.added 在同一事务。 */
export async function createSubtask(
  input: CreateSubtaskInput,
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', operation: 'create' },
    },
    async (transaction) => {
      const [parent, tasks] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.parentId),
        transaction.getAll<Task>(STORE.tasks),
      ]);
      if (!parent || parent.parentId !== null || !isActiveTask(parent)) {
        throw new Error('子任务只能加入有效的 active/splitNeeded 顶层 Task');
      }
      const siblings = currentChildren(tasks, parent.id);
      const sortIndex = siblings.reduce(
        (maximum, task) => Math.max(maximum, task.sortIndex),
        0,
      ) + 1000;
      const task = makeTask({
        now: input.now,
        title: input.title,
        parentId: parent.id,
        estimatedPomodoros: input.estimatedPomodoros ?? 1,
        sortIndex,
        metadata: { source: 'manual' },
      });
      await transaction.put(STORE.tasks, task);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.created',
          taskId: task.id,
          payload: {
            title: task.title,
            parentId: parent.id,
            estimatedPomodoros: task.estimatedPomodoros,
            source: 'manual',
          },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'subtask.added',
          taskId: task.id,
          payload: {
            parentId: parent.id,
            title: task.title,
            estimatedPomodoros: task.estimatedPomodoros,
            source: 'listPage',
          },
        }),
      );
      return { value: task, correlationId: transaction.correlationId };
    },
  );
}

/** 同一母任务内重排；sortIndex 只在该 sibling 域内归一化。 */
export async function reorderSubtask(
  input: InitializationClock & { parentId: string; fromIndex: number; toIndex: number },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', operation: 'update' },
    },
    async (transaction) => {
      const [parent, tasks] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.parentId),
        transaction.getAll<Task>(STORE.tasks),
      ]);
      if (!parent || parent.parentId !== null || !CURRENT_TASK_STATUSES.has(parent.status)) {
        throw new Error('母任务必须是当前有效顶层 Task');
      }
      const ordered = currentChildren(tasks, parent.id);
      assertIndex(input.fromIndex, ordered.length - 1, 'fromIndex');
      assertIndex(input.toIndex, ordered.length - 1, 'toIndex');
      if (input.fromIndex === input.toIndex) throw new Error('排序起止位置必须不同');
      const [target] = ordered.splice(input.fromIndex, 1);
      ordered.splice(input.toIndex, 0, target!);
      let updatedTarget = target!;
      for (const [index, task] of ordered.entries()) {
        const sortIndex = (index + 1) * 1000;
        if (task.sortIndex === sortIndex) continue;
        const updated = { ...task, sortIndex, updatedAt: input.now };
        await transaction.put(STORE.tasks, updated);
        if (task.id === target!.id) updatedTarget = updated;
      }
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'subtask.reordered',
          taskId: target!.id,
          payload: {
            parentId: parent.id,
            fromIndex: input.fromIndex,
            toIndex: input.toIndex,
          },
        }),
      );
      return { value: updatedTarget, correlationId: transaction.correlationId };
    },
  );
}

/** 顶层任务成为子任务；若原在今日，同事务先关闭 DayPlan 成员关系。 */
export async function moveTopLevelTaskToSubtask(
  input: InitializationClock & { taskId: string; parentId: string; toIndex: number },
): Promise<TaskCommandResult<Task>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const [task, parent, tasks, dayPlan] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.taskId),
        transaction.get<Task>(STORE.tasks, input.parentId),
        transaction.getAll<Task>(STORE.tasks),
        currentDayPlan(transaction, initialized.dayPlan.id),
      ]);
      if (!task || task.parentId !== null || !isActiveTask(task)) {
        throw new Error('只有有效的 active/splitNeeded 顶层 Task 可以成为子任务');
      }
      if (!parent || parent.id === task.id || parent.parentId !== null || !isActiveTask(parent)) {
        throw new Error('目标母任务必须是另一条有效 active/splitNeeded 顶层 Task');
      }
      if (tasks.some((candidate) => candidate.parentId === task.id)) {
        throw new Error('已有子任务的 Task 不能再成为子任务');
      }
      const ordered = currentChildren(tasks, parent.id);
      assertIndex(input.toIndex, ordered.length, 'toIndex');
      ordered.splice(input.toIndex, 0, task);
      let updatedTarget: Task | undefined;
      for (const [index, item] of ordered.entries()) {
        const updated: Task = {
          ...item,
          parentId: item.id === task.id ? parent.id : item.parentId,
          sortIndex: (index + 1) * 1000,
          updatedAt: input.now,
        };
        if (
          updated.parentId !== item.parentId ||
          updated.sortIndex !== item.sortIndex ||
          item.id === task.id
        ) {
          await transaction.put(STORE.tasks, updated);
        }
        if (item.id === task.id) updatedTarget = updated;
      }

      if (dayPlan.taskIds.includes(task.id)) {
        const updatedDayPlan: DayPlan = {
          ...dayPlan,
          taskIds: dayPlan.taskIds.filter((taskId) => taskId !== task.id),
          updatedAt: input.now,
        };
        await transaction.put(STORE.dayPlans, updatedDayPlan);
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'dayPlan.taskRemoved',
            taskId: task.id,
            dayPlanId: dayPlan.id,
            payload: { reason: 'userRemoved' },
          }),
        );
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'task.movedToList',
            taskId: task.id,
            dayPlanId: dayPlan.id,
            payload: { fromAppDate: dayPlan.appDate },
          }),
        );
      }
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.reparented',
          taskId: task.id,
          payload: { fromParentId: null, toParentId: parent.id, toIndex: input.toIndex },
        }),
      );
      return { value: updatedTarget!, correlationId: transaction.correlationId };
    },
  );
}

/** 子任务升级为活动顶层任务；不自动加入今日。 */
export async function promoteSubtaskToTopLevel(
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
      if (!task || task.parentId === null || !isActiveTask(task)) {
        throw new Error('只有有效的 active/splitNeeded 子任务可以升级为顶层任务');
      }
      const previousParentId = task.parentId;
      const sortIndex = tasks
        .filter((candidate) => candidate.parentId === null && isActiveTask(candidate))
        .reduce((maximum, candidate) => Math.max(maximum, candidate.sortIndex), 0) + 1000;
      const updated: Task = {
        ...task,
        parentId: null,
        sortIndex,
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'subtask.unparented',
          taskId: task.id,
          payload: { previousParentId },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function updateTaskNote(
  input: InitializationClock & { taskId: string; note: string | null },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task || !isActiveTask(task)) {
        throw new Error('只有 active/splitNeeded Task 可以编辑 note');
      }
      if (task.note === input.note) throw new Error('新 note 必须与旧值不同');
      const updated = { ...task, note: input.note, updatedAt: input.now };
      await transaction.put(STORE.tasks, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.updated',
          taskId: task.id,
          payload: { field: 'note', oldValue: task.note, newValue: input.note },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function updateTaskActualWorkNote(
  input: InitializationClock & { taskId: string; actualWorkNote: string | null },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task || (task.status !== 'completed' && task.status !== 'archived')) {
        throw new Error('只有 completed/archived Task 可以编辑 actualWorkNote');
      }
      if (task.actualWorkNote === input.actualWorkNote) {
        throw new Error('新 actualWorkNote 必须与旧值不同');
      }
      const updated = { ...task, actualWorkNote: input.actualWorkNote, updatedAt: input.now };
      await transaction.put(STORE.tasks, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.updated',
          taskId: task.id,
          payload: {
            field: 'actualWorkNote',
            oldValue: task.actualWorkNote,
            newValue: input.actualWorkNote,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/** 仅恢复 archived；deleted 恢复仍属于未授权 P4。 */
export async function restoreArchivedTask(
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
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task || task.status !== 'archived' || task.deletedAt !== null) {
        throw new Error('只有未删除的 archived Task 可以恢复');
      }
      if (task.outcome !== 'completed' && task.outcome !== 'split') {
        throw new Error('archived Task 缺少合法 outcome');
      }
      const restored: Task = task.outcome === 'completed'
        ? {
            ...task,
            status: 'completed',
            outcome: null,
            archivedAt: null,
            updatedAt: input.now,
          }
        : {
            ...task,
            status: 'active',
            outcome: null,
            completedAt: null,
            completionSource: null,
            archivedAt: null,
            updatedAt: input.now,
          };
      await transaction.put(STORE.tasks, restored);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.restored',
          taskId: task.id,
          payload: { restoredFrom: 'archived' },
        }),
      );
      return { value: restored, correlationId: transaction.correlationId };
    },
  );
}

/** 拆分归档并创建且只创建一个血缘后继 Task。 */
export async function splitTask(
  input: SplitTaskInput,
): Promise<TaskCommandResult<{ archivedTask: Task; newTask: Task }>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const [source, allTasks, dayPlan] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.taskId),
        transaction.getAllIncludingDeleted<Task>(STORE.tasks),
        currentDayPlan(transaction, initialized.dayPlan.id),
      ]);
      if (!source || !isActiveTask(source)) {
        throw new Error('只有有效的 active/splitNeeded Task 可以拆分');
      }
      const splitIndex = allTasks
        .filter((task) => task.lineageId === source.lineageId)
        .reduce((maximum, task) => Math.max(maximum, task.splitIndex), 0) + 1;
      const newTask = makeTask({
        now: input.now,
        title: input.newTitle,
        parentId: source.parentId,
        estimatedPomodoros: input.estimatedPomodoros,
        sortIndex: source.sortIndex,
        metadata: { source: 'splitChild' },
        lineageId: source.lineageId,
        splitFromTaskId: source.id,
        splitIndex,
      });
      const archivedTask: Task = {
        ...source,
        status: 'archived',
        outcome: 'split',
        completedAt: null,
        completionSource: null,
        archivedAt: input.now,
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, archivedTask);
      await transaction.put(STORE.tasks, newTask);

      let updatedDayPlan: DayPlan | undefined;
      if (dayPlan.taskIds.includes(source.id)) {
        updatedDayPlan = {
          ...dayPlan,
          taskIds: dayPlan.taskIds.filter((taskId) => taskId !== source.id),
          updatedAt: input.now,
        };
        await transaction.put(STORE.dayPlans, updatedDayPlan);
      }

      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.split',
          taskId: source.id,
          payload: { lineageId: source.lineageId, newTaskId: newTask.id },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.archived',
          taskId: source.id,
          payload: { outcome: 'split' },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.created',
          taskId: newTask.id,
          payload: {
            title: newTask.title,
            parentId: newTask.parentId,
            estimatedPomodoros: newTask.estimatedPomodoros,
            source: 'splitChild',
          },
        }),
      );
      if (updatedDayPlan) {
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'dayPlan.taskRemoved',
            taskId: source.id,
            dayPlanId: dayPlan.id,
            payload: { reason: 'taskArchived' },
          }),
        );
      }
      return {
        value: { archivedTask, newTask },
        correlationId: transaction.correlationId,
      };
    },
  );
}

export async function updateTaskTitle(
  input: InitializationClock & { taskId: string; title: string },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task) throw new Error('Task 不存在或已删除');
      if (task.title === input.title) throw new Error('新标题必须与旧标题不同');
      const updated = { ...task, title: input.title, updatedAt: input.now };
      await transaction.put(STORE.tasks, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.updated',
          taskId: task.id,
          payload: { field: 'title', oldValue: task.title, newValue: input.title },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function adjustTaskEstimate(
  input: InitializationClock & { taskId: string; estimatedPomodoros: number },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task) throw new Error('Task 不存在或已删除');
      if (task.estimatedPomodoros === input.estimatedPomodoros) {
        throw new Error('新预估必须与旧预估不同');
      }
      const round = task.estimateRounds.length + 1;
      if (round !== 2 && round !== 3) throw new Error('预估最多允许三轮');
      const updated: Task = {
        ...task,
        estimatedPomodoros: input.estimatedPomodoros,
        estimateRounds: [
          ...task.estimateRounds,
          { index: round, pomodoros: input.estimatedPomodoros, occurredAt: input.now },
        ],
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.estimateAdjusted',
          taskId: task.id,
          payload: {
            round,
            oldEstimate: task.estimatedPomodoros,
            newEstimate: input.estimatedPomodoros,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function addTaskToToday(
  input: MoveTaskToTodayInput,
): Promise<TaskCommandResult<DayPlan>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'DayPlan', entityId: initialized.dayPlan.id, operation: 'update' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task || (task.status !== 'active' && task.status !== 'splitNeeded')) {
        throw new Error('只有有效的 active/splitNeeded Task 可以加入今日');
      }
      if (task.parentId !== null) throw new Error('只有顶层 Task 可以加入今日');
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      if (dayPlan.taskIds.includes(task.id)) throw new Error('Task 已在今日待办中');
      const addedAtIndex = input.addedAtIndex ?? dayPlan.taskIds.length;
      assertIndex(addedAtIndex, dayPlan.taskIds.length, 'addedAtIndex');
      const taskIds = [...dayPlan.taskIds];
      taskIds.splice(addedAtIndex, 0, task.id);
      const updated = { ...dayPlan, taskIds, updatedAt: input.now };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.taskAdded',
          taskId: task.id,
          dayPlanId: dayPlan.id,
          payload: { addedAtIndex, source: input.source },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.movedToToday',
          taskId: task.id,
          dayPlanId: dayPlan.id,
          payload: { appDate: dayPlan.appDate, addedAtIndex },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function removeTaskFromToday(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<DayPlan>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'DayPlan', entityId: initialized.dayPlan.id, operation: 'update' },
    },
    async (transaction) => {
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task) throw new Error('Task 不存在或已删除');
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      if (!dayPlan.taskIds.includes(task.id)) throw new Error('Task 不在今日待办中');
      const updated = {
        ...dayPlan,
        updatedAt: input.now,
        taskIds: dayPlan.taskIds.filter((taskId) => taskId !== task.id),
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.taskRemoved',
          taskId: task.id,
          dayPlanId: dayPlan.id,
          payload: { reason: 'userRemoved' },
        }),
      );
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.movedToList',
          taskId: task.id,
          dayPlanId: dayPlan.id,
          payload: { fromAppDate: dayPlan.appDate },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function reorderTodayTask(
  input: InitializationClock & { fromIndex: number; toIndex: number },
): Promise<TaskCommandResult<DayPlan>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'DayPlan', entityId: initialized.dayPlan.id, operation: 'update' },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      assertIndex(input.fromIndex, dayPlan.taskIds.length - 1, 'fromIndex');
      assertIndex(input.toIndex, dayPlan.taskIds.length - 1, 'toIndex');
      if (input.fromIndex === input.toIndex) throw new Error('排序起止位置必须不同');
      const taskIds = [...dayPlan.taskIds];
      const [taskId] = taskIds.splice(input.fromIndex, 1);
      taskIds.splice(input.toIndex, 0, taskId!);
      const updated = { ...dayPlan, taskIds, updatedAt: input.now };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.taskReordered',
          taskId: taskId!,
          dayPlanId: dayPlan.id,
          payload: { fromIndex: input.fromIndex, toIndex: input.toIndex },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/** 用户直接确认完成；只快照已经 completed 的标准 focus，不制造 Session。 */
export async function completeTaskManually(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<Task>> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.sessions, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'update' },
    },
    async (transaction) => {
      const [task, sessions] = await Promise.all([
        transaction.get<Task>(STORE.tasks, input.taskId),
        transaction.getAll<Session>(STORE.sessions),
      ]);
      if (!task || (task.status !== 'active' && task.status !== 'splitNeeded')) {
        throw new Error('只有有效的 active/splitNeeded Task 可以手动完成');
      }
      const validFocusCountAtCompletion = sessions.filter(
        (session) =>
          session.type === 'focus' &&
          session.status === 'completed' &&
          session.taskId === task.id,
      ).length;
      const completed: Task = {
        ...task,
        status: 'completed',
        completedAt: input.now,
        completionSource: 'manual',
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, completed);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.completed',
          taskId: task.id,
          payload: {
            completionSource: 'manual',
            completedAt: input.now,
            validFocusCountAtCompletion,
          },
        }),
      );
      return { value: completed, correlationId: transaction.correlationId };
    },
  );
}

/** 撤销尚未归档的完成状态；历史完成 Event 保持 append-only。 */
export async function uncompleteTask(
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
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (!task || task.status !== 'completed') {
        throw new Error('只有尚未归档的 completed Task 可以取消完成');
      }
      const active: Task = {
        ...task,
        status: 'active',
        completedAt: null,
        completionSource: null,
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, active);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.uncompleted',
          taskId: task.id,
          payload: {
            previousCompletedAt: task.completedAt!,
            previousCompletionSource: task.completionSource!,
          },
        }),
      );
      return { value: active, correlationId: transaction.correlationId };
    },
  );
}

/** 完成归档；若仍在当前 DayPlan，同时移除其成员关系。 */
export async function archiveCompletedTask(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<Task>> {
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
        currentDayPlan(transaction, initialized.dayPlan.id),
      ]);
      if (!task || task.status !== 'completed') {
        throw new Error('只有 completed Task 可以完成归档');
      }
      const archived: Task = {
        ...task,
        status: 'archived',
        outcome: 'completed',
        archivedAt: input.now,
        updatedAt: input.now,
      };
      await transaction.put(STORE.tasks, archived);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.archived',
          taskId: task.id,
          payload: { outcome: 'completed' },
        }),
      );

      if (dayPlan.taskIds.includes(task.id)) {
        const updatedDayPlan: DayPlan = {
          ...dayPlan,
          taskIds: dayPlan.taskIds.filter((taskId) => taskId !== task.id),
          updatedAt: input.now,
        };
        await transaction.put(STORE.dayPlans, updatedDayPlan);
        await transaction.appendEvent(
          makeEvent({
            ...eventFields(input, transaction.correlationId),
            type: 'dayPlan.taskRemoved',
            taskId: task.id,
            dayPlanId: dayPlan.id,
            payload: { reason: 'taskArchived' },
          }),
        );
      }
      return { value: archived, correlationId: transaction.correlationId };
    },
  );
}

/** 活动清单排序只改变 Task.sortIndex；今日顺序继续由 DayPlan.taskIds 管理。 */
export async function reorderActivityTask(
  input: InitializationClock & { fromIndex: number; toIndex: number },
): Promise<TaskCommandResult<Task>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', operation: 'update' },
    },
    async (transaction) => {
      const [dayPlan, tasks] = await Promise.all([
        currentDayPlan(transaction, initialized.dayPlan.id),
        transaction.getAll<Task>(STORE.tasks),
      ]);
      const todayIds = new Set(dayPlan.taskIds);
      const ordered = tasks
        .filter(
          (task) =>
            task.parentId === null &&
            (task.status === 'active' || task.status === 'splitNeeded') &&
            !todayIds.has(task.id) &&
            task.metadata.triageStatus !== 'pending',
        )
        .sort((left, right) => left.sortIndex - right.sortIndex || left.id.localeCompare(right.id));
      assertIndex(input.fromIndex, ordered.length - 1, 'fromIndex');
      assertIndex(input.toIndex, ordered.length - 1, 'toIndex');
      if (input.fromIndex === input.toIndex) throw new Error('排序起止位置必须不同');

      const [target] = ordered.splice(input.fromIndex, 1);
      ordered.splice(input.toIndex, 0, target!);
      const previous = ordered[input.toIndex - 1];
      const next = ordered[input.toIndex + 1];
      let nextSortIndex = previous
        ? next
          ? Math.floor((previous.sortIndex + next.sortIndex) / 2)
          : previous.sortIndex + 1000
        : Math.floor(next!.sortIndex / 2);
      const hasRoom =
        Number.isSafeInteger(nextSortIndex) &&
        nextSortIndex >= 0 &&
        nextSortIndex !== target!.sortIndex &&
        (!previous || nextSortIndex > previous.sortIndex) &&
        (!next || nextSortIndex < next.sortIndex);

      let updatedTarget: Task;
      if (hasRoom) {
        updatedTarget = { ...target!, sortIndex: nextSortIndex, updatedAt: input.now };
        await transaction.put(STORE.tasks, updatedTarget);
      } else {
        updatedTarget = target!;
        for (const [index, task] of ordered.entries()) {
          nextSortIndex = (index + 1) * 1000;
          if (task.sortIndex === nextSortIndex) continue;
          const updated = { ...task, sortIndex: nextSortIndex, updatedAt: input.now };
          await transaction.put(STORE.tasks, updated);
          if (task.id === target!.id) updatedTarget = updated;
        }
      }
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.reordered',
          taskId: target!.id,
          payload: { fromIndex: input.fromIndex, toIndex: input.toIndex },
        }),
      );
      return { value: updatedTarget, correlationId: transaction.correlationId };
    },
  );
}

export async function deleteActiveTask(
  input: InitializationClock & { taskId: string },
): Promise<TaskCommandResult<Task>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'Task', entityId: input.taskId, operation: 'softDelete' },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      if (dayPlan.taskIds.includes(input.taskId)) {
        throw new Error('今日任务删除只表示移出今日；活动清单软删除前必须先移出');
      }
      const task = await transaction.get<Task>(STORE.tasks, input.taskId);
      if (
        !task ||
        (task.status !== 'active' && task.status !== 'splitNeeded') ||
        task.metadata.triageStatus === 'pending'
      ) {
        throw new Error('只有活动清单中的有效 Task 可以软删除');
      }
      const deleted = await transaction.softDelete(STORE.tasks, input.taskId, input.now, {
        deletedReason: 'userDeleted',
      });
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'task.deleted',
          taskId: deleted.id,
          payload: { deletedReason: 'userDeleted' },
        }),
      );
      return { value: deleted, correlationId: transaction.correlationId };
    },
  );
}
