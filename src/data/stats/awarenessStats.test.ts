import { describe, expect, it } from 'vitest';
import {
  makeDayPlan,
  makeEnergyRecord,
  makeEvent,
  makeMergeGroup,
  makeSession,
  makeSettings,
  makeTask,
  type Event,
  type MergeGroup,
  type Session,
  type Task,
} from '../schema';
import { makeStatsRange } from './dateRange';
import { aggregateAwarenessStats } from './awarenessStats';

const ZONE = 'Asia/Shanghai';
const NOW = '2026-06-01T08:00:00+08:00';

function task(id: string, title: string, estimatedPomodoros: number, overrides: Partial<Task> = {}): Task {
  return makeTask({ id, now: NOW, title, estimatedPomodoros, ...overrides });
}

function completedFocus(id: string, taskId: string, startedAt = NOW, actualDuration = 100): Session {
  return makeSession({
    id, now: startedAt, startedAt, timezone: ZONE, type: 'focus', status: 'completed',
    taskIds: [taskId], endedAt: startedAt, plannedDuration: 1500, actualDuration, pomodoroIndex: 1,
  });
}

function completedEvent(
  id: string,
  sourceTask: Task,
  completionSource: 'manual' | 'pomodoro',
  validFocusCountAtCompletion: number | null,
  occurredAt = NOW,
): Event {
  return makeEvent({
    id, now: occurredAt, occurredAt, timezone: ZONE, type: 'task.completed', taskId: sourceTask.id,
    payload: {
      completionSource,
      completedAt: occurredAt,
      validFocusCountAtCompletion,
    },
  } as never);
}

/** 一条正常完成的合并 focus，附带按成员切好的分段。 */
function mergedFocus(
  id: string,
  mergeGroupId: string,
  segments: ReadonlyArray<{ taskId: string; actualDuration: number }>,
  { status = 'completed' as 'completed' | 'discarded', startedAt = NOW } = {},
): Session {
  return makeSession({
    id, now: startedAt, startedAt, timezone: ZONE, type: 'focus', status,
    taskIds: segments.map(({ taskId }) => taskId),
    mergeGroupId,
    taskSegments: segments.map(({ taskId, actualDuration }) => ({
      taskId, startedAt, endedAt: startedAt, actualDuration,
    })),
    endedAt: startedAt,
    plannedDuration: 1500,
    actualDuration: segments.reduce((sum, { actualDuration }) => sum + actualDuration, 0),
    pomodoroIndex: 1,
  });
}

const inputBase = () => ({
  tasks: [] as Task[],
  sessions: [] as Session[],
  events: [] as Event[],
  energyRecords: [],
  dayPlans: [],
  mergeGroups: [] as MergeGroup[],
  settings: makeSettings({ now: NOW }),
  range: makeStatsRange('day', '2026-06-01'),
});

