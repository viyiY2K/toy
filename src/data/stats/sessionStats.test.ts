import { describe, expect, it } from 'vitest';
import { makeEvent, makeSession, makeSettings, makeUnresolvedInterval, type Session } from '../schema';
import { makeStatsRange } from './dateRange';
import { aggregateSessionStats } from './sessionStats';

const ZONE = 'Asia/Shanghai';
const base = '2026-06-01T08:00:00+08:00';

function focus(id: string, minute: number, overrides: Partial<Session> = {}): Session {
  const startedAt = `2026-06-01T08:${String(minute).padStart(2, '0')}:00+08:00`;
  return makeSession({
    id,
    now: startedAt,
    startedAt,
    timezone: ZONE,
    type: 'focus',
    status: 'completed',
    taskId: 'task',
    endedAt: `2026-06-01T08:${String(minute + 1).padStart(2, '0')}:00+08:00`,
    plannedDuration: 1500,
    actualDuration: 100,
    pomodoroIndex: minute + 1,
    ...overrides,
  });
}

function standardBreak(
  id: string,
  source: Session,
  type: 'shortBreak' | 'longBreak',
  status: 'completed' | 'skipped',
  skipKind: Session['skipKind'] = null,
): Session {
  const startedAt = source.endedAt!;
  return makeSession({
    id,
    now: startedAt,
    startedAt,
    timezone: ZONE,
    type,
    status,
    endedAt: startedAt,
    plannedDuration: type === 'shortBreak' ? 300 : 900,
    actualDuration: status === 'completed' ? (type === 'shortBreak' ? 30 : 90) : 0,
    sourceFocusSessionId: source.id,
    skipKind,
  });
}

