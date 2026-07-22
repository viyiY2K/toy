import { describe, expect, it } from 'vitest';
import { internalDataStore } from '../dataStore';
import { STORE } from '../storage/stores';
import { makeSession, makeSettings } from '../schema';
import { loadSessionStats } from './sessionStats';

describe('Phase 3 S3a persisted session stats query', () => {
  it('loads real stores read-only and excludes retained soft-deleted Sessions', async () => {
    const now = '2028-02-10T09:00:00+08:00';
    const settings = makeSettings({ id: 'stats-settings', now, lifetimePomodoroBaseline: 3 });
    const focus = makeSession({
      id: 'stats-focus', now, startedAt: now, timezone: 'Asia/Shanghai', type: 'focus',
      status: 'completed', taskId: 'stats-task', endedAt: '2028-02-10T09:25:00+08:00',
      plannedDuration: 1500, actualDuration: 1200, pomodoroIndex: 1,
    });
    const deleted = makeSession({
      id: 'stats-deleted', now, startedAt: now, timezone: 'Asia/Shanghai', type: 'extraFocus',
      status: 'completed', taskId: 'stats-task', endedAt: now, actualDuration: 600,
      originIntervalId: 'stats-interval', deletedAt: now,
    });
    await internalDataStore.put(STORE.settings, settings);
    await internalDataStore.put(STORE.sessions, focus);
    await internalDataStore.put(STORE.sessions, deleted);

    const result = await loadSessionStats({ kind: 'day', anchorAppDate: '2028-02-10' });
    expect(result.focus).toMatchObject({ validPomodoros: 1, standardSeconds: 1200, extraSeconds: 0 });
    expect(result.lifetime).toMatchObject({ baselineCompleteCycles: 3, focusSeconds: 1200 });
  });
});
