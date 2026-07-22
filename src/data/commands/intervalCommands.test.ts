import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, internalDataStore, STORE } from '../dataStore';
import { makeSession, type Event, type Session, type Settings, type UnresolvedInterval } from '../schema';
import { newId } from '../id';
import { loadCurrentRecoveryView } from '../queries/currentRecoveryView';
import { recordInterrupt } from './awarenessCommands';
import { createManualTask } from './taskCommands';
import { completeBreak, completeFocus, discardFocus, startBreak, startFocus } from './timerCommands';
import {
  detectRecoveryInterval,
  resolveRecoveryInterval,
  type RecoveryDetectionSource,
} from './intervalCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (hour: number, minute: number) =>
  `2027-03-08T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

async function visibleSession(id: string): Promise<Session> {
  return (await dataStore.get<Session>(STORE.sessions, id))!;
}

describe('Phase 2 S2a interval detection and atomic recovery', () => {
  it('detects one conservative recovery envelope idempotently and guards ordinary focus writes', async () => {
    expect(await detectRecoveryInterval({
      now: at(8, 0), timezone: TIMEZONE, source: 'appReopened',
    })).toEqual({ interval: null, created: false, correlationId: null });

    const task = await createManualTask({
      now: at(8, 1), timezone: TIMEZONE, title: '恢复边界任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(8, 2), timezone: TIMEZONE, taskId: task.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: at(8, 10), timezone: TIMEZONE, source: 'appReopened',
    });
    expect(detected).toMatchObject({ created: true, correlationId: expect.any(String) });
    expect(detected.interval).toMatchObject({
      source: 'appReopened',
      startedAt: focus.value.startedAt,
      endedAt: at(8, 10),
      status: 'pending',
    });
    expect(await eventsFor(detected.correlationId!)).toMatchObject([
      {
        type: 'interval.detected',
        taskId: task.value.id,
        sessionId: focus.value.id,
        dayPlanId: focus.value.dayPlanId,
        unresolvedIntervalId: detected.interval!.id,
        payload: { source: 'appReopened', detectedSessionType: 'focus' },
      },
    ]);

    const beforeDuplicateCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const duplicate = await detectRecoveryInterval({
      now: at(8, 11), timezone: TIMEZONE, source: 'systemRecovered',
    });
    expect(duplicate).toMatchObject({
      interval: { id: detected.interval!.id, source: 'appReopened' },
      created: false,
      correlationId: detected.correlationId,
    });
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(beforeDuplicateCount);

    const recovery = await loadCurrentRecoveryView();
    expect(recovery).toMatchObject({
      interval: { id: detected.interval!.id },
      sourceSession: { id: focus.value.id },
      sourceTask: { id: task.value.id },
      envelopeDurationSeconds: 480,
    });
    await expect(completeFocus({
      now: at(8, 12), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 120,
    })).rejects.toThrow(/恢复流程/);
    await expect(discardFocus({
      now: at(8, 12), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 120,
    })).rejects.toThrow(/恢复流程/);
    await expect(recordInterrupt({
      now: at(8, 12), timezone: TIMEZONE, sessionId: focus.value.id,
      kind: 'internal', offsetSeconds: 10,
    })).rejects.toThrow(/恢复流程/);

    const resolved = await resolveRecoveryInterval({
      now: at(8, 12),
      timezone: TIMEZONE,
      intervalId: detected.interval!.id,
      original: { resolvedAs: 'discarded', actualDuration: 120 },
      remainder: { kind: 'ignore', ignoreReason: '不记录剩余时间' },
    });
    expect(resolved.sourceSession).toMatchObject({
      status: 'discarded',
      endedAt: '2027-03-08T00:04:00.000Z',
      actualDuration: 120,
    });
    expect(resolved.interval).toMatchObject({
      status: 'ignored', ignoredAt: at(8, 12), ignoreReason: '不记录剩余时间', deletedAt: null,
    });
    expect(resolved.extraSession).toBeNull();
    expect((await eventsFor(resolved.correlationId)).map(({ type }) => type)).toEqual([
      'focus.discarded',
      'interval.sessionResolved',
      'interval.ignored',
    ]);
    expect(await loadCurrentRecoveryView()).toBeNull();
    await expect(resolveRecoveryInterval({
      now: at(8, 13), timezone: TIMEZONE, intervalId: detected.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 120 },
      remainder: { kind: 'ignore' },
    })).rejects.toThrow(/pending/);
  });

  it('resolves a recovered break as skipped and classifies one extraRest without break.skipped', async () => {
    const task = await createManualTask({
      now: at(8, 14), timezone: TIMEZONE, title: '恢复跳过休息任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(8, 15), timezone: TIMEZONE, taskId: task.value.id,
    });
    await completeFocus({
      now: at(8, 16), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    const [settings] = await dataStore.getAll<Settings>(STORE.settings);
    const rest = settings!.restSuggestions.find(({ isEnabled }) => isEnabled)!;
    const breakSession = await startBreak({
      now: at(8, 20), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: at(8, 30), timezone: TIMEZONE, source: 'systemRecovered',
    });
    await expect(completeBreak({
      now: at(8, 31), timezone: TIMEZONE, sessionId: breakSession.value.id,
      actualDuration: 60, actualRest: rest.key,
    })).rejects.toThrow(/恢复流程/);
    const resolved = await resolveRecoveryInterval({
      now: at(8, 31),
      timezone: TIMEZONE,
      intervalId: detected.interval!.id,
      original: { resolvedAs: 'skipped' },
      remainder: { kind: 'extraRest', actualDuration: 120, actualRest: rest.key },
    });
    expect(resolved.sourceSession).toMatchObject({
      type: 'shortBreak', status: 'skipped', endedAt: at(8, 31), actualDuration: 0,
      skipKind: 'missed', actualRest: null,
    });
    expect(resolved.extraSession).toMatchObject({
      type: 'extraRest', status: 'completed', taskId: null,
      startedAt: '2027-03-08T00:20:00.000Z',
      endedAt: '2027-03-08T00:22:00.000Z',
      actualDuration: 120, actualRest: rest.key,
      originIntervalId: detected.interval!.id,
    });
    expect(resolved.interval.status).toBe('classified');
    const eventTypes = (await eventsFor(resolved.correlationId)).map(({ type }) => type);
    expect(eventTypes).toEqual(['interval.sessionResolved', 'interval.classified']);
    expect(eventTypes).not.toContain('break.skipped');
  });

  it('records recovery discard semantics and a bounded extraFocus for an existing Task', async () => {
    const task = await createManualTask({
      now: at(8, 55), timezone: TIMEZONE, title: '恢复额外专注任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(9, 0), timezone: TIMEZONE, taskId: task.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: at(9, 10), timezone: TIMEZONE, source: 'appReopened',
    });
    const resolved = await resolveRecoveryInterval({
      now: at(9, 11),
      timezone: TIMEZONE,
      intervalId: detected.interval!.id,
      original: { resolvedAs: 'discarded', actualDuration: 60 },
      remainder: {
        kind: 'extraFocus', taskId: task.value.id, actualDuration: 180,
      },
    });
    expect(resolved.sourceSession).toMatchObject({
      status: 'discarded', endedAt: '2027-03-08T01:01:00.000Z', actualDuration: 60,
    });
    expect(resolved.extraSession).toMatchObject({
      type: 'extraFocus', status: 'completed', taskId: task.value.id,
      startedAt: '2027-03-08T01:01:00.000Z',
      endedAt: '2027-03-08T01:04:00.000Z', actualDuration: 180,
      originIntervalId: detected.interval!.id,
    });
    const events = await eventsFor(resolved.correlationId);
    expect(events.find(({ type }) => type === 'focus.discarded')).toMatchObject({
      payload: { reason: 'userConfirmedAfterRecovery', actualDuration: 60 },
    });
    expect(events.map(({ type }) => type)).toEqual([
      'focus.discarded', 'interval.sessionResolved', 'interval.classified',
    ]);
  });

  it('supports completed recovered break and mirrors the standard break event', async () => {
    const task = await createManualTask({
      now: at(9, 55), timezone: TIMEZONE, title: '恢复完成休息任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(10, 0), timezone: TIMEZONE, taskId: task.value.id,
    });
    const focusInterval = await detectRecoveryInterval({
      now: at(10, 10), timezone: TIMEZONE, source: 'appReopened',
    });
    await resolveRecoveryInterval({
      now: at(10, 11), timezone: TIMEZONE, intervalId: focusInterval.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 120 },
      remainder: { kind: 'ignore' },
    });
    const [settings] = await dataStore.getAll<Settings>(STORE.settings);
    const rest = settings!.restSuggestions.find(({ isEnabled }) => isEnabled)!;
    const breakSession = await startBreak({
      now: at(10, 20), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
      suggestedRest: rest.key,
    });
    const breakInterval = await detectRecoveryInterval({
      now: at(10, 30), timezone: TIMEZONE, source: 'systemRecovered',
    });
    const resolved = await resolveRecoveryInterval({
      now: at(10, 31), timezone: TIMEZONE, intervalId: breakInterval.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 180, actualRest: rest.key },
      remainder: { kind: 'ignore' },
    });
    expect(resolved.sourceSession).toMatchObject({
      status: 'completed', endedAt: '2027-03-08T02:23:00.000Z',
      actualDuration: 180, actualRest: rest.key,
    });
    expect((await eventsFor(resolved.correlationId)).map(({ type }) => type)).toEqual([
      'break.completed', 'interval.sessionResolved', 'interval.ignored',
    ]);
  });

  it('rolls Layer 1 back when Layer 2 fails and rejects invalid/out-of-bounds inputs', async () => {
    const task = await createManualTask({
      now: at(10, 55), timezone: TIMEZONE, title: '恢复事务任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(11, 0), timezone: TIMEZONE, taskId: task.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: at(11, 10), timezone: TIMEZONE, source: 'appReopened',
    });
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(resolveRecoveryInterval({
      now: at(11, 11), timezone: TIMEZONE, intervalId: detected.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 60 },
      remainder: { kind: 'extraRest', actualDuration: 60, actualRest: 'missing-rest-key' },
    })).rejects.toThrow(/休息项 key/);
    expect(await visibleSession(focus.value.id)).toMatchObject({
      status: 'active', endedAt: null, actualDuration: null,
    });
    expect(await dataStore.get<UnresolvedInterval>(
      STORE.unresolvedIntervals,
      detected.interval!.id,
    )).toMatchObject({ status: 'pending' });
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    await expect(resolveRecoveryInterval({
      now: at(11, 11), timezone: TIMEZONE, intervalId: detected.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 601 },
      remainder: { kind: 'ignore' },
    })).rejects.toThrow(/超出 interval/);
    await expect(resolveRecoveryInterval({
      now: at(11, 11), timezone: TIMEZONE, intervalId: detected.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 600 },
      remainder: {
        kind: 'extraFocus', taskId: task.value.id, actualDuration: 1,
      },
    })).rejects.toThrow(/超出 interval/);
    await resolveRecoveryInterval({
      now: at(11, 12), timezone: TIMEZONE, intervalId: detected.interval!.id,
      original: { resolvedAs: 'discarded', actualDuration: 30 },
      remainder: { kind: 'ignore' },
    });

    const beforeInvalidSource = (await dataStore.getAll<UnresolvedInterval>(
      STORE.unresolvedIntervals,
    )).length;
    await expect(detectRecoveryInterval({
      now: at(11, 13), timezone: TIMEZONE,
      source: 'timerStateLost' as RecoveryDetectionSource,
    })).rejects.toThrow(/仅支持/);
    expect(await dataStore.getAll<UnresolvedInterval>(STORE.unresolvedIntervals)).toHaveLength(
      beforeInvalidSource,
    );
  });

  it('rolls interval detection back when the matching Event fails validation', async () => {
    const missingTaskId = newId();
    const malformedActive = makeSession({
      now: at(12, 0),
      startedAt: at(12, 0),
      timezone: TIMEZONE,
      type: 'focus',
      taskId: missingTaskId,
      plannedDuration: 1_500,
      pomodoroIndex: 1,
    });
    // Direct storage setup deliberately bypasses the write validator so interval.detected
    // fails only after the interval entity has entered the same transaction.
    await internalDataStore.put(STORE.sessions, malformedActive);
    const beforeIntervalIds = new Set(
      (await dataStore.getAll<UnresolvedInterval>(STORE.unresolvedIntervals)).map(({ id }) => id),
    );

    await expect(detectRecoveryInterval({
      now: at(12, 1), timezone: TIMEZONE, source: 'appReopened',
    })).rejects.toThrow(/event\.association\.missing/);

    expect((await dataStore.getAll<UnresolvedInterval>(STORE.unresolvedIntervals)).filter(
      ({ id }) => !beforeIntervalIds.has(id),
    )).toEqual([]);
    expect((await dataStore.getAll<Event>(EVENT_STORE)).some(
      (event) => event.type === 'interval.detected' && event.sessionId === malformedActive.id,
    )).toBe(false);
  });
});
