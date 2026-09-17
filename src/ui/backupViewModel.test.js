import { describe, expect, it } from 'vitest';
import {
  AUTO_BACKUP_FILE_NAME,
  canPickBackupDirectory,
  formatBackupStatus,
  suggestedManualBackupFileName,
} from './backupViewModel';

describe('backup view model', () => {
  it('names a manual backup with a local timestamp', () => {
    expect(suggestedManualBackupFileName(new Date(2026, 8, 17, 14, 5, 9))).toBe(
      'toy-backup-20260917-140509.json',
    );
  });

  it('detects whether the current environment can pick a folder', () => {
    expect(canPickBackupDirectory({})).toBe(false);
    expect(canPickBackupDirectory({ showDirectoryPicker: () => undefined })).toBe(true);
  });

  it('explains auto-backup status', () => {
    expect(formatBackupStatus({ enabled: false }, { canPickDirectory: false })).toMatch(/Chrome \/ Edge/);
    expect(formatBackupStatus({
      enabled: true,
      intervalMinutes: 5,
      directoryName: 'Backups',
      lastSuccessAt: null,
      lastError: null,
    })).toBe(`每 5 分钟覆盖写入「Backups」里的 ${AUTO_BACKUP_FILE_NAME}`);
    expect(formatBackupStatus({
      enabled: true,
      intervalMinutes: 5,
      directoryName: 'Backups',
      lastSuccessAt: null,
      lastError: '没有写入权限',
    })).toMatch(/上次失败：没有写入权限/);
  });
});