describe('Phase 3 S3b task, energy, interrupt, and budget aggregation', () => {
  it('uses Session facts for Task focus and completion snapshots for strict estimate samples', () => {
    const accurate = task('accurate', '准确', 2);
    const over = task('over', '偏大', 3);
    const under = task('under', '偏小', 1);
    const adjusted = task('adjusted', '调整后相等', 3, {
      estimateRounds: [
        { index: 1, pomodoros: 2, occurredAt: NOW },
        { index: 2, pomodoros: 3, occurredAt: NOW },
      ],
    });
    const manual = task('manual', '手动', 2);
    const emptyRounds = task('empty', '无预估轮次', 2, { estimateRounds: [] });
    const deleted = task('deleted', '已删除', 1, { deletedAt: NOW });
    const sessions = [
      completedFocus('a-today', accurate.id),
      completedFocus('a-history', accurate.id, '2026-05-31T08:00:00+08:00'),
      makeSession({
        id: 'a-extra', now: NOW, startedAt: NOW, timezone: ZONE, type: 'extraFocus', status: 'completed',
        taskIds: [accurate.id], endedAt: NOW, actualDuration: 50, originIntervalId: 'interval',
      }),
      makeSession({
        id: 'a-discard', now: NOW, startedAt: NOW, timezone: ZONE, type: 'focus', status: 'discarded',
        taskIds: [accurate.id], endedAt: NOW, plannedDuration: 1500, actualDuration: 20, pomodoroIndex: 3,
      }),
      completedFocus('deleted-focus', deleted.id),
    ];
    const events = [
      completedEvent('complete-accurate', accurate, 'pomodoro', 2),
      completedEvent('complete-over', over, 'pomodoro', 2),
      completedEvent('complete-under', under, 'pomodoro', 2),
      completedEvent('complete-adjusted', adjusted, 'pomodoro', 2),
      completedEvent('complete-manual', manual, 'manual', 0),
      completedEvent('complete-empty', emptyRounds, 'pomodoro', 2),
      completedEvent('complete-deleted', deleted, 'pomodoro', 1),
      completedEvent('complete-null', accurate, 'pomodoro', null),
    ];
    const stats = aggregateAwarenessStats({
      ...inputBase(),
      tasks: [accurate, over, under, adjusted, manual, emptyRounds, deleted],
      sessions,
      events,
    });

    expect(stats.tasks.find(({ taskId }) => taskId === accurate.id)).toMatchObject({
      validFocusInRange: 1,
      historicalValidFocus: 2,
      standardSeconds: 100,
      extraSeconds: 50,
      discardedSeconds: 20,
      totalSeconds: 170,
    });
    expect(stats.tasks.some(({ taskId }) => taskId === deleted.id)).toBe(false);
    expect(stats.completions).toEqual({ total: 7, manual: 1, pomodoro: 6 });
    expect(stats.estimates).toMatchObject({
      sampleCount: 4,
      accurate: 1,
      overestimated: 1,
      underestimated: 1,
      adjustedInaccurate: 1,
      accuracyRate: 0.25,
    });
  });

  it('keeps all energy points, zero-fills daily averages, and derives recovery only by Session links', () => {
    const sourceFocus = completedFocus('energy-focus', 'task');
    const shortBreak = makeSession({
      id: 'short', now: '2026-06-01T08:30:00+08:00', startedAt: '2026-06-01T08:30:00+08:00',
      timezone: ZONE, type: 'shortBreak', status: 'completed', endedAt: '2026-06-01T08:35:00+08:00',
      plannedDuration: 300, actualDuration: 300, sourceFocusSessionId: sourceFocus.id, actualRest: 'walk',
    });
    const longBreak = makeSession({
      id: 'long', now: '2026-06-02T08:30:00+08:00', startedAt: '2026-06-02T08:30:00+08:00',
      timezone: ZONE, type: 'longBreak', status: 'completed', endedAt: '2026-06-02T08:45:00+08:00',
      plannedDuration: 900, actualDuration: 900, sourceFocusSessionId: sourceFocus.id, actualRest: null,
    });
    const records = [
      makeEnergyRecord({ id: 'before', now: NOW, occurredAt: NOW, timezone: ZONE, source: 'afterFocus', sessionId: sourceFocus.id, energyLevel: 4 }),
      makeEnergyRecord({ id: 'after', now: '2026-06-01T08:35:00+08:00', occurredAt: '2026-06-01T08:35:00+08:00', timezone: ZONE, source: 'afterShortBreak', sessionId: shortBreak.id, energyLevel: 7 }),
      makeEnergyRecord({ id: 'manual', now: '2026-06-01T08:36:00+08:00', occurredAt: '2026-06-01T08:36:00+08:00', timezone: ZONE, source: 'manual', energyLevel: 10 }),
      makeEnergyRecord({ id: 'deleted-after', now: '2026-06-02T08:45:00+08:00', occurredAt: '2026-06-02T08:45:00+08:00', timezone: ZONE, source: 'afterLongBreak', sessionId: longBreak.id, energyLevel: 9, deletedAt: NOW }),
    ];
    const stats = aggregateAwarenessStats({
      ...inputBase(), sessions: [sourceFocus, shortBreak, longBreak], energyRecords: records,
      range: makeStatsRange('week', '2026-06-03'),
    });
    expect(stats.energy.timeline.map(({ energyLevel, localTime }) => [energyLevel, localTime])).toEqual([
      [4, '08:00'], [7, '08:35'], [10, '08:36'],
    ]);
    expect(stats.energy.dailyTrend[0]).toMatchObject({ appDate: '2026-06-01', averageEnergy: 7, sampleCount: 3 });
    expect(stats.energy.dailyTrend[2]).toMatchObject({ appDate: '2026-06-03', averageEnergy: null, sampleCount: 0 });
    expect(stats.recovery.shortBreak).toEqual({ usageCount: 1, validSampleCount: 1, missingSampleCount: 0, averageDelta: 3 });
    expect(stats.recovery.longBreak).toEqual({ usageCount: 1, validSampleCount: 0, missingSampleCount: 1, averageDelta: null });
    expect(stats.recovery.samples).toEqual([
      { breakSessionId: shortBreak.id, type: 'shortBreak', actualRest: 'walk', delta: 3 },
      { breakSessionId: longBreak.id, type: 'longBreak', actualRest: null, delta: null },
    ]);
    expect('recoveryDelta' in records[0]!).toBe(false);
  });

  it('rejects recovery samples when break, source focus, or linked Energy facts are deleted/missing', () => {
    const liveFocus = completedFocus('live-source', 'task');
    const deletedFocus = completedFocus('deleted-source', 'task');
    deletedFocus.deletedAt = NOW;
    const makeBreak = (id: string, sourceFocusSessionId: string) => makeSession({
      id, now: '2026-06-01T09:00:00+08:00', startedAt: '2026-06-01T09:00:00+08:00',
      timezone: ZONE, type: 'shortBreak', status: 'completed', endedAt: '2026-06-01T09:05:00+08:00',
      plannedDuration: 300, actualDuration: 300, sourceFocusSessionId,
    });
    const deletedBreak = makeBreak('deleted-break', liveFocus.id);
    deletedBreak.deletedAt = NOW;
    const deletedSourceBreak = makeBreak('deleted-source-break', deletedFocus.id);
    const missingBeforeBreak = makeBreak('missing-before-break', liveFocus.id);
    const records = [
      makeEnergyRecord({ id: 'deleted-source-before', now: NOW, occurredAt: NOW, timezone: ZONE, source: 'afterFocus', sessionId: deletedFocus.id, energyLevel: 4 }),
      makeEnergyRecord({ id: 'deleted-source-after', now: NOW, occurredAt: NOW, timezone: ZONE, source: 'afterShortBreak', sessionId: deletedSourceBreak.id, energyLevel: 8 }),
      makeEnergyRecord({ id: 'deleted-live-before', now: NOW, occurredAt: NOW, timezone: ZONE, source: 'afterFocus', sessionId: liveFocus.id, energyLevel: 5, deletedAt: NOW }),
      makeEnergyRecord({ id: 'missing-before-after', now: NOW, occurredAt: NOW, timezone: ZONE, source: 'afterShortBreak', sessionId: missingBeforeBreak.id, energyLevel: 7 }),
    ];
    const stats = aggregateAwarenessStats({
      ...inputBase(),
      sessions: [liveFocus, deletedFocus, deletedBreak, deletedSourceBreak, missingBeforeBreak],
      energyRecords: records,
    });
    expect(stats.recovery.shortBreak).toEqual({
      usageCount: 2, validSampleCount: 0, missingSampleCount: 2, averageDelta: null,
    });
  });

  it('counts only interrupts with visible standard focus, but excludes discarded focus from per-pomodoro average', () => {
    const done = completedFocus('done-focus', 'task', '2026-06-01T01:00:00+08:00');
    const discarded = makeSession({
      id: 'discarded-focus', now: '2026-06-01T05:00:00+08:00', startedAt: '2026-06-01T05:00:00+08:00',
      timezone: ZONE, type: 'focus', status: 'discarded', taskIds: ['task'], endedAt: NOW,
      plannedDuration: 1500, actualDuration: 1, pomodoroIndex: 2,
    });
    const deleted = completedFocus('deleted-focus', 'task', NOW);
    deleted.deletedAt = NOW;
    const interrupt = (id: string, type: 'interrupt.internal' | 'interrupt.external', sessionId: string, occurredAt: string) =>
      makeEvent({ id, now: occurredAt, occurredAt, timezone: ZONE, type, taskId: 'task', sessionId, payload: { offsetSeconds: 1, note: null } });
    const events = [
      interrupt('i1', 'interrupt.internal', done.id, '2026-06-01T01:05:00+08:00'),
      interrupt('i2', 'interrupt.external', done.id, '2026-06-01T05:05:00+08:00'),
      interrupt('i3', 'interrupt.internal', discarded.id, '2026-06-01T09:05:00+08:00'),
      interrupt('i4', 'interrupt.external', deleted.id, '2026-06-01T13:05:00+08:00'),
      interrupt('i5', 'interrupt.external', 'missing', '2026-06-01T17:05:00+08:00'),
    ];
    const stats = aggregateAwarenessStats({ ...inputBase(), sessions: [done, discarded, deleted], events });
    expect(stats.interrupts.summary).toEqual({
      total: 3, internal: 2, external: 1,
      perValidPomodoro: 2, internalPerValidPomodoro: 1, externalPerValidPomodoro: 1,
    });
    expect(stats.interrupts.timeDistribution).toEqual([
      { label: '00–03', internal: 1, external: 0 },
      { label: '04–07', internal: 0, external: 1 },
      { label: '08–11', internal: 1, external: 0 },
      { label: '12–15', internal: 0, external: 0 },
      { label: '16–19', internal: 0, external: 0 },
      { label: '20–23', internal: 0, external: 0 },
    ]);
    const noCompleted = aggregateAwarenessStats({
      ...inputBase(), sessions: [discarded], events: [events[2]!],
    });
    expect(noCompleted.interrupts.summary).toMatchObject({
      total: 1,
      perValidPomodoro: null,
      internalPerValidPomodoro: null,
      externalPerValidPomodoro: null,
    });
  });

  it('derives DayPlan budget usage by stored appDate and returns null for zero/missing/deleted budgets', () => {
    const sessions = [
      completedFocus('budget-1', 'task'),
      completedFocus('budget-2', 'task', '2026-06-01T09:00:00+08:00'),
    ];
    const plan = makeDayPlan({ now: NOW, timezone: ZONE, appDayStartOffsetMinutes: 0, budgetPomodoros: 4 });
    const zero = makeDayPlan({ now: '2026-06-02T08:00:00+08:00', timezone: ZONE, appDayStartOffsetMinutes: 0, budgetPomodoros: 0 });
    const deleted = makeDayPlan({ now: '2026-06-03T08:00:00+08:00', timezone: ZONE, appDayStartOffsetMinutes: 0, budgetPomodoros: 4, deletedAt: NOW });
    const stats = aggregateAwarenessStats({
      ...inputBase(), sessions, dayPlans: [plan, zero, deleted], range: makeStatsRange('week', '2026-06-03'),
    });
    expect(stats.budget.dailyTrend.slice(0, 4)).toEqual([
      { appDate: '2026-06-01', budgetPomodoros: 4, validPomodoros: 2, usageRate: 0.5 },
      { appDate: '2026-06-02', budgetPomodoros: 0, validPomodoros: 0, usageRate: null },
      { appDate: '2026-06-03', budgetPomodoros: null, validPomodoros: 0, usageRate: null },
      { appDate: '2026-06-04', budgetPomodoros: null, validPomodoros: 0, usageRate: null },
    ]);
  });
});

