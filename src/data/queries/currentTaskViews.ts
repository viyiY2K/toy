import { dataStore, STORE } from '../dataStore';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import type { DayPlan, Session, Settings, Task } from '../schema';
import { deriveAppDate, type IsoDate } from '../time';

export interface CurrentTaskViews {
  appDate: IsoDate;
  settings: Settings;
  dayPlan: DayPlan;
  todayTasks: Task[];
  activeTasks: Task[];
  completedTasks: Task[];
  pendingTriageTasks: Task[];
  subtasksByParentId: Record<string, Task[]>;
  orphanedSubtasks: Task[];
  archivedTasks: Task[];
  completedFocusCountToday: number;
  completedValidFocusCountByTaskId: Record<string, number>;
  remainingPomodorosByTaskId: Record<string, number>;
  todayPlanningCapacityRemaining: number;
}

function compareListOrder(left: Task, right: Task): number {
  return left.sortIndex - right.sortIndex || left.id.localeCompare(right.id);
}

function isCurrentStatus(task: Task): boolean {
  return task.status === 'active' || task.status === 'splitNeeded' || task.status === 'completed';
}

/**
 * 当前任务视图：先保证当前产品日初始化，再从 v4 真值派生顶层、子任务与归档历史。
 * 今日顺序只来自 DayPlan.taskIds；Task.sortIndex 仅在顶层活动域或单个 sibling 域解释。
 */
export async function loadCurrentTaskViews(clock: InitializationClock): Promise<CurrentTaskViews> {
  const initialized = await ensureCurrentAppDateInitialized(clock);
  const [storedDayPlan, tasks, sessions] = await Promise.all([
    dataStore.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
    dataStore.getAll<Task>(STORE.tasks),
    dataStore.getAll<Session>(STORE.sessions),
  ]);
  if (!storedDayPlan || storedDayPlan.appDate !== initialized.appDate) {
    throw new Error('当前 appDate 的有效 DayPlan 在初始化后不可用');
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const todayTaskIds = new Set(storedDayPlan.taskIds);
  const todayTasks = storedDayPlan.taskIds.flatMap((taskId) => {
    const task = taskById.get(taskId);
    return task &&
      task.parentId === null &&
      (task.status === 'active' || task.status === 'splitNeeded' || task.status === 'completed')
      ? [task]
      : [];
  });
  const activeTasks = tasks
    .filter(
      (task) =>
        task.parentId === null &&
        (task.status === 'active' || task.status === 'splitNeeded') &&
        !todayTaskIds.has(task.id) &&
        task.metadata.triageStatus !== 'pending',
    )
    .sort(compareListOrder);
  const completedTasks = tasks
    .filter((task) => task.parentId === null && task.status === 'completed')
    .sort((left, right) => {
      const leftTodayIndex = storedDayPlan.taskIds.indexOf(left.id);
      const rightTodayIndex = storedDayPlan.taskIds.indexOf(right.id);
      if (leftTodayIndex >= 0 && rightTodayIndex >= 0) return leftTodayIndex - rightTodayIndex;
      if (leftTodayIndex >= 0) return -1;
      if (rightTodayIndex >= 0) return 1;
      return compareListOrder(left, right);
    });
  const pendingTriageTasks = tasks
    .filter(
      (task) =>
        task.parentId === null &&
        task.status === 'active' &&
        task.metadata.triageStatus === 'pending',
    )
    .sort(compareListOrder);
  const subtasksByParentId: Record<string, Task[]> = {};
  for (const task of tasks.filter((candidate) => candidate.parentId !== null && isCurrentStatus(candidate))) {
    (subtasksByParentId[task.parentId!] ??= []).push(task);
  }
  for (const siblings of Object.values(subtasksByParentId)) siblings.sort(compareListOrder);
  const visibleTopLevelIds = new Set(
    tasks
      .filter(
        (task) =>
          task.parentId === null &&
          isCurrentStatus(task) &&
          task.metadata.triageStatus !== 'pending',
      )
      .map(({ id }) => id),
  );
  const orphanedSubtasks = tasks
    .filter(
      (task) =>
        task.parentId !== null &&
        (task.status === 'active' || task.status === 'splitNeeded') &&
        !visibleTopLevelIds.has(task.parentId),
    )
    .sort(
      (left, right) =>
        left.parentId!.localeCompare(right.parentId!) || compareListOrder(left, right),
    );
  const archivedTasks = tasks
    .filter((task) => task.status === 'archived')
    .sort(
      (left, right) =>
        right.archivedAt!.localeCompare(left.archivedAt!) || left.id.localeCompare(right.id),
    );

  const completedValidFocusCountByTaskId: Record<string, number> = {};
  let completedFocusCountToday = 0;
  for (const session of sessions) {
    if (session.type !== 'focus' || session.status !== 'completed' || session.taskId === null) {
      continue;
    }
    completedValidFocusCountByTaskId[session.taskId] =
      (completedValidFocusCountByTaskId[session.taskId] ?? 0) + 1;
    if (
      deriveAppDate(
        session.startedAt,
        session.timezone,
        initialized.settings.appDayStartOffsetMinutes,
      ) === initialized.appDate
    ) {
      completedFocusCountToday += 1;
    }
  }

  const remainingPomodorosByTaskId: Record<string, number> = {};
  for (const task of todayTasks) {
    remainingPomodorosByTaskId[task.id] = Math.max(
      0,
      task.estimatedPomodoros - (completedValidFocusCountByTaskId[task.id] ?? 0),
    );
  }
  const scheduledRemaining = todayTasks
    .filter(
      (task) =>
        task.status !== 'completed' && task.status !== 'archived' && task.status !== 'deleted',
    )
    .reduce((total, task) => total + remainingPomodorosByTaskId[task.id]!, 0);
  const todayPlanningCapacityRemaining =
    storedDayPlan.budgetPomodoros - completedFocusCountToday - scheduledRemaining;

  return {
    appDate: initialized.appDate,
    settings: initialized.settings,
    dayPlan: storedDayPlan,
    todayTasks,
    activeTasks,
    completedTasks,
    pendingTriageTasks,
    subtasksByParentId,
    orphanedSubtasks,
    archivedTasks,
    completedFocusCountToday,
    completedValidFocusCountByTaskId,
    remainingPomodorosByTaskId,
    todayPlanningCapacityRemaining,
  };
}
