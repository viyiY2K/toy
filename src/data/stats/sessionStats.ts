import type { Event, Session, Settings, SkipKind } from '../schema';
import type { IsoDate } from '../time';
import {
  makeStatsRange,
  statsAppDate,
  statsRangeContains,
  statsRangeDates,
  type StatsRange,
} from './dateRange';

export interface FocusStats {
  validPomodoros: number;
  standardSeconds: number;
  extraSeconds: number;
  discardedSeconds: number;
  totalSeconds: number;
}

export interface RestStats {
  shortBreakSeconds: number;
  longBreakSeconds: number;
  standardBreakSeconds: number;
  extraRestSeconds: number;
  totalRestSeconds: number;
  standardBreakCompleted: number;
  completedByType: { shortBreak: number; longBreak: number };
  skipped: Record<SkipKind, number>;
  skippedByType: {
    shortBreak: Record<SkipKind, number>;
    longBreak: Record<SkipKind, number>;
  };
  workEndedExemptions: number;
  expectedBreaks: number;
  expectedByType: { shortBreak: number; longBreak: number };
  missingBreaks: number;
  completionRate: number | null;
  explicitSkipRate: number | null;
  noResponseRate: number | null;
  missedRate: number | null;
  appClosedRate: number | null;
  shortBreakExplicitSkipRate: number | null;
  longBreakExplicitSkipRate: number | null;
}

export interface SessionStatsDay {
  appDate: IsoDate;
  focus: FocusStats;
  completeCycles: number;
  rest: RestStats;
}

export interface SessionStats {
  range: StatsRange;
  focus: FocusStats;
  completeCycles: number;
  rest: RestStats;
  days: SessionStatsDay[];
  lifetime: {
    baselineCompleteCycles: number;
    inToolCompleteCycles: number;
    totalCompleteCycles: number;
    focusSeconds: number;
  };
}

export interface AggregateSessionStatsInput {
  sessions: readonly Session[];
  events: readonly Event[];
  settings: Settings;
  range: StatsRange;
}

type StandardBreak = Session & { type: 'shortBreak' | 'longBreak' };
type CompletedFocus = Session & { type: 'focus'; status: 'completed'; endedAt: string };

const SKIP_KINDS: readonly SkipKind[] = ['explicitSkip', 'noResponse', 'missed', 'appClosed'];

function sumDuration(sessions: readonly Session[]): number {
  return sessions.reduce((sum, session) => sum + (session.actualDuration ?? 0), 0);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function sessionInRange(session: Session, settings: Settings, range: StatsRange): boolean {
  return statsRangeContains(
    range,
    statsAppDate(session.startedAt, session.timezone, settings.appDayStartOffsetMinutes),
  );
}

function completedFocusSequence(sessions: readonly Session[]): CompletedFocus[] {
  return sessions
    .filter(
      (session): session is CompletedFocus =>
        session.deletedAt === null
        && session.type === 'focus'
        && session.status === 'completed'
        && session.endedAt !== null,
    )
    .sort(
      (left, right) =>
        Date.parse(left.endedAt) - Date.parse(right.endedAt) || left.id.localeCompare(right.id),
    );
}

function completeCycleFocusIds(sessions: readonly Session[]): Set<string> {
  const visible = sessions.filter((session) => session.deletedAt === null);
  const standardFocuses = visible.filter((session) => session.type === 'focus');
  const standardBreaks = visible.filter(
    (session): session is StandardBreak =>
      session.type === 'shortBreak' || session.type === 'longBreak',
  );
  const cycleIds = new Set<string>();

  for (const focus of completedFocusSequence(visible)) {
    const linked = standardBreaks.filter((candidate) => candidate.sourceFocusSessionId === focus.id);
    if (linked.some((candidate) => candidate.status === 'skipped')) continue;
    const completed = linked
      .filter((candidate) => candidate.status === 'completed')
      .sort(
        (left, right) =>
          Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.id.localeCompare(right.id),
      );
    const focusEndedAt = Date.parse(focus.endedAt);
    const continuousBreak = completed.find((candidate) => {
      const breakStartedAt = Date.parse(candidate.startedAt);
      if (breakStartedAt < focusEndedAt) return false;
      return !standardFocuses.some((other) => {
        if (other.id === focus.id) return false;
        const otherStartedAt = Date.parse(other.startedAt);
        return otherStartedAt > focusEndedAt && otherStartedAt <= breakStartedAt;
      });
    });
    if (continuousBreak) cycleIds.add(focus.id);
  }
  return cycleIds;
}

function workEndedFocusIds(events: readonly Event[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== 'dayPlan.workEnded') continue;
    if (event.payload.endedAfterFocusSessionId) ids.add(event.payload.endedAfterFocusSessionId);
  }
  return ids;
}

