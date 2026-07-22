import { EVENT_STORE, STORE } from '../dataStore';
import { deriveAppDate } from '../time';
import {
  makeEvent,
  makeSession,
  makeUnresolvedInterval,
  type DayPlan,
  type Event,
  type Session,
  type Settings,
  type Task,
  type UnresolvedInterval,
  type UnresolvedIntervalSource,
} from '../schema';
import {
  executeAtomicWrite,
  type ValidatedAtomicWriteTransaction,
} from '../writes/executeAtomicWrite';
import type { InitializationClock } from '../initialization/currentAppDate';

export type RecoveryDetectionSource = Extract<
  UnresolvedIntervalSource,
  'appReopened' | 'systemRecovered'
>;

export type RecoveryOriginalResolution =
  | { resolvedAs: 'completed'; actualDuration: number; actualRest?: string | null }
  | { resolvedAs: 'discarded'; actualDuration: number }
  | { resolvedAs: 'skipped' };

export type RecoveryRemainderResolution =
  | { kind: 'ignore'; ignoreReason?: string | null }
  | { kind: 'extraFocus'; taskId: string; actualDuration: number }
  | { kind: 'extraRest'; actualDuration: number; actualRest: string | null };

export interface DetectRecoveryResult {
  interval: UnresolvedInterval | null;
  created: boolean;
  correlationId: string | null;
}

export interface ResolveRecoveryResult {
  interval: UnresolvedInterval;
  sourceSession: Session;
  extraSession: Session | null;
  correlationId: string;
}

type StandardSessionType = 'focus' | 'shortBreak' | 'longBreak';
type ActiveStandardSession = Session & { type: StandardSessionType; status: 'active' };
type ResolvedStandardSession = Session & {
  type: StandardSessionType;
  status: 'completed' | 'discarded' | 'skipped';
};
type ExtraSession = Session & { type: 'extraFocus' | 'extraRest'; status: 'completed' };

function eventFields(clock: InitializationClock, correlationId: string) {
  return { now: clock.now, timezone: clock.timezone, correlationId } as const;
}

