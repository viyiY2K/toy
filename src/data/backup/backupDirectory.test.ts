import { describe, expect, it } from 'vitest';
import {
  clearBackupDirectoryHandle,
  loadBackupDirectoryHandle,
  saveBackupDirectoryHandle,
} from './backupDirectory';

describe('backup directory handle persistence', () => {
  it('saves, loads, and clears a directory handle', async () => {
    const handle = { name: 'Backups' };
    await saveBackupDirectoryHandle(handle);
    expect(await loadBackupDirectoryHandle()).toEqual(handle);
    await clearBackupDirectoryHandle();
    expect(await loadBackupDirectoryHandle()).toBeNull();
  });
});
