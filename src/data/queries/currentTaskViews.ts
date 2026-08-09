import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import type { DayPlan, Event, IsoDateTime, MergeGroup, Session, Settings, Task } from '../schema';
import { deriveAppDate, type IsoDate } from '../time';

/**
 * 已完成任务的完成时刻展示口径（只用于渲染，不参与统计口径）：
 * 番茄完成优先展示那次标准 focus 的起止时间段（源自 `task.completed` 事件的 sessionId 关联 Session）；
 * 手动完成没有关联 Session，退回展示完成事件本身的 occurredAt（即 task.completedAt）。
 * `timezone` 一律取自事实记录自带的时区，不用当前设备时区重算（红线 5）。
 */
export interface CompletedTaskTiming {
  timezone: string;
  focusStartedAt: IsoDateTime | null;
  focusEndedAt: IsoDateTime | null;
}

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
  completionTimingByTaskId: Record<string, CompletedTaskTiming>;
  remainingPomodorosByTaskId: Record<string, number>;
  todayPlanningCapacityRemaining: number;
  /**
   * 仍在用的合并组（§3.8，`active` / `limitReached`），按创建顺序。
   * 组内成员完全平等、互相独立——合并只表示"这几件事各自都占不满一个番茄"，
   * 不表示它们属于同一件事，因此这里不提供任何"共同上层归属"的派生。
   */
  mergeGroups: MergeGroup[];
  /** 合并组 id → 成员 Task，按 `MergeGroup.taskIds` 的顺序（即合并卡片内的展示顺序）。 */
  mergeGroupMembersById: Record<string, Task[]>;
  /** 合并组 id → 该组还剩几个番茄没跑（预估减去已完成轮次，下限 0）。 */
  mergeGroupRemainingById: Record<string, number>;
  /**
   * Task id → 是否有过任何 `type='focus'` Session 记录（completed / discarded 都算）。
   * §3.8 关键规则 9 的合并资格红线：有过记录的任务**永久**不能再被合并。
   * UI 拿它做拖拽防呆——不能等写入被拒绝了才告诉用户。
   */
  hasFocusHistoryByTaskId: Record<string, boolean>;
}

function compareListOrder(left: Task, right: Task): number {
  return left.sortIndex - right.sortIndex || left.id.localeCompare(right.id);
}

function isCurrentStatus(task: Task): boolean {
  return task.status === 'active' || task.status === 'splitNeeded' || task.status === 'completed';
}

function isHistoricalPlanningPreparation(task: Task, currentDayTaskIds: ReadonlySet<string>): boolean {
  return task.metadata.source === 'systemDailyTemplate'
    && task.metadata.templateKey === 'planningPreparation'
    && !currentDayTaskIds.has(task.id);
}

/**
 * 当前任务视图：先保证当前产品日初始化，再从 v4 真值派生顶层、子任务与归档历史。
 * 今日顺序只来自 DayPlan.taskIds；Task.sortIndex 仅在顶层活动域或单个 sibling 域解释。
 */
