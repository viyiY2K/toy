import { dataStore, STORE } from '../dataStore';
import type { InitializationClock } from '../initialization/currentAppDate';
import type { DayPlan, Settings, Task } from '../schema';
import { deriveAppDate } from '../time';
import {
  addTaskToToday,
  archiveCompletedTask,
  removeTaskFromToday,
  type TaskCommandResult,
} from './taskCommands';

export type BatchTaskAction = 'addToToday' | 'moveToList' | 'archiveCompleted';

export interface BatchTaskInput extends InitializationClock {
  taskIds: readonly string[];
}

export interface BatchTaskPreflightIssue {
  taskId: string | null;
  code: 'empty' | 'duplicate' | 'notInitialized' | 'missing' | 'notEligible';
  message: string;
}

export class BatchTaskPreflightError extends Error {
  readonly issues: readonly BatchTaskPreflightIssue[];

  constructor(issues: readonly BatchTaskPreflightIssue[]) {
    super(`批量任务预检失败（${issues.length} 项）`);
    this.name = 'BatchTaskPreflightError';
    this.issues = issues;
  }
}

export interface BatchTaskSuccess {
  taskId: string;
  correlationId: string;
}

export interface BatchTaskFailure {
  taskId: string;
  message: string;
}

export interface BatchTaskCommandResult {
  succeeded: BatchTaskSuccess[];
  failed: BatchTaskFailure[];
  notAttempted: string[];
}

function isActiveTopLevelTask(task: Task): boolean {
  return task.parentId === null
    && (task.status === 'active' || task.status === 'splitNeeded')
    && task.metadata.triageStatus !== 'pending';
}

function issue(
  issues: BatchTaskPreflightIssue[],
  taskId: string | null,
  code: BatchTaskPreflightIssue['code'],
  message: string,
): void {
  issues.push({ taskId, code, message });
}

/**
 * 整批预检只读取当前事实；不得通过 ensureCurrentAppDateInitialized 产生初始化写入。
 */
async function preflight(
  action: BatchTaskAction,
  input: InitializationClock & { taskIds: readonly string[] },
): Promise<void> {
  const [tasks, settingsRecords, dayPlans] = await Promise.all([
    dataStore.getAll<Task>(STORE.tasks),
    dataStore.getAll<Settings>(STORE.settings),
    dataStore.getAll<DayPlan>(STORE.dayPlans),
  ]);
  const issues: BatchTaskPreflightIssue[] = [];
  if (input.taskIds.length === 0) issue(issues, null, 'empty', '批量操作至少需要一个 Task');

  const seen = new Set<string>();
  for (const taskId of input.taskIds) {
    if (seen.has(taskId)) issue(issues, taskId, 'duplicate', '批量 Task id 不得重复');
    seen.add(taskId);
  }

  const settings = settingsRecords[0];
  let dayPlan: DayPlan | undefined;
  if (!settings) {
    issue(issues, null, 'notInitialized', '批量操作前当前 Settings 必须已初始化');
  } else {
    try {
      const appDate = deriveAppDate(
        input.now,
        input.timezone,
        settings.appDayStartOffsetMinutes,
      );
      dayPlan = dayPlans.find((candidate) => candidate.appDate === appDate);
      if (!dayPlan) {
        issue(issues, null, 'notInitialized', '批量操作前当前 appDate DayPlan 必须已初始化');
      }
    } catch {
      issue(issues, null, 'notInitialized', '批量操作时钟或时区无效');
    }
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const taskId of input.taskIds) {
    const task = taskById.get(taskId);
    if (!task) {
      issue(issues, taskId, 'missing', 'Task 不存在或已删除');
      continue;
    }
    if (action === 'addToToday') {
      if (!isActiveTopLevelTask(task) || dayPlan?.taskIds.includes(task.id)) {
        issue(issues, task.id, 'notEligible', '只有未在今日的有效顶层活动 Task 可以批量加入今日');
      }
    } else if (action === 'moveToList') {
      if (!isActiveTopLevelTask(task) || !dayPlan?.taskIds.includes(task.id)) {
        issue(issues, task.id, 'notEligible', '只有今日中的有效顶层活动 Task 可以批量移回活动清单');
      }
    } else if (task.status !== 'completed') {
      issue(issues, task.id, 'notEligible', '批量归档只接受 completed Task');
    }
  }

  if (issues.length > 0) throw new BatchTaskPreflightError(issues);
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知批量执行错误';
}

async function executeSequentially(
  input: BatchTaskInput,
  taskIds: readonly string[],
  command: (
    clock: InitializationClock & { taskId: string },
  ) => Promise<TaskCommandResult<unknown>>,
): Promise<BatchTaskCommandResult> {
  const succeeded: BatchTaskSuccess[] = [];
  for (let index = 0; index < taskIds.length; index += 1) {
    const taskId = taskIds[index]!;
    try {
      // 每项重新读取 clock，使运行时环境失败能归属到精确 Task；各项仍是独立事务。
      const result = await command({ now: input.now, timezone: input.timezone, taskId });
      succeeded.push({ taskId, correlationId: result.correlationId });
    } catch (error) {
      return {
        succeeded,
        failed: [{ taskId, message: failureMessage(error) }],
        notAttempted: taskIds.slice(index + 1),
      };
    }
  }
  return { succeeded, failed: [], notAttempted: [] };
}

export async function batchAddTasksToToday(
  input: BatchTaskInput,
): Promise<BatchTaskCommandResult> {
  const taskIds = [...input.taskIds];
  await preflight('addToToday', { now: input.now, timezone: input.timezone, taskIds });
  return executeSequentially(input, taskIds, ({ taskId, ...clock }) =>
    addTaskToToday({ ...clock, taskId, source: 'button' }));
}

export async function batchMoveTasksToList(
  input: BatchTaskInput,
): Promise<BatchTaskCommandResult> {
  const taskIds = [...input.taskIds];
  await preflight('moveToList', { now: input.now, timezone: input.timezone, taskIds });
  return executeSequentially(input, taskIds, removeTaskFromToday);
}

export async function batchArchiveCompletedTasks(
  input: BatchTaskInput,
): Promise<BatchTaskCommandResult> {
  const taskIds = [...input.taskIds];
  await preflight('archiveCompleted', { now: input.now, timezone: input.timezone, taskIds });
  return executeSequentially(input, taskIds, archiveCompletedTask);
}
