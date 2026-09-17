import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKUP_INTERVAL_MINUTES,
  getBackupPreferences,
  updateBackupPreferences,
} from './backupPreferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe('backup preferences', () => {
  it('defaults to disabled auto-backup every 5 minutes', () => {
    expect(getBackupPreferences(memoryStorage())).toMatchObject({
      enabled: false,
      intervalMinutes: DEFAULT_BACKUP_INTERVAL_MINUTES,
      directoryName: null,
    });
  });

  it('merges a patch and clamps the interval', () => {
    const storage = memoryStorage();
    const saved = updateBackupPreferences(
      { enabled: true, intervalMinutes: 15, directoryName: 'Backups' },
      storage,
    );
    expect(saved).toMatchObject({
      enabled: true,
      intervalMinutes: 15,
      directoryName: 'Backups',
    });
    expect(getBackupPreferences(storage)).toEqual(saved);
    expect(updateBackupPreferences({ intervalMinutes: 0 }, storage).intervalMinutes).toBe(1);
    expect(updateBackupPreferences({ intervalMinutes: 999 }, storage).intervalMinutes).toBe(120);
  });

  it('ignores a corrupted stored value', () => {
    const storage = memoryStorage({ 'pomodoro:backupPreferences': '{not json' });
    expect(getBackupPreferences(storage).enabled).toBe(false);
  });
});
