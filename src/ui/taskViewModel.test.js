import { describe, expect, it } from 'vitest';
import {
  activityReorderPayload,
  archivedTaskPresentation,
  availableParentTasks,
  batchCandidates,
  batchResultPresentation,
  batchRetryIds,
  canAdjustTaskEstimate,
  canReorderSubtasks,
  completedTaskTimeLabel,
  completionSourceLabel,
  currentPlanMetrics,
  dayPlanIndexOf,
  dropInsertIndex,
  canStartMergeGroup,
  completedOnlyMergeRows,
  currentMergeMember,
  dropIntent,
  foldMergeRows,
  hasRetainedChildren,
  isTaskRunningFocus,
  mergeCardSummary,
  mergeIneligibleReason,
  reconcileBatchSelection,
  splitDraftValid,
  splitLineagePresentation,
  splitTodayTasks,
  unattachedSubtasks,
} from './taskViewModel';

const task = (id, status, estimatedPomodoros) => ({ id, status, estimatedPomodoros });

describe('S13b task view model', () => {
  it('keeps DayPlan order while splitting active and completed presentation groups', () => {
    const ordered = [task('b', 'active', 3), task('a', 'completed', 2), task('c', 'splitNeeded', 1)];
    const result = splitTodayTasks(ordered);
    expect(result.activeTasks.map(({ id }) => id)).toEqual(['b', 'c']);
    expect(result.completedTasks.map(({ id }) => id)).toEqual(['a']);
  });

  it('uses persisted DayPlan planning fields instead of legacy budget state', () => {
    expect(
      currentPlanMetrics(
        { budgetPomodoros: 8, estimate: { freeMin: 330 } },
        -2,
      ),
    ).toEqual({
      freeHours: 5.5,
      budgetPomodoros: 8,
      remainingPomodoros: -2,
      overloadedPomodoros: 2,
    });
    expect(
      currentPlanMetrics({ budgetPomodoros: 8, estimate: { freeMin: 330 } }, 4),
    ).toMatchObject({ remainingPomodoros: 4, overloadedPomodoros: 0 });
  });

  it('keeps reorder indexes anchored to the complete DayPlan order', () => {
    const ordered = [task('done', 'completed', 1), task('active', 'active', 2)];
    expect(dayPlanIndexOf(ordered, 'active')).toBe(1);
  });

  it('routes only a different activity-list index to Task.sortIndex reorder', () => {
    expect(activityReorderPayload({ from: 'list', taskId: 'task-b', index: 2 }, 0)).toEqual({
      fromIndex: 2,
      toIndex: 0,
    });
    expect(activityReorderPayload({ from: 'list', taskId: 'task-b', index: 2 }, 2)).toBeNull();
    expect(activityReorderPayload({ from: 'today', taskId: 'task-b', index: 2 }, 0)).toBeNull();
    expect(activityReorderPayload({ from: 'list', taskId: 'task-b' }, 0)).toBeNull();
  });

  it('drops the dragged row before or after the target instead of swapping places with it', () => {
    // [A,B,C,D] 拖 A(0) 落到 C(2) 上半：插到 C 前面，得到 [B,A,C,D]。
    expect(dropInsertIndex(0, 2, 'before')).toBe(1);
    // 落到 C 下半：插到 C 后面，得到 [B,C,A,D]。
    expect(dropInsertIndex(0, 2, 'after')).toBe(2);
    // 反方向：拖 D(3) 落到 B(1) 上半，插到 B 前面，得到 [A,D,B,C]。
    expect(dropInsertIndex(3, 1, 'before')).toBe(1);
    // 落到 B 下半：插到 B 后面，得到 [A,B,D,C]。
    expect(dropInsertIndex(3, 1, 'after')).toBe(2);
    // 落到自己原本紧邻的下一行前面 = 原地不动。
    expect(dropInsertIndex(1, 2, 'before')).toBe(1);
  });

  it('rejects an activity reorder that resolves to a no-op insert position', () => {
    // index1 拖到 index2 上半，插入点换算后等于自己原来的位置，视为无效拖拽。
    expect(activityReorderPayload({ from: 'list', taskId: 'task-b', index: 1 }, 2, 'before')).toBeNull();
    expect(activityReorderPayload({ from: 'list', taskId: 'task-b', index: 0 }, 2, 'after')).toEqual({
      fromIndex: 0,
      toIndex: 2,
    });
  });

  it('keeps manual and pomodoro completion sources visibly distinct', () => {
    expect(completionSourceLabel('manual')).toBe('手动完成');
    expect(completionSourceLabel('pomodoro')).toBe('番茄完成');
    expect(completionSourceLabel(null)).toBe('完成来源未知');
  });

  it('prefers the focus start~end range for pomodoro completion, falls back to completedAt for manual', () => {
    const pomodoroTiming = {
      timezone: 'Asia/Shanghai',
      focusStartedAt: '2027-04-04T09:01:00+08:00',
      focusEndedAt: '2027-04-04T09:26:00+08:00',
    };
    expect(completedTaskTimeLabel({ completedAt: '2027-04-04T09:27:00+08:00' }, pomodoroTiming))
      .toBe('2027.04.04 09:01~09:26');

    const manualTiming = { timezone: 'Asia/Shanghai', focusStartedAt: null, focusEndedAt: null };
    expect(completedTaskTimeLabel({ completedAt: '2027-04-04T08:01:00+08:00' }, manualTiming))
      .toBe('2027.04.04 08:01');

    expect(completedTaskTimeLabel({ completedAt: '2027-04-04T08:01:00+08:00' }, null)).toBe('');
    expect(completedTaskTimeLabel({ completedAt: null }, manualTiming)).toBe('');
  });

  it('offers only other active top-level Tasks as reparent targets without duplicates', () => {
    const selected = { ...task('selected', 'active', 1), parentId: null };
    const listParent = { ...task('list-parent', 'splitNeeded', 1), parentId: null };
    const todayParent = { ...task('today-parent', 'active', 1), parentId: null };
    const completed = { ...task('done', 'completed', 1), parentId: null };
    expect(availableParentTasks({
      activeTasks: [selected, listParent],
      todayTasks: [todayParent, completed, listParent],
    }, selected.id).map(({ id }) => id)).toEqual(['list-parent', 'today-parent']);
  });

  it('surfaces current children whose parent is absent from every current top-level section', () => {
    const attached = { ...task('attached', 'active', 1), parentId: 'visible', sortIndex: 1000 };
    const orphanDone = { ...task('orphan-done', 'completed', 1), parentId: 'archived-parent', sortIndex: 2000 };
    const orphanActive = { ...task('orphan-active', 'active', 1), parentId: 'archived-parent', sortIndex: 1000 };
    expect(unattachedSubtasks({
      activeTasks: [{ ...task('visible', 'active', 1), parentId: null }],
      todayTasks: [],
      completedTasks: [],
      subtasksByParentId: {
        visible: [attached],
        'archived-parent': [orphanDone, orphanActive],
      },
    }).map(({ id }) => id)).toEqual(['orphan-active', 'orphan-done']);
  });

  it('presents archived outcome, completion source, and lineage without inventing history', () => {
    expect(archivedTaskPresentation({
      outcome: 'split',
      archivedAt: '2026-12-09T01:00:00.000Z',
      completionSource: null,
      splitIndex: 2,
      splitFromTaskId: 'source',
    })).toEqual({
      outcomeLabel: '拆分归档',
      completionLabel: null,
      lineageLabel: '拆分 #2',
      archivedAt: '2026-12-09T01:00:00.000Z',
    });
  });

  it('allows estimate editing only for current Tasks with a remaining estimate round', () => {
    expect(canAdjustTaskEstimate({ status: 'active', estimateRounds: [{ index: 1 }] })).toBe(true);
    expect(canAdjustTaskEstimate({ status: 'splitNeeded', estimateRounds: [{ index: 1 }, { index: 2 }] })).toBe(true);
    expect(canAdjustTaskEstimate({ status: 'completed', estimateRounds: [{ index: 1 }] })).toBe(false);
    expect(canAdjustTaskEstimate({ status: 'active', estimateRounds: [{}, {}, {}] })).toBe(false);
  });

  it('flags a Task as running focus only when it matches the active focus session task id', () => {
    expect(isTaskRunningFocus({ id: 'a' }, 'a')).toBe(true);
    expect(isTaskRunningFocus({ id: 'a' }, 'b')).toBe(false);
    expect(isTaskRunningFocus({ id: 'a' }, null)).toBe(false);
  });

  it('enables sibling reorder only under a visible current parent', () => {
    const views = {
      activeTasks: [{ id: 'visible', status: 'active', parentId: null }],
      todayTasks: [],
      completedTasks: [],
    };
    expect(canReorderSubtasks(views, 'visible')).toBe(true);
    expect(canReorderSubtasks(views, 'archived-parent')).toBe(false);
  });

  it('treats archived children as retained hierarchy when deciding whether a Task may indent', () => {
    const views = {
      subtasksByParentId: { parent: [] },
      archivedTasks: [{ id: 'archived-child', parentId: 'parent', status: 'archived' }],
    };
    expect(hasRetainedChildren(views, 'parent')).toBe(true);
    expect(hasRetainedChildren(views, 'other')).toBe(false);
  });

  it('exposes the legal candidate domain for each batch action, including completed children', () => {
    const list = { id: 'list', status: 'active' };
    const today = { id: 'today', status: 'splitNeeded' };
    const done = { id: 'done', status: 'completed' };
    const child = { id: 'child', status: 'completed', parentId: 'parent' };
    const views = {
      activeTasks: [list],
      todayTasks: [today, done],
      completedTasks: [done],
      subtasksByParentId: { parent: [child], duplicate: [child] },
    };
    expect(batchCandidates(views, 'addToToday')).toEqual([list]);
    expect(batchCandidates(views, 'moveToList')).toEqual([today]);
    expect(batchCandidates(views, 'archiveCompleted')).toEqual([done, child]);
  });

  it('validates one split successor draft and keeps failed plus unattempted retry order', () => {
    expect(splitDraftValid('下一步', '2')).toBe(true);
    expect(splitDraftValid('', '2')).toBe(false);
    expect(splitDraftValid('下一步', '8')).toBe(false);
    expect(batchRetryIds({
      failed: [{ taskId: 'failed' }],
      notAttempted: ['later-1', 'later-2'],
    })).toEqual(['failed', 'later-1', 'later-2']);
  });

  it('reconciles stale selections and presents each failed or unattempted Task in retry order', () => {
    expect(reconcileBatchSelection(['gone', 'valid-2', 'valid-1'], [
      { id: 'valid-1' }, { id: 'valid-2' },
    ])).toEqual(['valid-2', 'valid-1']);
    expect(batchResultPresentation({
      succeeded: [{ taskId: 'ok' }],
      failed: [{ taskId: 'failed', message: '运行时失败' }],
      notAttempted: ['later'],
    }, [
      { id: 'failed', title: '失败任务' },
      { id: 'later', title: '稍后任务' },
    ])).toEqual({
      failed: [{ taskId: 'failed', title: '失败任务', message: '运行时失败' }],
      notAttempted: [{ taskId: 'later', title: '稍后任务' }],
    });
  });

  it('derives reload-stable split source and successor links from retained Task facts', () => {
    const source = { id: 'source-123456', title: '原任务', outcome: 'split', splitFromTaskId: null, splitIndex: 0 };
    const successor = { id: 'next-123456', title: '后继任务', outcome: null, splitFromTaskId: source.id, splitIndex: 1 };
    expect(splitLineagePresentation(source, [source, successor])).toEqual({
      relation: 'source',
      task: successor,
      label: '后继：后继任务 · 拆分 #1 · next-123…',
    });
    expect(splitLineagePresentation(successor, [source, successor])).toEqual({
      relation: 'successor',
      task: source,
      label: '源自：原任务 · source-1…',
    });
  });
});

