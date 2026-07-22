import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { Event, Session, Settings, Task } from '../schema';
import { createManualTask } from './taskCommands';
import { detectRecoveryInterval, resolveRecoveryInterval } from './intervalCommands';
import {
  completeBreak,
  completeFocus,
  completeTaskFromPomodoro,
  discardFocus,
  endWorkAfterFocus,
  skipActiveBreak,
  skipPendingBreak,
  startBreak,
  startFocus,
} from './timerCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (hour: number, minute: number) =>
  `2026-11-01T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

function failTimezoneAfterReads<T extends object>(
  input: T,
  validReadCount: number,
  counter: { reads: number },
): T & { readonly timezone: string } {
  return Object.defineProperty(input, 'timezone', {
    enumerable: true,
    get: () => (++counter.reads <= validReadCount ? TIMEZONE : 'Invalid/TimeZone'),
  }) as T & { readonly timezone: string };
}

describe('S13a-2 standard timer commands', () => {
  it('completes focus/break with caller-provided durations and confirms Task completion from Sessions', async () => {
    const task = await createManualTask({
      now: at(8, 0), timezone: TIMEZONE, title: '计时任务', destination: 'today',
    });
    const focus = await startFocus({ now: at(8, 1), timezone: TIMEZONE, taskId: task.value.id });
    expect(focus.value).toMatchObject({
      type: 'focus', status: 'active', plannedDuration: 1500, actualDuration: null, pomodoroIndex: 1,
    });
    expect((await eventsFor(focus.correlationId))[0]).toMatchObject({
      type: 'focus.started', payload: { pomodoroIndex: 1, plannedDuration: 1500, taskEstimateAtStart: 1 },
    });
    await expect(startFocus({ now: at(8, 2), timezone: TIMEZONE, taskId: task.value.id })).rejects.toThrow(/进行中/);

    const completedFocus = await completeFocus({
      now: at(8, 26), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 1379,
    });
    expect(completedFocus.value).toMatchObject({ status: 'completed', actualDuration: 1379 });
    expect((await eventsFor(completedFocus.correlationId))[0]).toMatchObject({
      type: 'focus.completed', payload: { actualDuration: 1379 },
    });

    const taskCompletion = await completeTaskFromPomodoro({
      now: at(8, 27), timezone: TIMEZONE, sessionId: focus.value.id,
    });
    expect(taskCompletion.value).toMatchObject({ status: 'completed', completionSource: 'pomodoro' });
    expect((await eventsFor(taskCompletion.correlationId))[0]).toMatchObject({
      type: 'task.completed', sessionId: focus.value.id,
      payload: { completionSource: 'pomodoro', validFocusCountAtCompletion: 1 },
    });

    const blockedTask = await createManualTask({
      now: at(8, 27), timezone: TIMEZONE, title: '休息机会未关闭时不可开始', destination: 'list',
    });
    await expect(startFocus({
      now: at(8, 27), timezone: TIMEZONE, taskId: blockedTask.value.id,
    })).rejects.toThrow(/break 机会尚未创建/);

    const [settings] = await dataStore.getAll<Settings>(STORE.settings);
    const shortRest = settings!.restSuggestions.find(({ appliesTo }) => appliesTo.includes('shortBreak'))!;
    const breakSession = await startBreak({
      now: at(8, 28), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
      suggestedRest: shortRest.key,
    });
    expect(breakSession.value).toMatchObject({ type: 'shortBreak', plannedDuration: 300 });
    const completedBreak = await completeBreak({
      now: at(8, 33), timezone: TIMEZONE, sessionId: breakSession.value.id,
      actualDuration: 181, actualRest: shortRest.key,
    });
    expect(completedBreak.value).toMatchObject({
      status: 'completed', actualDuration: 181, actualRest: shortRest.key,
    });
    expect((await eventsFor(completedBreak.correlationId))[0]).toMatchObject({
      type: 'break.completed', payload: { actualDuration: 181, actualRest: shortRest.key },
    });
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(startBreak({
      now: at(8, 34), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    })).rejects.toThrow(/已经创建/);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('keeps discarded focus indexes occupied without opening a standard break opportunity', async () => {
    const task = await createManualTask({
      now: at(9, 0), timezone: TIMEZONE, title: '作废序号任务', destination: 'list',
    });
    const first = await startFocus({ now: at(9, 1), timezone: TIMEZONE, taskId: task.value.id });
    const discarded = await discardFocus({
      now: at(9, 2), timezone: TIMEZONE, sessionId: first.value.id, actualDuration: 42,
    });
    expect(discarded.value).toMatchObject({ status: 'discarded', pomodoroIndex: 1, actualDuration: 42 });
    expect((await eventsFor(discarded.correlationId))[0]).toMatchObject({
      type: 'focus.discarded',
      payload: { pomodoroIndex: 1, actualDuration: 42, reason: 'userInitiated', triggeredByInterruptEventId: null },
    });
    const second = await startFocus({ now: at(9, 3), timezone: TIMEZONE, taskId: task.value.id });
    expect(second.value.pomodoroIndex).toBe(2);
    await discardFocus({
      now: at(9, 4), timezone: TIMEZONE, sessionId: second.value.id, actualDuration: 1,
    });
  });

  it('derives the fourth completed focus globally as longBreak across different Tasks', async () => {
    const breakTypes: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const minute = index * 10;
      const task = await createManualTask({
        now: at(10, minute), timezone: TIMEZONE, title: `全局节奏 ${index + 2}`, destination: 'list',
      });
      const focus = await startFocus({
        now: at(10, minute + 1), timezone: TIMEZONE, taskId: task.value.id,
      });
      expect(focus.value.pomodoroIndex).toBe(1);
      await completeFocus({
        now: at(10, minute + 2), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
      });
      const breakSession = await startBreak({
        now: at(10, minute + 3), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
      });
      breakTypes.push(breakSession.value.type);
      await completeBreak({
        now: at(10, minute + 4), timezone: TIMEZONE, sessionId: breakSession.value.id,
        actualDuration: 30, actualRest: null,
      });
    }
    expect(breakTypes).toEqual(['shortBreak', 'shortBreak', 'longBreak']);
    const sessions = await dataStore.getAll<Session>(STORE.sessions);
    expect(sessions.filter(({ type, status }) => type === 'focus' && status === 'completed')).toHaveLength(4);
    expect(sessions.some(({ type, status }) => type === 'longBreak' && status === 'completed')).toBe(true);
    expect((await dataStore.getAll<Task>(STORE.tasks)).some(({ title }) => title.startsWith('全局节奏'))).toBe(true);
  });

  it('explicitly skips pending and active standard breaks and then permits the next focus', async () => {
    const pendingTask = await createManualTask({
      now: at(11, 0), timezone: TIMEZONE, title: '待开始休息跳过', destination: 'list',
    });
    const pendingFocus = await startFocus({
      now: at(11, 1), timezone: TIMEZONE, taskId: pendingTask.value.id,
    });
    await completeFocus({
      now: at(11, 2), timezone: TIMEZONE, sessionId: pendingFocus.value.id, actualDuration: 60,
    });
    const skippedPending = await skipPendingBreak({
      now: at(11, 3), timezone: TIMEZONE, sourceFocusSessionId: pendingFocus.value.id,
    });
    expect(skippedPending.value).toMatchObject({
      type: 'shortBreak',
      status: 'skipped',
      startedAt: at(11, 3),
      endedAt: at(11, 3),
      actualDuration: 0,
      skipKind: 'explicitSkip',
      sourceFocusSessionId: pendingFocus.value.id,
    });
    expect((await eventsFor(skippedPending.correlationId))[0]).toMatchObject({
      type: 'break.skipped',
      sessionId: skippedPending.value.id,
      dayPlanId: skippedPending.value.dayPlanId,
      payload: {
        breakType: 'shortBreak', skipKind: 'explicitSkip', plannedDuration: 300,
      },
    });
    await expect(skipPendingBreak({
      now: at(11, 4), timezone: TIMEZONE, sourceFocusSessionId: pendingFocus.value.id,
    })).rejects.toThrow(/已经关闭/);

    const activeTask = await createManualTask({
      now: at(11, 5), timezone: TIMEZONE, title: '进行中休息跳过', destination: 'list',
    });
    const activeFocus = await startFocus({
      now: at(11, 6), timezone: TIMEZONE, taskId: activeTask.value.id,
    });
    await completeFocus({
      now: at(11, 7), timezone: TIMEZONE, sessionId: activeFocus.value.id, actualDuration: 60,
    });
    const activeBreak = await startBreak({
      now: at(11, 8), timezone: TIMEZONE, sourceFocusSessionId: activeFocus.value.id,
    });
    const skippedActive = await skipActiveBreak({
      now: at(11, 9), timezone: TIMEZONE, sessionId: activeBreak.value.id,
    });
    expect(skippedActive.value).toMatchObject({
      id: activeBreak.value.id,
      status: 'skipped',
      endedAt: at(11, 9),
      actualDuration: 0,
      skipKind: 'explicitSkip',
    });
    expect((await eventsFor(skippedActive.correlationId))[0]).toMatchObject({
      type: 'break.skipped',
      sessionId: activeBreak.value.id,
      payload: {
        breakType: activeBreak.value.type,
        skipKind: 'explicitSkip',
        plannedDuration: activeBreak.value.plannedDuration,
      },
    });

    const exitTypes = [skippedPending.value.type, skippedActive.value.type];
    for (let index = 0; index < 2; index += 1) {
      const minute = 10 + index * 3;
      const cadenceFocus = await startFocus({
        now: at(11, minute), timezone: TIMEZONE, taskId: activeTask.value.id,
      });
      await completeFocus({
        now: at(11, minute + 1), timezone: TIMEZONE,
        sessionId: cadenceFocus.value.id, actualDuration: 60,
      });
      const cadenceSkip = await skipPendingBreak({
        now: at(11, minute + 2), timezone: TIMEZONE,
        sourceFocusSessionId: cadenceFocus.value.id,
      });
      exitTypes.push(cadenceSkip.value.type);
    }
    expect(exitTypes).toEqual(['shortBreak', 'shortBreak', 'shortBreak', 'longBreak']);

    const next = await startFocus({
      now: at(11, 16), timezone: TIMEZONE, taskId: activeTask.value.id,
    });
    await discardFocus({
      now: at(11, 17), timezone: TIMEZONE, sessionId: next.value.id, actualDuration: 1,
    });
  });

  it('keeps recovered active breaks on interval.sessionResolved instead of break.skipped', async () => {
    const task = await createManualTask({
      now: at(12, 0), timezone: TIMEZONE, title: '恢复休息不能普通跳过', destination: 'list',
    });
    const focus = await startFocus({ now: at(12, 1), timezone: TIMEZONE, taskId: task.value.id });
    await completeFocus({
      now: at(12, 2), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    const breakSession = await startBreak({
      now: at(12, 3), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: at(12, 8), timezone: TIMEZONE, source: 'appReopened',
    });
    const breakSkippedCount = (await dataStore.getAll<Event>(EVENT_STORE))
      .filter(({ type }) => type === 'break.skipped').length;
    await expect(skipActiveBreak({
      now: at(12, 9), timezone: TIMEZONE, sessionId: breakSession.value.id,
    })).rejects.toThrow(/恢复流程/);
    expect((await dataStore.getAll<Event>(EVENT_STORE))
      .filter(({ type }) => type === 'break.skipped')).toHaveLength(breakSkippedCount);

    const resolved = await resolveRecoveryInterval({
      now: at(12, 9),
      timezone: TIMEZONE,
      intervalId: detected.interval!.id,
      original: { resolvedAs: 'skipped' },
      remainder: { kind: 'ignore' },
    });
    expect(resolved.sourceSession).toMatchObject({
      status: 'skipped', actualDuration: 0, skipKind: 'missed',
    });
    expect((await eventsFor(resolved.correlationId)).map(({ type }) => type)).toEqual([
      'interval.sessionResolved', 'interval.ignored',
    ]);
  });

  it('ends work only by explicit anchor and rolls back skip writes when Event creation fails', async () => {
    const workTask = await createManualTask({
      now: at(13, 0), timezone: TIMEZONE, title: '明确今日收工', destination: 'today',
    });
    const focus = await startFocus({ now: at(13, 1), timezone: TIMEZONE, taskId: workTask.value.id });
    await completeFocus({
      now: at(13, 2), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    const sessionsBefore = await dataStore.getAll<Session>(STORE.sessions);
    const result = await endWorkAfterFocus({
      now: at(13, 3), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    });
    expect(result.value).toMatchObject({
      type: 'dayPlan.workEnded',
      taskId: workTask.value.id,
      sessionId: focus.value.id,
      dayPlanId: focus.value.dayPlanId,
      localDate: '2026-11-01',
      payload: {
        appDate: '2026-11-01',
        localDate: '2026-11-01',
        endedAfterFocusSessionId: focus.value.id,
        reason: 'userEndedWork',
      },
    });
    expect(await dataStore.getAll<Session>(STORE.sessions)).toEqual(sessionsBefore);
    expect((await eventsFor(result.correlationId)).map(({ type }) => type)).toEqual([
      'dayPlan.workEnded',
    ]);
    await expect(startBreak({
      now: at(13, 4), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    })).rejects.toThrow(/收工豁免/);

    const nextTask = await createManualTask({
      now: at(13, 5), timezone: TIMEZONE, title: '收工锚点后可再开始', destination: 'list',
    });
    const next = await startFocus({
      now: at(13, 6), timezone: TIMEZONE, taskId: nextTask.value.id,
    });
    await discardFocus({
      now: at(13, 7), timezone: TIMEZONE, sessionId: next.value.id, actualDuration: 1,
    });

    const rollbackTask = await createManualTask({
      now: at(13, 8), timezone: TIMEZONE, title: '跳过事务回滚', destination: 'list',
    });
    const rollbackFocus = await startFocus({
      now: at(13, 9), timezone: TIMEZONE, taskId: rollbackTask.value.id,
    });
    await completeFocus({
      now: at(13, 10), timezone: TIMEZONE, sessionId: rollbackFocus.value.id, actualDuration: 60,
    });
    const rollbackBreak = await startBreak({
      now: at(13, 11), timezone: TIMEZONE, sourceFocusSessionId: rollbackFocus.value.id,
    });
    const breakBefore = await dataStore.get<Session>(STORE.sessions, rollbackBreak.value.id);
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const fault = { reads: 0 };
    await expect(skipActiveBreak(failTimezoneAfterReads({
      now: at(13, 12), sessionId: rollbackBreak.value.id,
    }, 1, fault))).rejects.toThrow();
    expect(fault.reads).toBe(2);
    expect(await dataStore.get<Session>(STORE.sessions, rollbackBreak.value.id)).toEqual(breakBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
    await skipActiveBreak({
      now: at(13, 13), timezone: TIMEZONE, sessionId: rollbackBreak.value.id,
    });

    const pendingRollbackFocus = await startFocus({
      now: at(13, 14), timezone: TIMEZONE, taskId: rollbackTask.value.id,
    });
    await completeFocus({
      now: at(13, 15), timezone: TIMEZONE,
      sessionId: pendingRollbackFocus.value.id, actualDuration: 60,
    });
    const sessionCount = (await dataStore.getAll<Session>(STORE.sessions)).length;
    const pendingEventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const pendingFault = { reads: 0 };
    // Reads 1–3 initialize, 4 configures the command transaction, 5 builds the Session,
    // and read 6 fails while building the Event after the Session put.
    await expect(skipPendingBreak(failTimezoneAfterReads({
      now: at(13, 16), sourceFocusSessionId: pendingRollbackFocus.value.id,
    }, 5, pendingFault))).rejects.toThrow();
    expect(pendingFault.reads).toBe(6);
    expect(await dataStore.getAll<Session>(STORE.sessions)).toHaveLength(sessionCount);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(pendingEventCount);

    const workEndedFault = { reads: 0 };
    await expect(endWorkAfterFocus(failTimezoneAfterReads({
      now: at(13, 17), sourceFocusSessionId: pendingRollbackFocus.value.id,
    }, 5, workEndedFault))).rejects.toThrow();
    expect(workEndedFault.reads).toBe(6);
    expect((await dataStore.getAll<Event>(EVENT_STORE))
      .filter((event) => event.type === 'dayPlan.workEnded' && event.sessionId === pendingRollbackFocus.value.id))
      .toHaveLength(0);
    await skipPendingBreak({
      now: at(13, 18), timezone: TIMEZONE,
      sourceFocusSessionId: pendingRollbackFocus.value.id,
    });
  });
});
