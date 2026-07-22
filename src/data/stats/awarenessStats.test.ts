import { describe, expect, it } from 'vitest';
import {
  makeDayPlan,
  makeEnergyRecord,
  makeEvent,
  makeSession,
  makeSettings,
  makeTask,
  type Event,
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
    taskId, endedAt: startedAt, plannedDuration: 1500, actualDuration, pomodoroIndex: 1,
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

const inputBase = () => ({
  tasks: [] as Task[],
  sessions: [] as Session[],
  events: [] as Event[],
  energyRecords: [],
  dayPlans: [],
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
        taskId: accurate.id, endedAt: NOW, actualDuration: 50, originIntervalId: 'interval',
      }),
      makeSession({
        id: 'a-discard', now: NOW, startedAt: NOW, timezone: ZONE, type: 'focus', status: 'discarded',
        taskId: accurate.id, endedAt: NOW, plannedDuration: 1500, actualDuration: 20, pomodoroIndex: 3,
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
      timezone: ZONE, type: 'focus', status: 'discarded', taskId: 'task', endedAt: NOW,
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
