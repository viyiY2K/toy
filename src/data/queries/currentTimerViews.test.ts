import { describe, expect, it } from 'vitest';
import {
  completeBreak,
  completeFocus,
  createManualTask,
  discardFocus,
  endWorkAfterFocus,
  recordEnergy,
  recordInterrupt,
  startBreak,
  startFocus,
} from '../index';
import { loadCurrentTimerViews } from './currentTimerViews';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) =>
  `2027-01-08T08:${String(minute).padStart(2, '0')}:00+08:00`;

describe('S13c current timer and awareness views', () => {
  it('derives the standard focus, energy, interrupt, and break workflow from v4 facts', async () => {
    const initial = await loadCurrentTimerViews({ now: at(0), timezone: TIMEZONE });
    expect(initial).toMatchObject({
      activeSession: null,
      pendingBreakFocus: null,
      preFocusEnergySource: 'dayStart',
    });

    await recordEnergy({
      now: at(1), timezone: TIMEZONE, source: 'dayStart', energyLevel: 6,
    });
    expect(
      (await loadCurrentTimerViews({ now: at(2), timezone: TIMEZONE })).preFocusEnergySource,
    ).toBeNull();

    const task = await createManualTask({
      now: at(3), timezone: TIMEZONE, title: 'S13c 计时视图任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(4), timezone: TIMEZONE, taskId: task.value.id,
    });
    await recordInterrupt({
      now: at(5), timezone: TIMEZONE, sessionId: focus.value.id,
      kind: 'internal', offsetSeconds: 12,
    });
    await recordInterrupt({
      now: at(6), timezone: TIMEZONE, sessionId: focus.value.id,
      kind: 'external', offsetSeconds: 20,
    });
    expect(await loadCurrentTimerViews({ now: at(7), timezone: TIMEZONE })).toMatchObject({
      activeSession: { id: focus.value.id, type: 'focus' },
      activeTask: { id: task.value.id },
      interruptCounts: { internal: 1, external: 1 },
    });

    await completeFocus({
      now: at(8), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    const afterFocus = await loadCurrentTimerViews({ now: at(9), timezone: TIMEZONE });
    expect(afterFocus).not.toHaveProperty('pendingEnergySession');
    expect(afterFocus).toMatchObject({
      activeSession: null,
      pendingBreakFocus: { id: focus.value.id },
      pendingBreakTask: { id: task.value.id },
      completedFocusCount: 1,
    });

    await recordEnergy({
      now: at(10), timezone: TIMEZONE, source: 'afterFocus',
      sessionId: focus.value.id, energyLevel: 5,
    });
    const readyForBreak = await loadCurrentTimerViews({ now: at(11), timezone: TIMEZONE });
    expect(readyForBreak.pendingBreakFocus?.id).toBe(focus.value.id);

    const rest = readyForBreak.taskViews.settings.restSuggestions.find(
      (item) => item.isEnabled && item.appliesTo.includes('shortBreak'),
    )!;
    const breakSession = await startBreak({
      now: at(12), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
      suggestedRest: rest.key,
    });
    expect(await loadCurrentTimerViews({ now: at(13), timezone: TIMEZONE })).toMatchObject({
      activeSession: { id: breakSession.value.id, type: 'shortBreak' },
      activeTask: { id: task.value.id },
    });

    await completeBreak({
      now: at(14), timezone: TIMEZONE, sessionId: breakSession.value.id,
      actualDuration: 30, actualRest: rest.key,
    });
    expect(await loadCurrentTimerViews({ now: at(15), timezone: TIMEZONE })).toMatchObject({
      activeSession: null,
      pendingBreakFocus: null,
    });

    await recordEnergy({
      now: at(16), timezone: TIMEZONE, source: 'afterShortBreak',
      sessionId: breakSession.value.id, energyLevel: 7,
    });
    expect(await loadCurrentTimerViews({ now: at(17), timezone: TIMEZONE })).toMatchObject({
      activeSession: null,
      pendingBreakFocus: null,
    });

    expect(
      (await loadCurrentTimerViews({ now: at(32), timezone: TIMEZONE })).preFocusEnergySource,
    ).toBe('beforeFocus');
  });

  it('removes an explicitly work-ended focus from pending break and the new-focus guard', async () => {
    const task = await createManualTask({
      now: at(33), timezone: TIMEZONE, title: '收工查询任务', destination: 'today',
    });
    const focus = await startFocus({ now: at(34), timezone: TIMEZONE, taskId: task.value.id });
    await completeFocus({
      now: at(35), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    expect((await loadCurrentTimerViews({ now: at(36), timezone: TIMEZONE })).pendingBreakFocus)
      .toMatchObject({ id: focus.value.id });

    await endWorkAfterFocus({
      now: at(37), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    });
    expect(await loadCurrentTimerViews({ now: at(38), timezone: TIMEZONE })).toMatchObject({
      pendingBreakFocus: null,
      pendingBreakTask: null,
    });

    const nextTask = await createManualTask({
      now: at(39), timezone: TIMEZONE, title: '收工后继续任务', destination: 'list',
    });
    const next = await startFocus({
      now: at(40), timezone: TIMEZONE, taskId: nextTask.value.id,
    });
    await discardFocus({
      now: at(41), timezone: TIMEZONE, sessionId: next.value.id, actualDuration: 1,
    });
  });
});