describe('合并番茄的统计口径（§8.5，红线 24–26）', () => {
  const groupId = '01900000-0000-7000-8000-0000000000aa';
  const group = () => makeMergeGroup({ id: groupId, now: NOW, taskIds: ['a', 'b'], title: '杂事番茄' });

  it('番茄归合并组、时间归成员：成员各记 0 个有效番茄，只拿自己那段耗时', () => {
    const [a, b] = [task('a', 'A', 1), task('b', 'B', 1)];
    // 一段 1500 秒的合并专注，A 占 500 秒、B 占 1000 秒。
    const session = mergedFocus('s1', groupId, [
      { taskId: 'a', actualDuration: 500 },
      { taskId: 'b', actualDuration: 1000 },
    ]);

    const stats = aggregateAwarenessStats({
      ...inputBase(), tasks: [a, b], sessions: [session], mergeGroups: [group()],
    });

    // 成员：番茄 0，时长只算自己那段——绝不是每人各记一遍整段 1500。
    expect(stats.tasks.map((t) => [t.taskId, t.validFocusInRange, t.standardSeconds])).toEqual([
      ['a', 0, 500],
      ['b', 0, 1000],
    ]);
    // 合并组：番茄 1，整段 1500 秒归它。
    expect(stats.mergeGroups).toMatchObject([
      { mergeGroupId: groupId, title: '杂事番茄', validFocusInRange: 1, standardSeconds: 1500 },
    ]);
  });

  it('任务维度加总不再大于全局：成员分段之和 = 合并组整段时长', () => {
    const [a, b] = [task('a', 'A', 1), task('b', 'B', 1)];
    const sessions = [
      mergedFocus('s1', groupId, [
        { taskId: 'a', actualDuration: 180 },
        { taskId: 'b', actualDuration: 1320 },
      ]),
      mergedFocus('s2', groupId, [
        { taskId: 'a', actualDuration: 420 },
        { taskId: 'b', actualDuration: 1080 },
      ]),
    ];

    const stats = aggregateAwarenessStats({
      ...inputBase(), tasks: [a, b], sessions, mergeGroups: [group()],
    });

    const memberSeconds = stats.tasks.reduce((sum, t) => sum + t.standardSeconds, 0);
    const groupSeconds = stats.mergeGroups[0]!.standardSeconds;
    expect(memberSeconds).toBe(groupSeconds);
    expect(groupSeconds).toBe(3000);
    // 跨两轮，合并组番茄数 2；成员无论横跨多少轮仍是 0。
    expect(stats.mergeGroups[0]!.validFocusInRange).toBe(2);
    expect(stats.tasks.every((t) => t.validFocusInRange === 0)).toBe(true);
  });

  it('作废的合并 focus 只按分段计作废时长，不给任何维度记有效番茄', () => {
    const [a, b] = [task('a', 'A', 1), task('b', 'B', 1)];
    const session = mergedFocus('s1', groupId, [
      { taskId: 'a', actualDuration: 240 },
      { taskId: 'b', actualDuration: 360 },
    ], { status: 'discarded' });

    const stats = aggregateAwarenessStats({
      ...inputBase(), tasks: [a, b], sessions: [session], mergeGroups: [group()],
    });

    expect(stats.tasks.map((t) => [t.discardedSeconds, t.validFocusInRange])).toEqual([
      [240, 0],
      [360, 0],
    ]);
    expect(stats.mergeGroups[0]).toMatchObject({
      validFocusInRange: 0,
      discardedSeconds: 600,
      standardSeconds: 0,
    });
  });

  it('合并成员完成不进 Task 预估准确率样本——pomodoro 不等于它有有效番茄', () => {
    const member = task('a', 'A', 1);
    const session = mergedFocus('s1', groupId, [
      { taskId: 'a', actualDuration: 500 },
      { taskId: 'b', actualDuration: 1000 },
    ]);
    /*
     * 合法且预期的组合：completionSource='pomodoro' + validFocusCountAtCompletion=0。
     * 留在样本里会被算成"预估 1、实到 0 → 预估偏大"，纯属误判。
     */
    const completion = makeEvent({
      id: 'e1', now: NOW, occurredAt: NOW, timezone: ZONE, type: 'task.completed',
      taskId: 'a', sessionId: 's1',
      payload: { completionSource: 'pomodoro', completedAt: NOW, validFocusCountAtCompletion: 0 },
    } as never);

    const stats = aggregateAwarenessStats({
      ...inputBase(), tasks: [member], sessions: [session], events: [completion],
      mergeGroups: [group()],
    });

    expect(stats.estimates.sampleCount).toBe(0);
    expect(stats.estimates.overestimated).toBe(0);
    // 但它仍然计入"番茄完成"的任务数——确实是在番茄流程里完成的。
    expect(stats.completions.pomodoro).toBe(1);
  });

  it('MergeGroup 预估准确率复用独立 Task 那套算法，不另写一份', () => {
    const completion = makeEvent({
      id: 'e1', now: NOW, occurredAt: NOW, timezone: ZONE, type: 'mergeGroup.completed',
      mergeGroupId: groupId,
      payload: { completedAt: NOW, validFocusCountAtCompletion: 1 },
    } as never);

    const stats = aggregateAwarenessStats({
      ...inputBase(), mergeGroups: [group()], events: [completion],
    });

    // 首轮估 1、实际就用了 1 个 → 估准，判据与 Task 完全一致。
    expect(stats.mergeGroupEstimates).toMatchObject({
      sampleCount: 1, accurate: 1, overestimated: 0, underestimated: 0, accuracyRate: 1,
    });
  });
});
