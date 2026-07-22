import type { DayPlan, EnergyRecord, Event, Session, Settings, Task } from '../schema';
import type { IsoDate } from '../time';
import {
  makeStatsRange,
  statsAppDate,
  statsRangeContains,
  statsRangeDates,
  type StatsRange,
} from './dateRange';

export interface AwarenessStatsInput {
  tasks: readonly Task[];
  sessions: readonly Session[];
  events: readonly Event[];
  energyRecords: readonly EnergyRecord[];
  dayPlans: readonly DayPlan[];
  settings: Settings;
  range: StatsRange;
}

interface TaskFocusStats {
  taskId: string;
  title: string;
  validFocusInRange: number;
  historicalValidFocus: number;
  standardSeconds: number;
  extraSeconds: number;
  discardedSeconds: number;
  totalSeconds: number;
}

interface RecoverySample {
  breakSessionId: string;
  type: 'shortBreak' | 'longBreak';
  actualRest: string | null;
  delta: number | null;
}

interface RecoverySummary {
  usageCount: number;
  validSampleCount: number;
  missingSampleCount: number;
  averageDelta: number | null;
}

type TaskCompletedEvent = Extract<Event, { type: 'task.completed' }>;

const TIME_BUCKETS = ['00–03', '04–07', '08–11', '12–15', '16–19', '20–23'] as const;

function visible<T extends { deletedAt: string | null }>(records: readonly T[]): T[] {
  return records.filter((record) => record.deletedAt === null);
}

function inRange(
  businessTime: string,
  timezone: string,
  settings: Settings,
  range: StatsRange,
): boolean {
  return statsRangeContains(
    range,
    statsAppDate(businessTime, timezone, settings.appDayStartOffsetMinutes),
  );
}

function duration(records: readonly Session[]): number {
  return records.reduce((sum, record) => sum + (record.actualDuration ?? 0), 0);
}