describe('合并番茄钟视图模型', () => {
  const group = { id: 'g1', taskIds: ['a', 'b'], estimatedPomodoros: 1, status: 'active' };
  const member = (id, overrides = {}) => ({
    id, title: id, status: 'active', mergeGroupId: 'g1', ...overrides,
  });
  const views = {
    mergeGroups: [group],
    mergeGroupMembersById: { g1: [member('a'), member('b')] },
    mergeGroupRemainingById: { g1: 1 },
    hasFocusHistoryByTaskId: {},
  };

  it('dropIntent：正中间是合并，上下缘是排序', () => {
    expect(dropIntent(2, 40)).toBe('before');
    expect(dropIntent(20, 40)).toBe('merge');
    expect(dropIntent(38, 40)).toBe('after');
    expect(dropIntent(0, 0)).toBe('before');
  });

  it('foldMergeRows：同组成员收进一张卡，卡落在第一个成员的位置', () => {
    const solo = { id: 'c', title: 'c', status: 'active', mergeGroupId: null };
    const rows = foldMergeRows([solo, member('a'), member('b')], views);
    expect(rows.map((row) => row.kind)).toEqual(['task', 'merge']);
    expect(rows[1].key).toBe('g1');
    expect(rows[1].members.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('foldMergeRows：组已解散但视图没刷新到时，按独立任务渲染而不是吞掉这一行', () => {
    const rows = foldMergeRows([member('a')], { ...views, mergeGroups: [] });
    expect(rows).toEqual([{ kind: 'task', key: 'a', task: member('a') }]);
  });

  it('mergeIneligibleReason：计时过、已在别组、非 active 都拒绝', () => {
    const fresh = { id: 'x', status: 'active', mergeGroupId: null };
    expect(mergeIneligibleReason(fresh, views)).toBeNull();
    expect(mergeIneligibleReason(fresh, { ...views, hasFocusHistoryByTaskId: { x: true } }))
      .toContain('已经计时过');
    expect(mergeIneligibleReason({ ...fresh, mergeGroupId: 'g9' }, views)).toContain('另一个合并组');
    expect(mergeIneligibleReason({ ...fresh, status: 'completed' }, views)).toContain('进行中');
  });

  it('mergeCardSummary：进度与硬上限阻断标记', () => {
    const summary = mergeCardSummary(group, [member('a', { status: 'completed' }), member('b')], 1);
    expect(summary.progressLabel).toBe('1 / 2 已完成');
    expect(summary.estimateLabel).toBe('整组 1 个番茄');
    expect(summary.blocked).toBe(false);
    expect(mergeCardSummary({ ...group, status: 'limitReached' }, [], 0).blocked).toBe(true);
  });

  it('开轮门槛：未完成成员不足 2 个不能再开合并轮', () => {
    const active = { status: 'active' };
    expect(canStartMergeGroup(active, [member('a'), member('b')])).toBe(true);
    expect(canStartMergeGroup(active, [member('a', { status: 'completed' }), member('b')])).toBe(false);
    expect(canStartMergeGroup({ status: 'limitReached' }, [member('a'), member('b')])).toBe(false);
    expect(currentMergeMember([member('a', { status: 'completed' }), member('b')])?.id).toBe('b');
  });

  it('成员都完成后仍把组合并组露出来，避免确认入口消失', () => {
    const doneViews = {
      ...views,
      mergeGroupMembersById: { g1: [member('a', { status: 'completed' }), member('b', { status: 'completed' })] },
    };
    const leftover = completedOnlyMergeRows([], doneViews);
    expect(leftover).toHaveLength(1);
    expect(leftover[0].key).toBe('g1');
    expect(completedOnlyMergeRows([{ kind: 'merge', key: 'g1' }], doneViews)).toEqual([]);
  });
});