function emptySkipCounts(): Record<SkipKind, number> {
  return { explicitSkip: 0, noResponse: 0, missed: 0, appClosed: 0 };
}

function aggregateRange(
  sessions: readonly Session[],
  events: readonly Event[],
  settings: Settings,
  range: StatsRange,
  cycleFocusIds: ReadonlySet<string>,
  sequence: readonly CompletedFocus[],
): Omit<SessionStatsDay, 'appDate'> {
  const visible = sessions.filter((session) => session.deletedAt === null);
  const inRange = visible.filter((session) => sessionInRange(session, settings, range));
  const completedFocuses = inRange.filter(
    (session) => session.type === 'focus' && session.status === 'completed',
  );
  const completedStandardFocus = completedFocuses as CompletedFocus[];
  const standardCompleted = completedStandardFocus;
  const extraFocus = inRange.filter((session) => session.type === 'extraFocus');
  const discardedFocus = inRange.filter(
    (session) => session.type === 'focus' && session.status === 'discarded',
  );
  const focus: FocusStats = {
    validPomodoros: standardCompleted.length,
    standardSeconds: sumDuration(standardCompleted),
    extraSeconds: sumDuration(extraFocus),
    discardedSeconds: sumDuration(discardedFocus),
    totalSeconds: 0,
  };
  focus.totalSeconds = focus.standardSeconds + focus.extraSeconds + focus.discardedSeconds;

  const completedBreaks = inRange.filter(
    (session): session is StandardBreak =>
      (session.type === 'shortBreak' || session.type === 'longBreak')
      && session.status === 'completed',
  );
  const skippedBreaks = inRange.filter(
    (session): session is StandardBreak =>
      (session.type === 'shortBreak' || session.type === 'longBreak')
      && session.status === 'skipped',
  );
  const allStandardBreaks = visible.filter(
    (session): session is StandardBreak =>
      session.type === 'shortBreak' || session.type === 'longBreak',
  );
  const endedFocusIds = workEndedFocusIds(events);
  const exemptFocusIds = new Set(
    completedStandardFocus
      .filter(
        (focusSession) =>
          endedFocusIds.has(focusSession.id)
          && !allStandardBreaks.some((candidate) => candidate.sourceFocusSessionId === focusSession.id),
      )
      .map(({ id }) => id),
  );
  const expectedFocuses = completedStandardFocus.filter(({ id }) => !exemptFocusIds.has(id));
  const ordinalById = new Map(sequence.map((session, index) => [session.id, index + 1]));
  const expectedByType = expectedFocuses.reduce(
    (counts, session) => {
      const ordinal = ordinalById.get(session.id);
      if (ordinal !== undefined && ordinal % settings.longBreakEvery === 0) counts.longBreak += 1;
      else counts.shortBreak += 1;
      return counts;
    },
    { shortBreak: 0, longBreak: 0 },
  );
  const skipped = emptySkipCounts();
  const skippedByType = { shortBreak: emptySkipCounts(), longBreak: emptySkipCounts() };
  for (const session of skippedBreaks) {
    if (session.skipKind === null) continue;
    skipped[session.skipKind] += 1;
    skippedByType[session.type][session.skipKind] += 1;
  }
  const skippedTotal = SKIP_KINDS.reduce((sum, kind) => sum + skipped[kind], 0);
  const completedByType = {
    shortBreak: completedBreaks.filter(({ type }) => type === 'shortBreak').length,
    longBreak: completedBreaks.filter(({ type }) => type === 'longBreak').length,
  };
  const shortBreakSeconds = sumDuration(completedBreaks.filter(({ type }) => type === 'shortBreak'));
  const longBreakSeconds = sumDuration(completedBreaks.filter(({ type }) => type === 'longBreak'));
  const extraRestSeconds = sumDuration(inRange.filter(({ type }) => type === 'extraRest'));
  const expectedBreaks = expectedFocuses.length;
  const standardBreakCompleted = completedBreaks.length;
  const rest: RestStats = {
    shortBreakSeconds,
    longBreakSeconds,
    standardBreakSeconds: shortBreakSeconds + longBreakSeconds,
    extraRestSeconds,
    totalRestSeconds: shortBreakSeconds + longBreakSeconds + extraRestSeconds,
    standardBreakCompleted,
    completedByType,
    skipped,
    skippedByType,
    workEndedExemptions: exemptFocusIds.size,
    expectedBreaks,
    expectedByType,
    missingBreaks: Math.max(0, expectedBreaks - standardBreakCompleted - skippedTotal),
    completionRate: ratio(standardBreakCompleted, expectedBreaks),
    explicitSkipRate: ratio(skipped.explicitSkip, expectedBreaks),
    noResponseRate: ratio(skipped.noResponse, expectedBreaks),
    missedRate: ratio(skipped.missed, expectedBreaks),
    appClosedRate: ratio(skipped.appClosed, expectedBreaks),
    shortBreakExplicitSkipRate: ratio(
      skippedByType.shortBreak.explicitSkip,
      expectedByType.shortBreak,
    ),
    longBreakExplicitSkipRate: ratio(
      skippedByType.longBreak.explicitSkip,
      expectedByType.longBreak,
    ),
  };

  return {
    focus,
    completeCycles: completedStandardFocus.filter(({ id }) => cycleFocusIds.has(id)).length,
    rest,
  };
}