function localTime(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const hour = parts.find(({ type }) => type === 'hour')?.value ?? '00';
  const minute = parts.find(({ type }) => type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function localHour(instant: string, timezone: string): number {
  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant)).find(({ type }) => type === 'hour');
  return Number(part?.value ?? 0);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function summarizeRecovery(samples: readonly RecoverySample[]): RecoverySummary {
  const deltas = samples.flatMap(({ delta }) => delta === null ? [] : [delta]);
  return {
    usageCount: samples.length,
    validSampleCount: deltas.length,
    missingSampleCount: samples.length - deltas.length,
    averageDelta: deltas.length === 0
      ? null
      : deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
  };
}

function aggregateTaskStats(input: AwarenessStatsInput) {
  const tasks = visible(input.tasks).sort(
    (left, right) => left.sortIndex - right.sortIndex || left.id.localeCompare(right.id),
  );
  const taskIds = new Set(tasks.map(({ id }) => id));
  const sessions = visible(input.sessions).filter(
    (session) => session.taskId !== null && taskIds.has(session.taskId),
  );
  const tasksStats: TaskFocusStats[] = tasks.map((task) => {
    const taskSessions = sessions.filter(({ taskId }) => taskId === task.id);
    const rangeSessions = taskSessions.filter((session) =>
      inRange(session.startedAt, session.timezone, input.settings, input.range));
    const historicalValidFocus = taskSessions.filter(
      (session) => session.type === 'focus' && session.status === 'completed',
    ).length;
    const standard = rangeSessions.filter(
      (session) => session.type === 'focus' && session.status === 'completed',
    );
    const extra = rangeSessions.filter(({ type }) => type === 'extraFocus');
    const discarded = rangeSessions.filter(
      (session) => session.type === 'focus' && session.status === 'discarded',
    );
    const standardSeconds = duration(standard);
    const extraSeconds = duration(extra);
    const discardedSeconds = duration(discarded);
    return {
      taskId: task.id,
      title: task.title,
      validFocusInRange: standard.length,
      historicalValidFocus,
      standardSeconds,
      extraSeconds,
      discardedSeconds,
      totalSeconds: standardSeconds + extraSeconds + discardedSeconds,
    };
  });

  const completionEvents = input.events.filter(
    (event): event is TaskCompletedEvent =>
      event.type === 'task.completed'
      && event.taskId !== null
      && taskIds.has(event.taskId)
      && inRange(event.occurredAt, event.timezone, input.settings, input.range),
  );
  const completions = {
    total: completionEvents.length,
    manual: completionEvents.filter(({ payload }) => payload.completionSource === 'manual').length,
    pomodoro: completionEvents.filter(({ payload }) => payload.completionSource === 'pomodoro').length,
  };
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const estimates = {
    sampleCount: 0,
    accurate: 0,
    overestimated: 0,
    underestimated: 0,
    adjustedInaccurate: 0,
    accuracyRate: null as number | null,
  };
  for (const event of completionEvents) {
    if (event.payload.completionSource !== 'pomodoro' || event.taskId === null) continue;
    const snapshot = (event.payload as { validFocusCountAtCompletion: unknown })
      .validFocusCountAtCompletion;
    const task = taskById.get(event.taskId);
    if (
      !task
      || typeof snapshot !== 'number'
      || !Number.isInteger(snapshot)
      || snapshot < 0
      || task.estimateRounds.length === 0
    ) continue;
    const initial = task.estimateRounds[0]!.pomodoros;
    estimates.sampleCount += 1;
    if (task.estimateRounds.length === 1 && snapshot === initial) estimates.accurate += 1;
    else if (snapshot < initial) estimates.overestimated += 1;
    else if (snapshot > initial) estimates.underestimated += 1;
    else estimates.adjustedInaccurate += 1;
  }
  estimates.accuracyRate = ratio(estimates.accurate, estimates.sampleCount);
  return { tasks: tasksStats, completions, estimates };
}

function aggregateEnergyAndRecovery(input: AwarenessStatsInput) {
  const energyRecords = visible(input.energyRecords);
  const rangeRecords = energyRecords
    .filter((record) => inRange(
      record.occurredAt,
      record.timezone,
      input.settings,
      input.range,
    ))
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id),
    );
  const timeline = rangeRecords.map((record) => ({
    energyRecordId: record.id,
    occurredAt: record.occurredAt,
    localTime: localTime(record.occurredAt, record.timezone),
    energyLevel: record.energyLevel,
    source: record.source,
    sessionId: record.sessionId,
  }));
  const dailyTrend = statsRangeDates(input.range).map((appDate) => {
    const records = rangeRecords.filter((record) =>
      statsAppDate(
        record.occurredAt,
        record.timezone,
        input.settings.appDayStartOffsetMinutes,
      ) === appDate);
    return {
      appDate,
      averageEnergy: records.length === 0
        ? null
        : records.reduce((sum, record) => sum + record.energyLevel, 0) / records.length,
      sampleCount: records.length,
    };
  });

  const sessions = visible(input.sessions);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const completedBreaks = sessions
    .filter(
      (session): session is Session & { type: 'shortBreak' | 'longBreak' } =>
        (session.type === 'shortBreak' || session.type === 'longBreak')
        && session.status === 'completed'
        && inRange(session.startedAt, session.timezone, input.settings, input.range),
    )
    .sort(
      (left, right) =>
        Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.id.localeCompare(right.id),
    );
  const linkedEnergy = (source: EnergyRecord['source'], sessionId: string) => {
    const matches = energyRecords.filter(
      (record) => record.source === source && record.sessionId === sessionId,
    );
    return matches.length === 1 ? matches[0]! : null;
  };
  const samples: RecoverySample[] = completedBreaks.map((breakSession) => {
    const sourceFocus = breakSession.sourceFocusSessionId === null
      ? undefined
      : sessionById.get(breakSession.sourceFocusSessionId);
    const before = sourceFocus?.type === 'focus' && sourceFocus.status === 'completed'
      ? linkedEnergy('afterFocus', sourceFocus.id)
      : null;
    const after = linkedEnergy(
      breakSession.type === 'shortBreak' ? 'afterShortBreak' : 'afterLongBreak',
      breakSession.id,
    );
    return {
      breakSessionId: breakSession.id,
      type: breakSession.type,
      actualRest: breakSession.actualRest,
      delta: before && after ? after.energyLevel - before.energyLevel : null,
    };
  });
  const shortSamples = samples.filter(({ type }) => type === 'shortBreak');
  const longSamples = samples.filter(({ type }) => type === 'longBreak');
  const activitySummary = (typeSamples: readonly RecoverySample[]) => {
    const keys = [...new Set(typeSamples.flatMap(({ actualRest }) => actualRest === null ? [] : [actualRest]))]
      .sort();
    return keys.map((actualRest) => ({
      actualRest,
      ...summarizeRecovery(typeSamples.filter((sample) => sample.actualRest === actualRest)),
    }));
  };
  return {
    energy: { timeline, dailyTrend },
    recovery: {
      samples,
      shortBreak: summarizeRecovery(shortSamples),
      longBreak: summarizeRecovery(longSamples),
      byActivity: {
        shortBreak: activitySummary(shortSamples),
        longBreak: activitySummary(longSamples),
      },
    },
  };
}

