import { describe, expect, it } from 'vitest';
import { EVENT_STORE, STORE } from '../dataStore';
import {
  makeSession,
  makeTask,
  makeUnresolvedInterval,
  type DayPlan,
  type Session,
  type Task,
} from '../schema';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import { loadCurrentTaskViews } from './currentTaskViews';

// UTC 日期仍为 9/9，但 Asia/Shanghai 的事实/产品日已是 9/10，防止查询误用时间戳日期。
const NOW = '2026-09-09T16:30:00Z';
const LATER = '2026-09-09T16:35:00Z';
const TIMEZONE = 'Asia/Shanghai';

describe('S10 当前任务派生视图', () => {
  it('按当前 appDate 的 DayPlan 顺序派生今日，并按状态派生活动和待分流', async () => {
    const initialized = await loadCurrentTaskViews({ now: NOW, timezone: TIMEZONE });
    const planningTask = initialized.todayTasks[0];
    expect(initialized.appDate).toBe('2026-09-10');
    expect(planningTask).toMatchObject({
      title: '计划准备',
      metadata: { templateKey: 'planningPreparation' },
    });

    const todayHighSort = makeTask({ now: NOW, title: '今日高 sortIndex', sortIndex: 9000 });
    const todayLowSort = makeTask({ now: NOW, title: '今日低 sortIndex', sortIndex: 1 });
    const activeLater = makeTask({ now: NOW, title: '活动二', sortIndex: 2000 });
    const activeEarlier = makeTask({ now: NOW, title: '活动一', sortIndex: 1000 });
    const splitNeeded = makeTask({
      now: NOW,
      title: '待拆分但仍在活动清单',
      status: 'splitNeeded',
      sortIndex: 1500,
    });
    const pending = makeTask({
      now: NOW,
      title: '待分流',
      sortIndex: 500,
      metadata: { triageStatus: 'pending' },
    });
    const completed = makeTask({
      now: NOW,
      title: '当前已完成',
      status: 'completed',
      completedAt: NOW,
      completionSource: 'manual',
      sortIndex: 10,
    });
    const archived = makeTask({
      now: NOW,
      title: '已归档历史',
      status: 'archived',
      outcome: 'completed',
      archivedAt: LATER,
      completedAt: NOW,
      completionSource: 'manual',
      sortIndex: 11,
    });
    const deletedToday = makeTask({ now: NOW, title: '今日 tombstone', sortIndex: 2 });
    const allNewTasks = [
      todayHighSort,
      todayLowSort,
      activeLater,
      activeEarlier,
      splitNeeded,
      pending,
      completed,
      archived,
      deletedToday,
    ];
    const updatedDayPlan: DayPlan = {
      ...initialized.dayPlan,
      updatedAt: LATER,
      taskIds: [planningTask!.id, todayHighSort.id, deletedToday.id, archived.id, todayLowSort.id],
    };

    await executeAtomicWrite(
      {
        storeNames: [STORE.tasks, STORE.dayPlans, EVENT_STORE],
        now: LATER,
        timezone: TIMEZONE,
      },
      async (transaction) => {
        for (const task of allNewTasks) await transaction.put(STORE.tasks, task);
        await transaction.put(STORE.dayPlans, updatedDayPlan);
        await transaction.softDelete(STORE.tasks, deletedToday.id, LATER, {
          deletedReason: 'userDeleted',
        });
      },
    );

    const views = await loadCurrentTaskViews({ now: LATER, timezone: TIMEZONE });
    expect(views.settings.id).toBe(initialized.settings.id);
    expect(views.dayPlan.id).toBe(initialized.dayPlan.id);
    expect(views.todayTasks.map((task) => task.title)).toEqual([
      '计划准备',
      '今日高 sortIndex',
      '今日低 sortIndex',
    ]);
    expect(views.activeTasks.map((task) => task.title)).toEqual([
      '活动一',
      '待拆分但仍在活动清单',
      '活动二',
    ]);
    expect(views.pendingTriageTasks.map((task) => task.title)).toEqual(['待分流']);
    expect(views.completedTasks.map((task) => task.title)).toEqual(['当前已完成']);

    const visibleIds = new Set(
      [...views.todayTasks, ...views.activeTasks, ...views.completedTasks, ...views.pendingTriageTasks].map(
        (task: Task) => task.id,
      ),
    );
    expect(visibleIds.has(completed.id)).toBe(true);
    expect(visibleIds.has(archived.id)).toBe(false);
    expect(visibleIds.has(deletedToday.id)).toBe(false);
    expect('bucket' in views.todayTasks[0]!).toBe(false);
  });

  it('derives remaining task estimates and today capacity from standard focus/appDate facts', async () => {
    const now = '2027-02-02T09:00:00+08:00';
    const initialized = await loadCurrentTaskViews({ now, timezone: TIMEZONE });
    const active = makeTask({ now, title: '跨天继续', estimatedPomodoros: 3 });
    const completed = makeTask({
      now,
      title: '今日已完成',
      estimatedPomodoros: 2,
      status: 'completed',
      completedAt: '2027-02-02T10:00:00+08:00',
      completionSource: 'manual',
    });
    const splitNeeded = makeTask({
      now,
      title: '仍需处理',
      estimatedPomodoros: 4,
      status: 'splitNeeded',
    });
    const updatedDayPlan: DayPlan = {
      ...initialized.dayPlan,
      taskIds: [active.id, completed.id, splitNeeded.id],
      budgetPomodoros: 8,
      updatedAt: '2027-02-02T09:01:00+08:00',
    };
    const focus = (
      id: string,
      task: Task,
      startedAt: string,
      endedAt: string,
      pomodoroIndex: number,
      dayPlanId: string | null,
    ): Session => makeSession({
      id,
      now: endedAt,
      startedAt,
      endedAt,
      timezone: TIMEZONE,
      type: 'focus',
      status: 'completed',
      taskId: task.id,
      plannedDuration: 1500,
      actualDuration: 1200,
      pomodoroIndex,
      dayPlanId,
    });
    const previousFocus = focus(
      '019c1f80-0000-7000-8000-000000000001', active,
      '2027-02-01T09:00:00+08:00', '2027-02-01T09:20:00+08:00', 1, null,
    );
    const todayActiveFocus = focus(
      '019c1f80-0000-7000-8000-000000000002', active,
      '2027-02-02T09:10:00+08:00', '2027-02-02T09:30:00+08:00', 2,
      updatedDayPlan.id,
    );
    const todayCompletedFocus = focus(
      '019c1f80-0000-7000-8000-000000000003', completed,
      '2027-02-02T09:40:00+08:00', '2027-02-02T10:00:00+08:00', 1,
      updatedDayPlan.id,
    );
    const deletedFocus = focus(
      '019c1f80-0000-7000-8000-000000000004', active,
      '2027-02-02T10:10:00+08:00', '2027-02-02T10:30:00+08:00', 3,
      updatedDayPlan.id,
    );
    const discardedFocus = makeSession({
      id: '019c1f80-0000-7000-8000-000000000007',
      now: '2027-02-02T10:50:00+08:00',
      startedAt: '2027-02-02T10:40:00+08:00',
      endedAt: '2027-02-02T10:50:00+08:00',
      timezone: TIMEZONE,
      type: 'focus',
      status: 'discarded',
      taskId: active.id,
      plannedDuration: 1500,
      actualDuration: 600,
      pomodoroIndex: 4,
      dayPlanId: updatedDayPlan.id,
    });
    const interval = makeUnresolvedInterval({
      id: '019c1f80-0000-7000-8000-000000000006',
      now: '2027-02-02T11:30:00+08:00',
      startedAt: '2027-02-02T11:00:00+08:00',
      endedAt: '2027-02-02T11:20:00+08:00',
      timezone: TIMEZONE,
      source: 'appReopened',
      status: 'classified',
      classifiedAt: '2027-02-02T11:30:00+08:00',
    });
    const extraFocus = makeSession({
      id: '019c1f80-0000-7000-8000-000000000005',
      now: '2027-02-02T11:30:00+08:00',
      startedAt: '2027-02-02T11:00:00+08:00',
      endedAt: '2027-02-02T11:20:00+08:00',
      timezone: TIMEZONE,
      type: 'extraFocus',
      status: 'completed',
      taskId: active.id,
      actualDuration: 1200,
      originIntervalId: interval.id,
    });

    await executeAtomicWrite(
      {
        storeNames: [
          STORE.tasks,
          STORE.dayPlans,
          STORE.sessions,
          STORE.unresolvedIntervals,
          EVENT_STORE,
        ],
        now: '2027-02-02T11:31:00+08:00',
        timezone: TIMEZONE,
      },
      async (transaction) => {
        for (const task of [active, completed, splitNeeded]) await transaction.put(STORE.tasks, task);
        await transaction.put(STORE.dayPlans, updatedDayPlan);
        await transaction.put(STORE.unresolvedIntervals, interval);
        for (const session of [
          previousFocus,
          todayActiveFocus,
          todayCompletedFocus,
          deletedFocus,
          discardedFocus,
          extraFocus,
        ]) {
          await transaction.put(STORE.sessions, session);
        }
        await transaction.softDelete(
          STORE.sessions,
          deletedFocus.id,
          '2027-02-02T10:31:00+08:00',
        );
      },
    );

    const views = await loadCurrentTaskViews({
      now: '2027-02-02T12:00:00+08:00',
      timezone: TIMEZONE,
    });
    expect(views.completedFocusCountToday).toBe(2);
    expect(views.completedValidFocusCountByTaskId[active.id]).toBe(2);
    expect(views.remainingPomodorosByTaskId).toMatchObject({
      [active.id]: 1,
      [completed.id]: 1,
      [splitNeeded.id]: 4,
    });
    expect(views.todayPlanningCapacityRemaining).toBe(1);
  });

  it('separates top-level lists, sibling domains, orphaned active children, and archived history', async () => {
    const now = '2027-03-03T09:00:00+08:00';
    const initialized = await loadCurrentTaskViews({ now, timezone: TIMEZONE });
    const parent = makeTask({ now, title: '层级查询父', sortIndex: 40_000 });
    const activeChild = makeTask({
      now, title: '层级查询子二', parentId: parent.id, sortIndex: 2000,
    });
    const completedChild = makeTask({
      now, title: '层级查询子一', parentId: parent.id, sortIndex: 1000,
      status: 'completed', completedAt: now, completionSource: 'manual',
    });
    const archivedParent = makeTask({
      now, title: '不可见归档父', status: 'archived', outcome: 'completed',
      completedAt: now, completionSource: 'manual', archivedAt: '2027-03-03T10:00:00+08:00',
      sortIndex: 50_000,
    });
    const archivedParent2 = makeTask({
      now, title: '不可见归档父二', status: 'archived', outcome: 'completed',
      completedAt: now, completionSource: 'manual', archivedAt: '2027-03-03T10:30:00+08:00',
      sortIndex: 60_000,
    });
    const [lexicalFirstParent, lexicalSecondParent] = [archivedParent, archivedParent2]
      .sort((left, right) => left.id.localeCompare(right.id));
    const orphanLateInFirstDomain = makeTask({
      now,
      title: '首个父域第二项',
      parentId: lexicalFirstParent!.id,
      sortIndex: 9000,
    });
    const orphanEarlyInFirstDomain = makeTask({
      now,
      title: '首个父域第一项',
      parentId: lexicalFirstParent!.id,
      sortIndex: 8000,
    });
    const orphanInSecondDomain = makeTask({
      now,
      title: '第二父域低序号项',
      parentId: lexicalSecondParent!.id,
      sortIndex: 1,
    });
    const archivedChild = makeTask({
      now, title: '归档子任务', parentId: parent.id, status: 'archived', outcome: 'completed',
      completedAt: now, completionSource: 'manual', archivedAt: '2027-03-03T11:00:00+08:00',
      sortIndex: 3000,
    });
    await executeAtomicWrite(
      { storeNames: [STORE.tasks, EVENT_STORE], now, timezone: TIMEZONE },
      async (transaction) => {
        for (const task of [
          parent,
          activeChild,
          completedChild,
          archivedParent,
          archivedParent2,
          orphanLateInFirstDomain,
          orphanEarlyInFirstDomain,
          orphanInSecondDomain,
          archivedChild,
        ]) {
          await transaction.put(STORE.tasks, task);
        }
      },
    );

    const views = await loadCurrentTaskViews({
      now: '2027-03-03T12:00:00+08:00', timezone: TIMEZONE,
    });
    expect(views.activeTasks.map(({ id }) => id)).toContain(parent.id);
    expect(views.activeTasks.map(({ id }) => id)).not.toContain(activeChild.id);
    expect(views.completedTasks.map(({ id }) => id)).not.toContain(completedChild.id);
    expect(views.subtasksByParentId[parent.id]!.map(({ id }) => id)).toEqual([
      completedChild.id,
      activeChild.id,
    ]);
    expect(views.orphanedSubtasks.map(({ id }) => id)).toEqual([
      orphanEarlyInFirstDomain.id,
      orphanLateInFirstDomain.id,
      orphanInSecondDomain.id,
    ]);
    expect(views.archivedTasks.map(({ id }) => id).slice(0, 3)).toEqual([
      archivedChild.id,
      archivedParent2.id,
      archivedParent.id,
    ]);
    expect(views.archivedTasks.map(({ id }) => id)).not.toContain(initialized.todayTasks[0]!.id);
  });
});
