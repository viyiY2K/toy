import { describe, expect, it } from 'vitest';
import {
  canUseActiveBreakExit,
  canCaptureTriage,
  canUsePendingBreakExits,
  canWriteStandardSession,
  elapsedSeconds,
  energySourceForCompletedSession,
  enabledRestSuggestions,
  formatCountdown,
  nextStandardBreakType,
  pageForTimerSnapshot,
  recoveryRestChoices,
  recoveryTaskChoices,
  remainingSeconds,
  isRecoveryRequiredSession,
  shouldDetectAppReopened,
  shouldOfferTaskCompletionCheck,
  shouldRecoverAfterHidden,
  shouldPromptOnReturn,
  timerDisplayTask,
  timerSubtasks,
} from './timerViewModel';

describe('S13c timer view model', () => {
  it('derives display time while keeping completion duration an explicit caller fact', () => {
    const session = { startedAt: '2027-01-01T08:00:00Z', plannedDuration: 300 };
    expect(elapsedSeconds(session, Date.parse('2027-01-01T08:01:02Z'))).toBe(62);
    expect(remainingSeconds(session, Date.parse('2027-01-01T08:01:02Z'))).toBe(238);
    expect(formatCountdown(238)).toBe('03:58');
    expect(remainingSeconds(session, Date.parse('2027-01-01T09:00:00Z'))).toBe(0);
  });

  it('uses the selected task while idle and the linked task for active focus or break', () => {
    const selectedTask = { id: 'selected', title: 'Selected task' };
    const activeTask = { id: 'linked', title: 'Linked task' };

    expect(timerDisplayTask(null, null, selectedTask)).toBe(selectedTask);
    expect(timerDisplayTask({ type: 'focus' }, activeTask, selectedTask)).toBe(activeTask);
    expect(timerDisplayTask({ type: 'shortBreak' }, activeTask, selectedTask)).toBe(activeTask);
  });

  it('returns ordered current subtasks only when the display task has children', () => {
    const active = { id: 'child-active', status: 'active', sortIndex: 0 };
    const completed = { id: 'child-completed', status: 'completed', sortIndex: 1 };
    const taskViews = {
      subtasksByParentId: {
        parent: [active, completed],
      },
    };

    expect(timerSubtasks(taskViews, { id: 'parent' })).toEqual([active, completed]);
    expect(timerSubtasks(taskViews, { id: 'without-children' })).toEqual([]);
    expect(timerSubtasks(taskViews, null)).toEqual([]);
  });

  it('offers Task completion confirmation when valid focus count reaches the current estimate', () => {
    const taskViews = {
      completedValidFocusCountByTaskId: { planning: 1, larger: 1, split: 3, done: 1 },
    };

    expect(shouldOfferTaskCompletionCheck(taskViews, {
      id: 'planning', status: 'active', estimatedPomodoros: 1,
    })).toBe(true);
    expect(shouldOfferTaskCompletionCheck(taskViews, {
      id: 'larger', status: 'active', estimatedPomodoros: 2,
    })).toBe(false);
    expect(shouldOfferTaskCompletionCheck(taskViews, {
      id: 'split', status: 'splitNeeded', estimatedPomodoros: 3,
    })).toBe(true);
    expect(shouldOfferTaskCompletionCheck(taskViews, {
      id: 'done', status: 'completed', estimatedPomodoros: 1,
    })).toBe(false);
    expect(shouldOfferTaskCompletionCheck(taskViews, null)).toBe(false);
  });

  it('uses the global completed-focus cadence for the next standard break', () => {
    expect(nextStandardBreakType(1, 4)).toBe('shortBreak');
    expect(nextStandardBreakType(4, 4)).toBe('longBreak');
  });

  it('filters rest choices by enabled appliesTo membership and stable order', () => {
    const settings = {
      restSuggestions: [
        { key: 'b', isEnabled: true, appliesTo: ['shortBreak'], sortIndex: 2 },
        { key: 'off', isEnabled: false, appliesTo: ['shortBreak'], sortIndex: 0 },
        { key: 'long', isEnabled: true, appliesTo: ['longBreak'], sortIndex: 0 },
        { key: 'a', isEnabled: true, appliesTo: ['shortBreak'], sortIndex: 1 },
      ],
    };
    expect(enabledRestSuggestions(settings, 'shortBreak').map(({ key }) => key)).toEqual(['a', 'b']);
    expect(recoveryRestChoices(settings, 'shortBreak').map(({ key }) => key)).toEqual(['a', 'b']);
    expect(recoveryRestChoices(settings, 'focus').map(({ key }) => key)).toEqual(['long', 'a', 'b']);
  });

  it('offers only existing active/split task facts for extraFocus without duplicates', () => {
    const active = { id: 'active', status: 'active' };
    const split = { id: 'split', status: 'splitNeeded' };
    const completed = { id: 'done', status: 'completed' };
    expect(recoveryTaskChoices({
      todayTasks: [active, completed],
      activeTasks: [active, split],
    })).toEqual([active, split]);
  });

  it('maps only completed standard Sessions to post-session energy sources', () => {
    expect(energySourceForCompletedSession('focus')).toBe('afterFocus');
    expect(energySourceForCompletedSession('shortBreak')).toBe('afterShortBreak');
    expect(energySourceForCompletedSession('longBreak')).toBe('afterLongBreak');
    expect(energySourceForCompletedSession('extraRest')).toBeNull();
  });

  it('prompts on return only after the configured long-break threshold', () => {
    expect(shouldPromptOnReturn(0, 899_999, 15)).toBe(false);
    expect(shouldPromptOnReturn(0, 900_000, 15)).toBe(true);
    expect(shouldPromptOnReturn(null, 900_000, 15)).toBe(false);
  });

  it.each(['focus', 'shortBreak', 'longBreak'])(
    'requires the deferred recovery flow for a pre-existing active %s',
    (type) => {
      const session = { id: `${type}-session`, type, status: 'active' };
      expect(isRecoveryRequiredSession(session, null, new Set())).toBe(true);
      expect(canWriteStandardSession(session, new Set())).toBe(false);
      expect(isRecoveryRequiredSession(session, null, new Set([session.id]))).toBe(false);
      expect(canWriteStandardSession(session, new Set([session.id]))).toBe(true);
      expect(isRecoveryRequiredSession(
        session,
        { interval: { id: 'pending' } },
        new Set([session.id]),
      )).toBe(true);
    },
  );

  it('does not invent recovery work when there is no active Session', () => {
    expect(isRecoveryRequiredSession(null, null, new Set())).toBe(false);
    expect(canWriteStandardSession(null, new Set())).toBe(false);
  });

  it('exposes standard break exits only in pending or same-runtime active-break states', () => {
    const focus = { id: 'focus', type: 'focus', status: 'completed' };
    const activeBreak = { id: 'break', type: 'shortBreak', status: 'active' };
    const runtimeIds = new Set([activeBreak.id]);
    expect(canUsePendingBreakExits(null, focus, null)).toBe(true);
    expect(canUsePendingBreakExits(null, { ...focus, status: 'discarded' }, null)).toBe(false);
    expect(canUsePendingBreakExits(activeBreak, focus, null)).toBe(false);
    expect(canUsePendingBreakExits(null, focus, { interval: { id: 'pending' } })).toBe(false);
    expect(canUseActiveBreakExit(activeBreak, null, runtimeIds)).toBe(true);
    expect(canUseActiveBreakExit({ ...activeBreak, status: 'skipped' }, null, runtimeIds)).toBe(false);
    expect(canUseActiveBreakExit(activeBreak, null, new Set())).toBe(false);
    expect(canUseActiveBreakExit(activeBreak, { interval: { id: 'pending' } }, runtimeIds)).toBe(false);
    expect(canUseActiveBreakExit({ id: 'focus', type: 'focus' }, null, new Set(['focus'])))
      .toBe(false);
  });

  it('detects app-reopen recovery only for a pre-existing active Session without a pending interval', () => {
    const session = { id: 'focus-session' };
    expect(shouldDetectAppReopened(session, null, new Set())).toBe(true);
    expect(shouldDetectAppReopened(session, null, new Set([session.id]))).toBe(false);
    expect(shouldDetectAppReopened(session, { interval: { id: 'pending' } }, new Set())).toBe(false);
    expect(shouldDetectAppReopened(null, null, new Set())).toBe(false);
  });

  it('allows triage capture only in a same-runtime active standard focus', () => {
    const focus = { id: 'focus', type: 'focus', status: 'active' };
    expect(canCaptureTriage(focus, null, new Set(['focus']))).toBe(true);
    expect(canCaptureTriage(focus, { interval: { id: 'pending' } }, new Set(['focus']))).toBe(false);
    expect(canCaptureTriage(focus, null, new Set())).toBe(false);
    expect(canCaptureTriage({ ...focus, type: 'shortBreak' }, null, new Set(['focus']))).toBe(false);
  });

  it('routes a loaded pending recovery directly to the timer while preserving ordinary navigation', () => {
    expect(pageForTimerSnapshot('activities', { interval: { id: 'pending' } })).toBe('timer');
    expect(pageForTimerSnapshot('activities', null)).toBe('activities');
    expect(pageForTimerSnapshot('timer', null)).toBe('timer');
  });

  it('recovers a same-runtime Session only when hidden time crosses its planned end', () => {
    const session = {
      id: 'focus-session',
      startedAt: '2027-01-01T08:00:00Z',
      plannedDuration: 300,
    };
    const runtimeIds = new Set([session.id]);
    expect(shouldRecoverAfterHidden(session, null, runtimeIds, 0, Date.parse(
      '2027-01-01T08:04:59Z',
    ))).toBe(false);
    expect(shouldRecoverAfterHidden(
      session,
      null,
      runtimeIds,
      Date.parse('2027-01-01T08:04:00Z'),
      Date.parse('2027-01-01T08:05:00Z'),
    )).toBe(true);
    expect(shouldRecoverAfterHidden(
      session,
      { interval: { id: 'pending' } },
      runtimeIds,
      Date.parse('2027-01-01T08:04:00Z'),
      Date.parse('2027-01-01T08:05:00Z'),
    )).toBe(false);
    expect(shouldRecoverAfterHidden(
      session,
      null,
      new Set(),
      Date.parse('2027-01-01T08:04:00Z'),
      Date.parse('2027-01-01T08:05:00Z'),
    )).toBe(false);
  });
});