function aggregateInterrupts(input: AwarenessStatsInput) {
  const sessions = visible(input.sessions);
  const standardFocusById = new Map(
    sessions.filter(({ type }) => type === 'focus').map((session) => [session.id, session]),
  );
  const allInterrupts = input.events.filter(
    (event) =>
      (event.type === 'interrupt.internal' || event.type === 'interrupt.external')
      && event.sessionId !== null
      && standardFocusById.has(event.sessionId),
  );
  const rangeInterrupts = allInterrupts.filter((event) =>
    inRange(event.occurredAt, event.timezone, input.settings, input.range));
  const completedFocusesInRange = sessions.filter(
    (session) =>
      session.type === 'focus'
      && session.status === 'completed'
      && inRange(session.startedAt, session.timezone, input.settings, input.range),
  );
  const completedIds = new Set(completedFocusesInRange.map(({ id }) => id));
  const completedInterrupts = allInterrupts.filter(
    (event) => event.sessionId !== null && completedIds.has(event.sessionId),
  );
  const summary = {
    total: rangeInterrupts.length,
    internal: rangeInterrupts.filter(({ type }) => type === 'interrupt.internal').length,
    external: rangeInterrupts.filter(({ type }) => type === 'interrupt.external').length,
    perValidPomodoro: ratio(completedInterrupts.length, completedFocusesInRange.length),
    internalPerValidPomodoro: ratio(
      completedInterrupts.filter(({ type }) => type === 'interrupt.internal').length,
      completedFocusesInRange.length,
    ),
    externalPerValidPomodoro: ratio(
      completedInterrupts.filter(({ type }) => type === 'interrupt.external').length,
      completedFocusesInRange.length,
    ),
  };
  const dailyTrend = statsRangeDates(input.range).map((appDate) => {
    const dayRange = makeStatsRange('day', appDate);
    const dayEvents = allInterrupts.filter((event) =>
      inRange(event.occurredAt, event.timezone, input.settings, dayRange));
    const dayFocuses = sessions.filter(
      (session) =>
        session.type === 'focus'
        && session.status === 'completed'
        && inRange(session.startedAt, session.timezone, input.settings, dayRange),
    );
    const dayFocusIds = new Set(dayFocuses.map(({ id }) => id));
    const validEvents = allInterrupts.filter(
      (event) => event.sessionId !== null && dayFocusIds.has(event.sessionId),
    );
    return {
      appDate,
      total: dayEvents.length,
      internal: dayEvents.filter(({ type }) => type === 'interrupt.internal').length,
      external: dayEvents.filter(({ type }) => type === 'interrupt.external').length,
      perValidPomodoro: ratio(validEvents.length, dayFocuses.length),
    };
  });
  const timeDistribution = TIME_BUCKETS.map((label, index) => {
    const bucketEvents = rangeInterrupts.filter(
      (event) => Math.floor(localHour(event.occurredAt, event.timezone) / 4) === index,
    );
    return {
      label,
      internal: bucketEvents.filter(({ type }) => type === 'interrupt.internal').length,
      external: bucketEvents.filter(({ type }) => type === 'interrupt.external').length,
    };
  });
  return { interrupts: { summary, dailyTrend, timeDistribution } };
}

function aggregateBudget(input: AwarenessStatsInput) {
  const plans = visible(input.dayPlans);
  const sessions = visible(input.sessions);
  const dailyTrend = statsRangeDates(input.range).map((appDate) => {
    const plan = plans.find((candidate) => candidate.appDate === appDate);
    const validPomodoros = sessions.filter(
      (session) =>
        session.type === 'focus'
        && session.status === 'completed'
        && statsAppDate(
          session.startedAt,
          session.timezone,
          input.settings.appDayStartOffsetMinutes,
        ) === appDate,
    ).length;
    const budgetPomodoros = plan?.budgetPomodoros ?? null;
    return {
      appDate,
      budgetPomodoros,
      validPomodoros,
      usageRate: budgetPomodoros === null || budgetPomodoros === 0
        ? null
        : validPomodoros / budgetPomodoros,
    };
  });
  return { budget: { dailyTrend } };
}

export function aggregateAwarenessStats(input: AwarenessStatsInput) {
  return {
    ...aggregateTaskStats(input),
    ...aggregateEnergyAndRecovery(input),
    ...aggregateInterrupts(input),
    ...aggregateBudget(input),
  };
}
