import { describe, expect, it } from 'vitest';
import {
  acceptDayPlanBudget,
  addDayPlanDeduction,
  addTaskToToday,
  archiveCompletedTask,
  completeBreak,
  completeFocus,
  completeTaskFromPomodoro,
  completeTaskManually,
  createManualTask,
  dataStore,
  detectRecoveryInterval,
  discardFocus,
  endWorkAfterFocus,
  estimateDayPlanBudget,
  EVENT_STORE,
  loadCurrentTaskViews,
  loadCurrentTimerViews,
  recordEnergy,
  recordInterrupt,
  reorderTodayTask,
  resolveRecoveryInterval,
  skipPendingBreak,
  startBreak,
  startFocus,
  STORE,
  uncompleteTask,
  updateDayPlanWorkWindow,
  type Event,
  type Session,
} from '../index';

const TIMEZONE = 'Asia/Shanghai';
const BASE_TIME = Date.parse('2027-07-01T01:00:00.000Z');
const at = (minute: number) => new Date(BASE_TIME + minute * 60_000).toISOString();

describe('Phase 2 S5 core self-use integration', () => {
  it('runs planning, awareness, timer, recovery, exits, and Task lifecycle on shared v4 facts', async () => {
    await updateDayPlanWorkWindow({
      now: at(0), timezone: TIMEZONE, workWindowMin: 240,
    });
    await addDayPlanDeduction({
      now: at(1), timezone: TIMEZONE,
      deductionType: 'fixed', label: '集成回归', hours: 0.5,
    });
    const estimate = await estimateDayPlanBudget({ now: at(2), timezone: TIMEZONE });
    expect(estimate.value.estimate).toMatchObject({ workWindowMin: 240, freeMin: 210 });
    await acceptDayPlanBudget({
      now: at(3), timezone: TIMEZONE, budgetMode: 'manual', budgetPomodoros: 4,
    });

    const primary = await createManualTask({
      now: at(4), timezone: TIMEZONE, title: '跨域主任务',
      estimatedPomodoros: 2, destination: 'today',
    });
    const secondary = await createManualTask({
      now: at(5), timezone: TIMEZONE, title: '跨域次任务',
      estimatedPomodoros: 1, destination: 'list',
    });
    const added = await addTaskToToday({
      now: at(6), timezone: TIMEZONE, taskId: secondary.value.id, source: 'button',
    });
    const secondaryIndex = added.value.taskIds.indexOf(secondary.value.id);
    await reorderTodayTask({
      now: at(7), timezone: TIMEZONE, fromIndex: secondaryIndex, toIndex: 1,
    });
    await recordEnergy({
      now: at(8), timezone: TIMEZONE, source: 'dayStart', energyLevel: 6,
    });

    const firstFocus = await startFocus({
      now: at(9), timezone: TIMEZONE, taskId: primary.value.id,
    });
    await recordInterrupt({
      now: at(10), timezone: TIMEZONE, sessionId: firstFocus.value.id,
      kind: 'internal', offsetSeconds: 17,
    });
    await recordInterrupt({
      now: at(11), timezone: TIMEZONE, sessionId: firstFocus.value.id,
      kind: 'external', offsetSeconds: 29,
    });
    const completedFirst = await completeFocus({
      now: at(12), timezone: TIMEZONE,
      sessionId: firstFocus.value.id, actualDuration: 123,
    });
    expect(completedFirst.value.actualDuration).toBe(123);
    await recordEnergy({
      now: at(13), timezone: TIMEZONE, source: 'afterFocus',
      sessionId: firstFocus.value.id, energyLevel: 5,
    });
    const skipped = await skipPendingBreak({
      now: at(14), timezone: TIMEZONE, sourceFocusSessionId: firstFocus.value.id,
    });
    expect(skipped.value).toMatchObject({
      status: 'skipped', actualDuration: 0, skipKind: 'explicitSkip',
    });

    const secondFocus = await startFocus({
      now: at(15), timezone: TIMEZONE, taskId: primary.value.id,
    });
    await completeFocus({
      now: at(16), timezone: TIMEZONE,
      sessionId: secondFocus.value.id, actualDuration: 111,
    });
    const breakSession = await startBreak({
      now: at(17), timezone: TIMEZONE, sourceFocusSessionId: secondFocus.value.id,
    });
    const breakType = breakSession.value.type;
    if (breakType !== 'shortBreak' && breakType !== 'longBreak') {
      throw new Error('standard break command returned a non-standard Session');
    }
    expect(breakType).toBe('shortBreak');
    const [rest] = (await loadCurrentTimerViews({ now: at(18), timezone: TIMEZONE }))
      .taskViews.settings.restSuggestions.filter(
        ({ isEnabled, appliesTo }) => isEnabled && appliesTo.includes(breakType),
      );
    const completedBreak = await completeBreak({
      now: at(19), timezone: TIMEZONE, sessionId: breakSession.value.id,
      actualDuration: 77, actualRest: rest!.key,
    });
    expect(completedBreak.value).toMatchObject({
      status: 'completed', actualDuration: 77, actualRest: rest!.key,
    });
    await recordEnergy({
      now: at(20), timezone: TIMEZONE, source: 'afterShortBreak',
      sessionId: breakSession.value.id, energyLevel: 7,
    });
    const pomodoroCompleted = await completeTaskFromPomodoro({
      now: at(21), timezone: TIMEZONE, sessionId: secondFocus.value.id,
    });
    expect(pomodoroCompleted.value).toMatchObject({
      status: 'completed', completionSource: 'pomodoro',
    });

    const manualCompleted = await completeTaskManually({
      now: at(22), timezone: TIMEZONE, taskId: secondary.value.id,
    });
    expect(manualCompleted.value.completionSource).toBe('manual');
    await uncompleteTask({
      now: at(23), timezone: TIMEZONE, taskId: secondary.value.id,
    });

    const recoveredFocus = await startFocus({
      now: at(24), timezone: TIMEZONE, taskId: secondary.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: at(27), timezone: TIMEZONE, source: 'appReopened',
    });
    const resolved = await resolveRecoveryInterval({
      now: at(28), timezone: TIMEZONE, intervalId: detected.interval!.id,
      original: { resolvedAs: 'completed', actualDuration: 60 },
      remainder: { kind: 'extraRest', actualDuration: 30, actualRest: null },
    });
    expect(resolved.sourceSession).toMatchObject({
      id: recoveredFocus.value.id, status: 'completed', actualDuration: 60,
    });
    expect(resolved.extraSession).toMatchObject({
      type: 'extraRest', status: 'completed', actualDuration: 30,
      originIntervalId: detected.interval!.id,
    });
    await endWorkAfterFocus({
      now: at(29), timezone: TIMEZONE,
      sourceFocusSessionId: recoveredFocus.value.id,
    });

    const finalFocus = await startFocus({
      now: at(30), timezone: TIMEZONE, taskId: secondary.value.id,
    });
    await discardFocus({
      now: at(31), timezone: TIMEZONE,
      sessionId: finalFocus.value.id, actualDuration: 19,
    });
    await archiveCompletedTask({
      now: at(32), timezone: TIMEZONE, taskId: primary.value.id,
    });

    const [taskViews, timerViews, sessions, events] = await Promise.all([
      loadCurrentTaskViews({ now: at(33), timezone: TIMEZONE }),
      loadCurrentTimerViews({ now: at(33), timezone: TIMEZONE }),
      dataStore.getAll<Session>(STORE.sessions),
      dataStore.getAll<Event>(EVENT_STORE),
    ]);
    expect(taskViews.dayPlan).toMatchObject({ budgetMode: 'manual', budgetPomodoros: 4 });
    expect(taskViews.dayPlan.taskIds).not.toContain(primary.value.id);
    expect(taskViews.todayTasks.map(({ id }) => id)).toContain(secondary.value.id);
    expect(taskViews.completedTasks.map(({ id }) => id)).not.toContain(primary.value.id);
    expect(timerViews).toMatchObject({ activeSession: null, pendingBreakFocus: null });
    expect(sessions.find(({ id }) => id === firstFocus.value.id)?.actualDuration).toBe(123);
    expect(sessions.find(({ id }) => id === breakSession.value.id)?.actualDuration).toBe(77);
    expect(events.map(({ type }) => type).filter((type) => [
      'dayPlan.budgetAccepted',
      'interrupt.internal',
      'interrupt.external',
      'break.skipped',
      'interval.detected',
      'interval.classified',
      'dayPlan.workEnded',
      'task.archived',
    ].includes(type))).toEqual(expect.arrayContaining([
      'dayPlan.budgetAccepted',
      'interrupt.internal',
      'interrupt.external',
      'break.skipped',
      'interval.detected',
      'interval.classified',
      'dayPlan.workEnded',
      'task.archived',
    ]));
    expect(events.some(({ type }) => type === 'dayPlan.budgetModeChanged')).toBe(false);
  });
});