function assertFiniteInstant(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} 必须是有效时间`);
  return milliseconds;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} 必须是非负整数`);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} 必须是正整数`);
}

function isStandardActiveSession(session: Session): session is ActiveStandardSession {
  return session.status === 'active'
    && (session.type === 'focus' || session.type === 'shortBreak' || session.type === 'longBreak');
}

function intervalLink(
  events: readonly Event[],
  intervalId: string,
): Event<'interval.detected'> {
  const matches = events.filter(
    (event): event is Event<'interval.detected'> =>
      event.type === 'interval.detected' && event.unresolvedIntervalId === intervalId,
  );
  if (matches.length !== 1 || matches[0]!.sessionId === null) {
    throw new Error('pending interval 与原 active Session 的检测关联不唯一');
  }
  return matches[0]!;
}

async function dayPlanForExtraSession(
  transaction: ValidatedAtomicWriteTransaction,
  startedAt: string,
  timezone: string,
): Promise<DayPlan | null> {
  const [settingsRecords, dayPlans] = await Promise.all([
    transaction.getAll<Settings>(STORE.settings),
    transaction.getAll<DayPlan>(STORE.dayPlans),
  ]);
  if (settingsRecords.length !== 1) throw new Error('恢复归类需要唯一有效 Settings');
  const appDate = deriveAppDate(
    startedAt,
    timezone,
    settingsRecords[0]!.appDayStartOffsetMinutes,
  );
  return dayPlans.find((dayPlan) => dayPlan.appDate === appDate) ?? null;
}

export async function detectRecoveryInterval(
  input: InitializationClock & { source: RecoveryDetectionSource },
): Promise<DetectRecoveryResult> {
  if (input.source !== 'appReopened' && input.source !== 'systemRecovered') {
    throw new Error('核心恢复检测 source 仅支持 appReopened/systemRecovered');
  }
  return executeAtomicWrite(
    {
      storeNames: [STORE.sessions, STORE.unresolvedIntervals, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'UnresolvedInterval', operation: 'create' },
    },
    async (transaction) => {
      const [sessions, intervals, events] = await Promise.all([
        transaction.getAll<Session>(STORE.sessions),
        transaction.getAll<UnresolvedInterval>(STORE.unresolvedIntervals),
        transaction.getAll<Event>(EVENT_STORE),
      ]);
      const activeSessions = sessions.filter(isStandardActiveSession);
      if (activeSessions.length > 1) throw new Error('检测到多个 active 标准 Session');
      const activeSession = activeSessions[0];
      const pendingIntervals = intervals.filter(({ status }) => status === 'pending');
      if (!activeSession) {
        if (pendingIntervals.length > 0) throw new Error('存在 pending interval 但原 Session 不再 active');
        return { interval: null, created: false, correlationId: null };
      }

      const detectedForSession = events.filter(
        (event): event is Event<'interval.detected'> =>
          event.type === 'interval.detected' && event.sessionId === activeSession.id,
      );
      const intervalById = new Map(intervals.map((interval) => [interval.id, interval]));
      const existing = detectedForSession.flatMap((event) => {
        const interval = event.unresolvedIntervalId === null
          ? undefined
          : intervalById.get(event.unresolvedIntervalId);
        return interval?.status === 'pending' ? [{ event, interval }] : [];
      });
      if (existing.length > 1) throw new Error('同一 active Session 存在多个 pending interval');
      if (existing.length === 1) {
        return {
          interval: existing[0]!.interval,
          created: false,
          correlationId: existing[0]!.event.correlationId,
        };
      }
      if (pendingIntervals.length > 0 || detectedForSession.length > 0) {
        throw new Error('active Session 的恢复状态不一致，拒绝重复检测');
      }

      const startedAtMs = assertFiniteInstant(activeSession.startedAt, 'Session.startedAt');
      const detectedAtMs = assertFiniteInstant(input.now, 'detectedAt');
      if (detectedAtMs <= startedAtMs) throw new Error('检测时刻必须晚于 Session.startedAt');
      const interval = makeUnresolvedInterval({
        now: input.now,
        startedAt: activeSession.startedAt,
        endedAt: input.now,
        timezone: input.timezone,
        source: input.source,
      });
      await transaction.put(STORE.unresolvedIntervals, interval);
      const detected = makeEvent({
        ...eventFields(input, transaction.correlationId),
        type: 'interval.detected',
        taskId: activeSession.taskId,
        sessionId: activeSession.id,
        dayPlanId: activeSession.dayPlanId,
        unresolvedIntervalId: interval.id,
        payload: { source: input.source, detectedSessionType: activeSession.type },
      });
      await transaction.appendEvent(detected);
      return { interval, created: true, correlationId: transaction.correlationId };
    },
  );
}

function buildResolvedSession(
  session: ActiveStandardSession,
  interval: UnresolvedInterval,
  original: RecoveryOriginalResolution,
  confirmedAt: string,
): { resolved: ResolvedStandardSession; coverageEndMs: number } {
  const startedAtMs = assertFiniteInstant(session.startedAt, 'Session.startedAt');
  const intervalEndMs = assertFiniteInstant(interval.endedAt, 'UnresolvedInterval.endedAt');
  if (session.type === 'focus') {
    if (original.resolvedAs !== 'completed' && original.resolvedAs !== 'discarded') {
      throw new Error('recovered focus 只能确认 completed 或 discarded');
    }
    assertNonNegativeInteger(original.actualDuration, 'original.actualDuration');
    const coverageEndMs = startedAtMs + original.actualDuration * 1000;
    if (coverageEndMs > intervalEndMs) throw new Error('原 focus 实际时长超出 interval 边界');
    if (original.resolvedAs === 'completed' && original.actualRest != null) {
      throw new Error('focus completed 不接受 actualRest');
    }
    return {
      resolved: {
        ...session,
        status: original.resolvedAs,
        endedAt: new Date(coverageEndMs).toISOString(),
        actualDuration: original.actualDuration,
        updatedAt: confirmedAt,
      },
      coverageEndMs,
    };
  }

  if (original.resolvedAs === 'discarded') {
    throw new Error('recovered break 不能确认 discarded');
  }
  if (original.resolvedAs === 'skipped') {
    return {
      resolved: {
        ...session,
        status: 'skipped',
        endedAt: confirmedAt,
        actualDuration: 0,
        skipKind: 'missed',
        actualRest: null,
        updatedAt: confirmedAt,
      },
      coverageEndMs: startedAtMs,
    };
  }
  assertNonNegativeInteger(original.actualDuration, 'original.actualDuration');
  const coverageEndMs = startedAtMs + original.actualDuration * 1000;
  if (coverageEndMs > intervalEndMs) throw new Error('原 break 实际时长超出 interval 边界');
  return {
    resolved: {
      ...session,
      status: 'completed',
      endedAt: new Date(coverageEndMs).toISOString(),
      actualDuration: original.actualDuration,
      actualRest: original.actualRest ?? null,
      updatedAt: confirmedAt,
    },
    coverageEndMs,
  };
}

async function appendStandardResolutionEvent(
  transaction: ValidatedAtomicWriteTransaction,
  input: InitializationClock,
  session: ResolvedStandardSession,
): Promise<void> {
  const common = eventFields(input, transaction.correlationId);
  if (session.type === 'focus' && session.status === 'completed') {
    await transaction.appendEvent(makeEvent({
      ...common,
      type: 'focus.completed',
      taskId: session.taskId!,
      sessionId: session.id,
      dayPlanId: session.dayPlanId,
      payload: {
        pomodoroIndex: session.pomodoroIndex!,
        plannedDuration: session.plannedDuration!,
        actualDuration: session.actualDuration!,
      },
    }));
  } else if (session.type === 'focus' && session.status === 'discarded') {
    await transaction.appendEvent(makeEvent({
      ...common,
      type: 'focus.discarded',
      taskId: session.taskId!,
      sessionId: session.id,
      dayPlanId: session.dayPlanId,
      payload: {
        pomodoroIndex: session.pomodoroIndex!,
        actualDuration: session.actualDuration!,
        reason: 'userConfirmedAfterRecovery',
        triggeredByInterruptEventId: null,
      },
    }));
  } else if (
    (session.type === 'shortBreak' || session.type === 'longBreak')
    && session.status === 'completed'
  ) {
    await transaction.appendEvent(makeEvent({
      ...common,
      type: 'break.completed',
      sessionId: session.id,
      dayPlanId: session.dayPlanId,
      payload: {
        breakType: session.type,
        plannedDuration: session.plannedDuration!,
        actualDuration: session.actualDuration!,
        actualRest: session.actualRest,
      },
    }));
  }
}

export async function resolveRecoveryInterval(
  input: InitializationClock & {
    intervalId: string;
    original: RecoveryOriginalResolution;
    remainder: RecoveryRemainderResolution;
  },
): Promise<ResolveRecoveryResult> {
  return executeAtomicWrite(
    {
      storeNames: [
        STORE.sessions,
        STORE.tasks,
        STORE.dayPlans,
        STORE.settings,
        STORE.unresolvedIntervals,
        EVENT_STORE,
      ],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'UnresolvedInterval',
        entityId: input.intervalId,
        operation: 'update',
      },
    },
    async (transaction) => {
      const [interval, events] = await Promise.all([
        transaction.get<UnresolvedInterval>(STORE.unresolvedIntervals, input.intervalId),
        transaction.getAll<Event>(EVENT_STORE),
      ]);
      if (!interval || interval.status !== 'pending') {
        throw new Error('只有 pending UnresolvedInterval 可以提交恢复结果');
      }
      const confirmedAtMs = assertFiniteInstant(input.now, 'confirmedAt');
      const intervalEndMs = assertFiniteInstant(interval.endedAt, 'UnresolvedInterval.endedAt');
      if (confirmedAtMs < intervalEndMs) throw new Error('恢复确认时刻不得早于 interval.endedAt');
      const detection = intervalLink(events, interval.id);
      const sourceSession = await transaction.get<Session>(STORE.sessions, detection.sessionId!);
      if (!sourceSession || !isStandardActiveSession(sourceSession)) {
        throw new Error('恢复关联的原 Session 不再是 active 标准 Session');
      }
      const { resolved, coverageEndMs } = buildResolvedSession(
        sourceSession,
        interval,
        input.original,
        input.now,
      );
      // Layer 1 先进入同一事务；任何后续 Layer 2 校验/写入失败都必须回滚此更新。
      await transaction.put(STORE.sessions, resolved);

      let extraSession: ExtraSession | null = null;
      let resolvedInterval: UnresolvedInterval;
      if (input.remainder.kind === 'ignore') {
        resolvedInterval = {
          ...interval,
          status: 'ignored',
          ignoredAt: input.now,
          ignoreReason: input.remainder.ignoreReason ?? null,
          updatedAt: input.now,
        };
      } else {
        assertPositiveInteger(input.remainder.actualDuration, 'remainder.actualDuration');
        const extraEndMs = coverageEndMs + input.remainder.actualDuration * 1000;
        if (extraEndMs > intervalEndMs) {
          throw new Error('extra Session 时段超出 interval 或与原 Session 重叠');
        }
        const extraStartedAt = new Date(coverageEndMs).toISOString();
        const extraEndedAt = new Date(extraEndMs).toISOString();
        const dayPlan = await dayPlanForExtraSession(
          transaction,
          extraStartedAt,
          interval.timezone,
        );
        if (input.remainder.kind === 'extraFocus') {
          const task = await transaction.get<Task>(STORE.tasks, input.remainder.taskId);
          if (!task) throw new Error('extraFocus 必须关联已有有效 Task');
          extraSession = makeSession({
            now: input.now,
            startedAt: extraStartedAt,
            endedAt: extraEndedAt,
            timezone: interval.timezone,
            type: 'extraFocus',
            status: 'completed',
            taskId: task.id,
            actualDuration: input.remainder.actualDuration,
            originIntervalId: interval.id,
            dayPlanId: dayPlan?.id ?? null,
          }) as ExtraSession;
        } else {
          const actualRest = input.remainder.actualRest;
          if (actualRest !== null) {
            const settingsRecords = await transaction.getAll<Settings>(STORE.settings);
            const rest = settingsRecords[0]?.restSuggestions.find(
              ({ key, isEnabled }) => key === actualRest && isEnabled,
            );
            if (!rest) throw new Error('extraRest.actualRest 必须是有效且启用的休息项 key');
          }
          extraSession = makeSession({
            now: input.now,
            startedAt: extraStartedAt,
            endedAt: extraEndedAt,
            timezone: interval.timezone,
            type: 'extraRest',
            status: 'completed',
            actualDuration: input.remainder.actualDuration,
            actualRest,
            originIntervalId: interval.id,
            dayPlanId: dayPlan?.id ?? null,
          }) as ExtraSession;
        }
        resolvedInterval = {
          ...interval,
          status: 'classified',
          classifiedAt: input.now,
          updatedAt: input.now,
        };
      }

      await transaction.put(STORE.unresolvedIntervals, resolvedInterval);
      if (extraSession) await transaction.put(STORE.sessions, extraSession);
      await appendStandardResolutionEvent(transaction, input, resolved);
      await transaction.appendEvent(makeEvent({
        ...eventFields(input, transaction.correlationId),
        type: 'interval.sessionResolved',
        taskId: resolved.taskId,
        sessionId: resolved.id,
        dayPlanId: resolved.dayPlanId,
        unresolvedIntervalId: interval.id,
        payload: { sessionType: resolved.type, resolvedAs: resolved.status },
      }));
      if (input.remainder.kind === 'ignore') {
        await transaction.appendEvent(makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'interval.ignored',
          unresolvedIntervalId: interval.id,
          payload: { ignoreReason: resolvedInterval.ignoreReason },
        }));
      } else {
        await transaction.appendEvent(makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'interval.classified',
          taskId: extraSession!.taskId,
          sessionId: extraSession!.id,
          dayPlanId: extraSession!.dayPlanId,
          unresolvedIntervalId: interval.id,
          payload: { classificationType: extraSession!.type },
        }));
      }
      return {
        interval: resolvedInterval,
        sourceSession: resolved,
        extraSession,
        correlationId: transaction.correlationId,
      };
    },
  );
}
