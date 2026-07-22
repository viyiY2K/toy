import { describe, expect, it } from 'vitest';
import { EVENT_STORE, internalDataStore, STORE } from '../dataStore';
import {
  makeDayPlan,
  makeEnergyRecord,
  makeEvent,
  makeSession,
  makeSettings,
  makeTask,
} from '../schema';
import { loadStatsDashboard } from './statsDashboard';

describe('Phase 3 S3b persisted stats dashboard query', () => {
  it('loads all real fact stores through one read-only range query', async () => {
    const now = '2030-04-15T09:00:00+08:00';
    const zone = 'Asia/Shanghai';
    const settings = makeSettings({ id: 'dashboard-settings', now });
    const task = makeTask({ id: 'dashboard-task', now, title: '统计任务', estimatedPomodoros: 1 });
    const focus = makeSession({
      id: 'dashboard-focus', now, startedAt: now, timezone: zone, type: 'focus', status: 'completed',
      taskId: task.id, endedAt: now, plannedDuration: 1500, actualDuration: 1200, pomodoroIndex: 1,
    });
    const energy = makeEnergyRecord({
      id: 'dashboard-energy', now, occurredAt: now, timezone: zone, source: 'manual', energyLevel: 6,
    });
    const dayPlan = makeDayPlan({
      id: 'dashboard-plan', now, timezone: zone, appDayStartOffsetMinutes: 0, budgetPomodoros: 2,
    });
    const completed = makeEvent({
      id: 'dashboard-completed', now, timezone: zone, type: 'task.completed', taskId: task.id,
      payload: { completionSource: 'pomodoro', completedAt: now, validFocusCountAtCompletion: 1 },
    });
    await internalDataStore.put(STORE.settings, settings);
    await internalDataStore.put(STORE.tasks, task);
    await internalDataStore.put(STORE.sessions, focus);
    await internalDataStore.put(STORE.energyRecords, energy);
    await internalDataStore.put(STORE.dayPlans, dayPlan);
    await internalDataStore.appendEvent(completed);

    const result = await loadStatsDashboard({ kind: 'day', anchorAppDate: '2030-04-15' });
    expect(result.session.focus.validPomodoros).toBe(1);
    expect(result.tasks[0]).toMatchObject({ taskId: task.id, validFocusInRange: 1, historicalValidFocus: 1 });
    expect(result.completions).toEqual({ total: 1, manual: 0, pomodoro: 1 });
    expect(result.energy.dailyTrend[0]).toMatchObject({ averageEnergy: 6, sampleCount: 1 });
    expect(result.budget.dailyTrend[0]).toMatchObject({ budgetPomodoros: 2, validPomodoros: 1, usageRate: 0.5 });
  });
});