export function aggregateSessionStats(input: AggregateSessionStatsInput): SessionStats {
  const visible = input.sessions.filter((session) => session.deletedAt === null);
  const sequence = completedFocusSequence(visible);
  const cycleFocusIds = completeCycleFocusIds(visible);
  const rangeMetrics = aggregateRange(
    visible,
    input.events,
    input.settings,
    input.range,
    cycleFocusIds,
    sequence,
  );
  const days = statsRangeDates(input.range).map((appDate) => ({
    appDate,
    ...aggregateRange(
      visible,
      input.events,
      input.settings,
      makeStatsRange('day', appDate),
      cycleFocusIds,
      sequence,
    ),
  }));
  const lifetimeStandard = visible.filter(
    (session) => session.type === 'focus' && session.status === 'completed',
  );
  const lifetimeExtra = visible.filter(({ type }) => type === 'extraFocus');
  const lifetimeDiscarded = visible.filter(
    (session) => session.type === 'focus' && session.status === 'discarded',
  );
  const lifetimeFocusSeconds =
    sumDuration(lifetimeStandard) + sumDuration(lifetimeExtra) + sumDuration(lifetimeDiscarded);
  return {
    range: input.range,
    ...rangeMetrics,
    days,
    lifetime: {
      baselineCompleteCycles: input.settings.lifetimePomodoroBaseline,
      inToolCompleteCycles: cycleFocusIds.size,
      totalCompleteCycles: input.settings.lifetimePomodoroBaseline + cycleFocusIds.size,
      focusSeconds: lifetimeFocusSeconds,
    },
  };
}
