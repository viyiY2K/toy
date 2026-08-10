import type { DayPlan, EnergyRecord, Event, MergeGroup, Session, Settings, Task } from '../schema';
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
  /** 合并组是与独立任务同级的番茄归属单位（红线 24），统计要单独成一维。 */
  mergeGroups: readonly MergeGroup[];
  settings: Settings;
  range: StatsRange;
}

/** 预估准确率的统计形状；Task 与 MergeGroup 共用同一套算法与同一个结构。 */
export interface EstimateAccuracy {
  sampleCount: number;
  accurate: number;
  overestimated: number;
  underestimated: number;
  adjustedInaccurate: number;
  accuracyRate: number | null;
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

/**
 * 某个成员任务在这批 Session 上的真实投入（红线 25）。
 *
 * 合并 Session 取 `taskSegments` 里属于它的那一段——分段 `actualDuration` 是唯一
 * 事实源，**不得**用 `endedAt − startedAt` 重推；独立专注则整段都是它自己的。
 * 迁移进来的历史合并 Session 没有分段事实（当时没有逐个勾选成员的入口），
 * `taskSegments` 为空，按 0 计——宁可少算，也不编一份平均分摊的假数据。
 */
function memberDuration(records: readonly Session[], taskId: string): number {
  return records.reduce((sum, record) => {
    if (record.mergeGroupId === null) return sum + (record.actualDuration ?? 0);
    const segment = record.taskSegments.find((candidate) => candidate.taskId === taskId);
    return sum + (segment?.actualDuration ?? 0);
  }, 0);
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

function emptyEstimates(): EstimateAccuracy {
  return {
    sampleCount: 0,
    accurate: 0,
    overestimated: 0,
    underestimated: 0,
    adjustedInaccurate: 0,
    accuracyRate: null,
  };
}

/**
 * 预估准确率的**唯一**算法，Task 与 MergeGroup 共用（用户明确要求不另写一套）。
 *
 * 判据全在"首轮预估 vs 完成时的有效番茄数"上：一次估准（只估过一轮且数对上）才算
 * `accurate`；估多了是 `overestimated`，估少了是 `underestimated`；追加过预估、最后
 * 数字虽然对上但过程不准的，单独记 `adjustedInaccurate`，不混进 accurate。
 *
 * MergeGroup 之所以能直接复用：它的 `estimateRounds` 结构与 Task 完全一致，而
 * `mergeGroup.completed` 的 `validFocusCountAtCompletion` 记的是**这一组**拿到的
 * 有效番茄数（每条正常完成的合并 Session 记 1 个）——正是同一个口径的量。
 */
function accumulateEstimate(
  accumulator: EstimateAccuracy,
  estimateRounds: readonly { pomodoros: number }[],
  snapshot: unknown,
): void {
  if (
    typeof snapshot !== 'number'
    || !Number.isInteger(snapshot)
    || snapshot < 0
    || estimateRounds.length === 0
  ) return;
  const initial = estimateRounds[0]!.pomodoros;
  accumulator.sampleCount += 1;
  if (estimateRounds.length === 1 && snapshot === initial) accumulator.accurate += 1;
  else if (snapshot < initial) accumulator.overestimated += 1;
  else if (snapshot > initial) accumulator.underestimated += 1;
  else accumulator.adjustedInaccurate += 1;
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
  const sessions = visible(input.sessions).filter((session) =>
    session.taskIds.some((taskId) => taskIds.has(taskId)),
  );
  const tasksStats: TaskFocusStats[] = tasks.map((task) => {
    /*
     * §8.5 + 红线 24/25：番茄归合并组，时间归成员。
     * - **有效番茄**只数非合并的 completed focus——合并 Session 给成员各记 0；
     * - **时长**在合并 Session 上只取 `taskSegments` 里属于本成员的那一段，绝不把
     *   整段 actualDuration 给每个成员各记一遍（那会让任务维度加总 > 全局真实投入）。
     * 这样任何维度的加总都能与全局专注时长对账。
     */
    const taskSessions = sessions.filter((session) => session.taskIds.includes(task.id));
    const rangeSessions = taskSessions.filter((session) =>
      inRange(session.startedAt, session.timezone, input.settings, input.range));
    const historicalValidFocus = taskSessions.filter(
      (session) =>
        session.type === 'focus'
        && session.status === 'completed'
        && session.mergeGroupId === null,
    ).length;
    const standard = rangeSessions.filter(
      (session) => session.type === 'focus' && session.status === 'completed',
    );
    const extra = rangeSessions.filter(({ type }) => type === 'extraFocus');
    const discarded = rangeSessions.filter(
      (session) => session.type === 'focus' && session.status === 'discarded',
    );
    const standardSeconds = memberDuration(standard, task.id);
    const extraSeconds = duration(extra);
    const discardedSeconds = memberDuration(discarded, task.id);
    return {
      taskId: task.id,
      title: task.title,
      validFocusInRange: standard.filter((session) => session.mergeGroupId === null).length,
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
  const estimates = emptyEstimates();
  const sessionById = new Map(visible(input.sessions).map((session) => [session.id, session]));
  for (const event of completionEvents) {
    if (event.payload.completionSource !== 'pomodoro' || event.taskId === null) continue;
    /*
     * 红线 26：`completionSource='pomodoro'` **不等于**该 Task 有有效番茄。合并成员
     * 是在番茄流程里完成的（记 'pomodoro'），但自己一个有效番茄都没拿到（恒为 0）。
     * 把它留在样本里，会被解读成"预估 1、实到 0 → 预估偏大"，纯属误判，因此按关联
     * Session 的 mergeGroupId 整体排除。成员的投入用时间口径衡量（见 tasksStats
     * 的 standardSeconds），不走番茄数口径。
     */
    const session = event.sessionId === null ? undefined : sessionById.get(event.sessionId);
    if (session?.mergeGroupId != null) continue;
    const task = taskById.get(event.taskId);
    if (!task) continue;
    accumulateEstimate(
      estimates,
      task.estimateRounds,
      (event.payload as { validFocusCountAtCompletion: unknown }).validFocusCountAtCompletion,
    );
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

/**
 * 合并组维度（§8.5，红线 24）。合并组是番茄与专注时长的归属单位，因此在统计里
 * 它是一个**与独立任务同级**的条目，用 `title` 区分——没有名字就没法分辨两个杂事番茄。
 *
 * `validFocus` 数的是本组正常完成的合并 Session 条数（每条 1 个）；`standardSeconds`
 * 取这些 Session 的整段 `actualDuration`（整段都归这个组）。成员各自的耗时在
 * `tasks` 维度按分段体现，两者不重叠，加总不会超过全局真实投入。
 */
function aggregateMergeGroupStats(input: AwarenessStatsInput) {
  const groups = visible(input.mergeGroups);
  const sessions = visible(input.sessions).filter((session) => session.mergeGroupId !== null);
  const completionEvents = input.events.filter(
    (event) => event.type === 'mergeGroup.completed' && event.mergeGroupId !== null,
  );
  const estimates = emptyEstimates();

  const mergeGroups = groups.map((group) => {
    const groupSessions = sessions.filter((session) => session.mergeGroupId === group.id);
    const rangeSessions = groupSessions.filter((session) =>
      inRange(session.startedAt, session.timezone, input.settings, input.range));
    const standard = rangeSessions.filter((session) => session.status === 'completed');
    const discarded = rangeSessions.filter((session) => session.status === 'discarded');
    return {
      mergeGroupId: group.id,
      title: group.title,
      status: group.status,
      validFocusInRange: standard.length,
      historicalValidFocus: groupSessions.filter((session) => session.status === 'completed').length,
      standardSeconds: duration(standard),
      discardedSeconds: duration(discarded),
    };
  });

  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const event of completionEvents) {
    if (!inRange(event.occurredAt, event.timezone, input.settings, input.range)) continue;
    const group = event.mergeGroupId === null ? undefined : groupById.get(event.mergeGroupId);
    if (!group) continue;
    accumulateEstimate(
      estimates,
      group.estimateRounds,
      (event.payload as { validFocusCountAtCompletion: unknown }).validFocusCountAtCompletion,
    );
  }
  estimates.accuracyRate = ratio(estimates.accurate, estimates.sampleCount);
  return { mergeGroups, mergeGroupEstimates: estimates };
}

export function aggregateAwarenessStats(input: AwarenessStatsInput) {
  return {
    ...aggregateTaskStats(input),
    ...aggregateMergeGroupStats(input),
    ...aggregateEnergyAndRecovery(input),
    ...aggregateInterrupts(input),
    ...aggregateBudget(input),
  };
}