export async function loadCurrentTaskViews(clock: InitializationClock): Promise<CurrentTaskViews> {
  const initialized = await ensureCurrentAppDateInitialized(clock);
  const [storedDayPlan, tasks, sessions, events, mergeGroups] = await Promise.all([
    dataStore.get<DayPlan>(STORE.dayPlans, initialized.dayPlan.id),
    dataStore.getAll<Task>(STORE.tasks),
    dataStore.getAll<Session>(STORE.sessions),
    dataStore.getAll<Event>(EVENT_STORE),
    dataStore.getAll<MergeGroup>(STORE.mergeGroups),
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
        !isHistoricalPlanningPreparation(task, todayTaskIds) &&
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

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const latestCompletionEventByTaskId = new Map<string, Event<'task.completed'>>();
  for (const event of events) {
    if (event.type !== 'task.completed' || event.taskId === null) continue;
    const existing = latestCompletionEventByTaskId.get(event.taskId);
    if (!existing || Date.parse(event.occurredAt) > Date.parse(existing.occurredAt)) {
      latestCompletionEventByTaskId.set(event.taskId, event);
    }
  }
  const completionTimingByTaskId: Record<string, CompletedTaskTiming> = {};
  for (const task of completedTasks) {
    const completionEvent = latestCompletionEventByTaskId.get(task.id);
    if (!completionEvent) continue;
    const session = completionEvent.sessionId ? sessionById.get(completionEvent.sessionId) : undefined;
    completionTimingByTaskId[task.id] =
      completionEvent.payload.completionSource === 'pomodoro' && session?.endedAt
      ? { timezone: session.timezone, focusStartedAt: session.startedAt, focusEndedAt: session.endedAt }
      : { timezone: completionEvent.timezone, focusStartedAt: null, focusEndedAt: null };
  }

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
  const hasFocusHistoryByTaskId: Record<string, boolean> = {};
  let completedFocusCountToday = 0;
  for (const session of sessions) {
    if (session.type !== 'focus') continue;
    // 合并资格看的是"有没有过 focus 记录"，completed 与 discarded 一视同仁。
    for (const taskId of session.taskIds) hasFocusHistoryByTaskId[taskId] = true;
    if (session.status !== 'completed' || session.taskIds.length === 0) continue;
    /*
     * ⚠️ 旧口径，待单独重做：这里按 §8.5.1 给合并 Session 的每个成员各记 +1。
     * 新口径下统计单位是合并组本身，成员任务不再记有效番茄，只按组内次序切分实际
     * 耗时。规范正文由「中长期主线任务」那条线改写，改写后本段与 awarenessStats
     * 的任务维度计数需要一并重做。
     */
    for (const taskId of session.taskIds) {
      completedValidFocusCountByTaskId[taskId] =
        (completedValidFocusCountByTaskId[taskId] ?? 0) + 1;
    }
    // §8.3.1：全局有效番茄数按 Session 记录数计，不因 taskIds 长度重复计数。
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

  const liveGroups = mergeGroups.filter((group) => group.status !== 'dissolved');
  const mergeGroupMembersById: Record<string, Task[]> = {};
  const mergeGroupRemainingById: Record<string, number> = {};
  for (const group of liveGroups) {
    mergeGroupMembersById[group.id] = group.taskIds.flatMap((taskId) => {
      const task = taskById.get(taskId);
      return task && isCurrentStatus(task) ? [task] : [];
    });
    const completedRounds = sessions.filter(
      (session) =>
        session.type === 'focus' &&
        session.status === 'completed' &&
        session.mergeGroupId === group.id,
    ).length;
    mergeGroupRemainingById[group.id] = Math.max(0, group.estimatedPomodoros - completedRounds);
  }

  /*
   * 今日排期余量（§8.10.3）。合并组的成员**不各自占用**预算：一整组共用一段专注，
   * 占的是这个组自己的 estimatedPomodoros，而不是各成员预估之和——否则把 4 件杂事
   * 并成一个番茄，余量反而会被扣掉 4 个，与合并的本意相反。
   */
  const groupIdOfTask = new Map<string, string>();
  for (const group of liveGroups) {
    for (const taskId of group.taskIds) groupIdOfTask.set(taskId, group.id);
  }
  const unfinishedToday = todayTasks.filter(
    (task) =>
      task.status !== 'completed' && task.status !== 'archived' && task.status !== 'deleted',
  );
  const standaloneRemaining = unfinishedToday
    .filter((task) => !groupIdOfTask.has(task.id))
    .reduce((total, task) => total + remainingPomodorosByTaskId[task.id]!, 0);
  const chargedGroupIds = new Set(
    unfinishedToday.flatMap((task) => {
      const groupId = groupIdOfTask.get(task.id);
      return groupId === undefined ? [] : [groupId];
    }),
  );
  const groupRemaining = [...chargedGroupIds].reduce(
    (total, groupId) => total + (mergeGroupRemainingById[groupId] ?? 0),
    0,
  );
  const todayPlanningCapacityRemaining =
    storedDayPlan.budgetPomodoros - completedFocusCountToday - standaloneRemaining - groupRemaining;

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
    completionTimingByTaskId,
    remainingPomodorosByTaskId,
    todayPlanningCapacityRemaining,
    mergeGroups: liveGroups,
    mergeGroupMembersById,
    mergeGroupRemainingById,
    hasFocusHistoryByTaskId,
  };
}