describe('Phase 3 S3a session aggregation', () => {
  it('separates focus/rest facts and distinguishes completed, four skipped kinds, missing, and workEnded', () => {
    const focuses = Array.from({ length: 8 }, (_, index) => focus(`f${index + 1}`, index * 2));
    const sessions: Session[] = [
      ...focuses,
      standardBreak('b1', focuses[0]!, 'shortBreak', 'completed'),
      standardBreak('b2', focuses[1]!, 'shortBreak', 'skipped', 'explicitSkip'),
      standardBreak('b3', focuses[2]!, 'shortBreak', 'skipped', 'noResponse'),
      standardBreak('b4', focuses[3]!, 'longBreak', 'completed'),
      standardBreak('b5', focuses[4]!, 'shortBreak', 'skipped', 'missed'),
      standardBreak('b6', focuses[5]!, 'shortBreak', 'skipped', 'appClosed'),
      makeSession({
        id: 'discarded', now: base, startedAt: base, timezone: ZONE, type: 'focus',
        status: 'discarded', taskId: 'task', endedAt: base, plannedDuration: 1500,
        actualDuration: 40, pomodoroIndex: 20,
      }),
      makeSession({
        id: 'extra-focus', now: base, startedAt: base, timezone: ZONE, type: 'extraFocus',
        status: 'completed', taskId: 'task', endedAt: base, actualDuration: 50,
        originIntervalId: 'interval-focus',
      }),
      makeSession({
        id: 'extra-rest', now: base, startedAt: base, timezone: ZONE, type: 'extraRest',
        status: 'completed', endedAt: base, actualDuration: 70, originIntervalId: 'interval-rest',
      }),
    ];
    const workEnded = makeEvent({
      id: 'work-ended', now: base, timezone: ZONE, type: 'dayPlan.workEnded',
      sessionId: focuses[7]!.id, dayPlanId: 'plan',
      payload: { appDate: '2026-06-01', localDate: '2026-06-01', endedAfterFocusSessionId: focuses[7]!.id, reason: 'userEndedWork' },
    });
    const stats = aggregateSessionStats({
      sessions,
      events: [workEnded],
      settings: makeSettings({ now: base, lifetimePomodoroBaseline: 7 }),
      range: makeStatsRange('day', '2026-06-01'),
    });

    expect(stats.focus).toEqual({
      validPomodoros: 8,
      standardSeconds: 800,
      extraSeconds: 50,
      discardedSeconds: 40,
      totalSeconds: 890,
    });
    expect(stats.completeCycles).toBe(2);
    expect(stats.rest).toMatchObject({
      shortBreakSeconds: 30,
      longBreakSeconds: 90,
      extraRestSeconds: 70,
      standardBreakCompleted: 2,
      skipped: { explicitSkip: 1, noResponse: 1, missed: 1, appClosed: 1 },
      workEndedExemptions: 1,
      expectedBreaks: 7,
      expectedByType: { shortBreak: 6, longBreak: 1 },
      missingBreaks: 1,
      completionRate: 2 / 7,
      explicitSkipRate: 1 / 7,
    });
    expect(stats.lifetime).toEqual({
      baselineCompleteCycles: 7,
      inToolCompleteCycles: 2,
      totalCompleteCycles: 9,
      focusSeconds: 890,
    });
  });

  it('enforces continuity: later standard focus and skipped closure prevent backfilling, extraFocus does not', () => {
    const first = focus('first', 0);
    const next = focus('next', 2);
    const delayedBreak = standardBreak('delayed', first, 'shortBreak', 'completed');
    delayedBreak.startedAt = '2026-06-01T08:04:00+08:00';
    delayedBreak.endedAt = delayedBreak.startedAt;
    const third = focus('third', 6);
    const extra = makeSession({
      id: 'extra', now: third.endedAt!, startedAt: third.endedAt!, timezone: ZONE,
      type: 'extraFocus', status: 'completed', taskId: 'task', endedAt: third.endedAt!,
      actualDuration: 1, originIntervalId: 'interval',
    });
    const thirdBreak = standardBreak('third-break', third, 'shortBreak', 'completed');
    thirdBreak.startedAt = '2026-06-01T08:08:00+08:00';
    thirdBreak.endedAt = thirdBreak.startedAt;
    const fourth = focus('fourth', 10);
    const skipped = standardBreak('closed', fourth, 'longBreak', 'skipped', 'explicitSkip');
    const backfilled = standardBreak('backfilled', fourth, 'longBreak', 'completed');
    backfilled.startedAt = '2026-06-01T08:14:00+08:00';
    backfilled.endedAt = backfilled.startedAt;

    const stats = aggregateSessionStats({
      sessions: [first, next, delayedBreak, third, extra, thirdBreak, fourth, skipped, backfilled],
      events: [],
      settings: makeSettings({ now: base }),
      range: makeStatsRange('day', '2026-06-01'),
    });
    expect(stats.completeCycles).toBe(1);
  });

  it('uses focus appDate for cycles but break appDate for rest counts and respects offset', () => {
    const crossFocus = makeSession({
      id: 'cross-focus', now: '2026-05-31T23:50:00+08:00', startedAt: '2026-05-31T23:50:00+08:00',
      timezone: ZONE, type: 'focus', status: 'completed', taskId: 'task',
      endedAt: '2026-06-01T00:05:00+08:00', plannedDuration: 1500, actualDuration: 900, pomodoroIndex: 1,
    });
    const crossBreak = makeSession({
      id: 'cross-break', now: '2026-06-01T00:10:00+08:00', startedAt: '2026-06-01T00:10:00+08:00',
      timezone: ZONE, type: 'shortBreak', status: 'completed', endedAt: '2026-06-01T00:15:00+08:00',
      plannedDuration: 300, actualDuration: 300, sourceFocusSessionId: crossFocus.id,
    });
    const settings = makeSettings({ now: base, appDayStartOffsetMinutes: 0 });
    const may = aggregateSessionStats({ sessions: [crossFocus, crossBreak], events: [], settings, range: makeStatsRange('day', '2026-05-31') });
    const june = aggregateSessionStats({ sessions: [crossFocus, crossBreak], events: [], settings, range: makeStatsRange('day', '2026-06-01') });
    expect(may.completeCycles).toBe(1);
    expect(may.rest.standardBreakCompleted).toBe(0);
    expect(june.completeCycles).toBe(0);
    expect(june.rest.standardBreakCompleted).toBe(1);

    const shifted = aggregateSessionStats({
      sessions: [makeSession({ ...crossBreak, id: 'shifted', now: crossBreak.createdAt })],
      events: [], settings: makeSettings({ now: base, appDayStartOffsetMinutes: 240 }),
      range: makeStatsRange('day', '2026-05-31'),
    });
    expect(shifted.rest.standardBreakCompleted).toBe(1);
  });

  it('excludes tombstones and leaves an ignored interval without generated Sessions out of stats', () => {
    const deletedFocus = focus('deleted-focus', 0, { deletedAt: base });
    const liveFocus = focus('live-focus', 2);
    const deletedBreak = standardBreak('deleted-break', liveFocus, 'shortBreak', 'completed');
    deletedBreak.deletedAt = base;
    const ignored = makeUnresolvedInterval({
      id: 'ignored', now: base, startedAt: base, endedAt: '2026-06-01T09:00:00+08:00',
      timezone: ZONE, source: 'appReopened', status: 'ignored', ignoredAt: base,
    });
    expect(ignored.status).toBe('ignored');
    const stats = aggregateSessionStats({
      sessions: [deletedFocus, liveFocus, deletedBreak], events: [], settings: makeSettings({ now: base }),
      range: makeStatsRange('day', '2026-06-01'),
    });
    expect(stats.focus.validPomodoros).toBe(1);
    expect(stats.completeCycles).toBe(0);
    expect(stats.rest).toMatchObject({ standardBreakSeconds: 0, standardBreakCompleted: 0, missingBreaks: 1 });
    expect(stats.lifetime.focusSeconds).toBe(100);
  });

  it('zero-fills weekly trend days and returns null rather than 0 for empty ratio denominators', () => {
    const only = focus('weekly-focus', 0);
    const stats = aggregateSessionStats({
      sessions: [only], events: [], settings: makeSettings({ now: base }),
      range: makeStatsRange('week', '2026-06-03'),
    });
    expect(stats.days).toHaveLength(7);
    expect(stats.days.map(({ appDate }) => appDate)).toEqual([
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04',
      '2026-06-05', '2026-06-06', '2026-06-07',
    ]);
    expect(stats.days[0]!.focus.validPomodoros).toBe(1);
    expect(stats.days[1]!.focus.validPomodoros).toBe(0);
    const emptyDay = stats.days[1]!.rest;
    expect(emptyDay.completionRate).toBeNull();
    expect(emptyDay.explicitSkipRate).toBeNull();
    expect(emptyDay.shortBreakExplicitSkipRate).toBeNull();
    expect(emptyDay.longBreakExplicitSkipRate).toBeNull();
  });

  it('keeps Session appDate membership correct across Monday and calendar-month boundaries', () => {
    const sunday = makeSession({
      id: 'sunday', now: '2026-05-31T23:00:00+08:00', startedAt: '2026-05-31T23:00:00+08:00',
      timezone: ZONE, type: 'focus', status: 'completed', taskId: 'task',
      endedAt: '2026-05-31T23:25:00+08:00', plannedDuration: 1500, actualDuration: 10, pomodoroIndex: 1,
    });
    const monday = makeSession({
      id: 'monday', now: '2026-06-01T08:00:00+08:00', startedAt: '2026-06-01T08:00:00+08:00',
      timezone: ZONE, type: 'focus', status: 'completed', taskId: 'task',
      endedAt: '2026-06-01T08:25:00+08:00', plannedDuration: 1500, actualDuration: 20, pomodoroIndex: 2,
    });
    const settings = makeSettings({ now: base });
    const aggregate = (kind: 'week' | 'month', anchorAppDate: '2026-05-31' | '2026-06-01') =>
      aggregateSessionStats({ sessions: [sunday, monday], events: [], settings, range: makeStatsRange(kind, anchorAppDate) });
    expect(aggregate('week', '2026-05-31').focus).toMatchObject({ validPomodoros: 1, standardSeconds: 10 });
    expect(aggregate('week', '2026-06-01').focus).toMatchObject({ validPomodoros: 1, standardSeconds: 20 });
    expect(aggregate('month', '2026-05-31').focus.validPomodoros).toBe(1);
    expect(aggregate('month', '2026-06-01').focus.validPomodoros).toBe(1);
  });
});
