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
  completionSourceLabel,
  currentPlanMetrics,
  dayPlanIndexOf,
  splitTodayTasks,
  hasRetainedChildren,
  splitDraftValid,
  splitLineagePresentation,
  reconcileBatchSelection,
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

  it('keeps manual and pomodoro completion sources visibly distinct', () => {
    expect(completionSourceLabel('manual')).toBe('手动完成');
    expect(completionSourceLabel('pomodoro')).toBe('番茄完成');
    expect(completionSourceLabel(null)).toBe('完成来源未知');
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
