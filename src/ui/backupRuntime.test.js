import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  exportLocalBackup: vi.fn(),
  recordLocalBackupExported: vi.fn(),
}));
vi.mock('../data/index', () => ({
  ...api,
  clearBackupDirectoryHandle: vi.fn(),
  getBackupPreferences: vi.fn(),
  importLocalBackup: vi.fn(),
  loadBackupDirectoryHandle: vi.fn(),
  saveBackupDirectoryHandle: vi.fn(),
  serializeLocalBackup: JSON.stringify,
  updateBackupPreferences: vi.fn(),
}));
import { exportBackupToUserFile } from './backupRuntime';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('manual backup file export', () => {
  it('opens the picker before reading data and records success only after the file is closed', async () => {
    const order = [];
    const snapshot = { totalRecords: 7, records: {} };
    api.exportLocalBackup.mockImplementation(async () => { order.push('snapshot'); return snapshot; });
    api.recordLocalBackupExported.mockImplementation(async () => { order.push('audit'); });
    const write = vi.fn(async () => { order.push('write'); });
    const close = vi.fn(async () => { order.push('close'); });
    const picker = vi.fn(async () => {
      order.push('picker');
      return { createWritable: async () => ({ write, close }) };
    });
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    expect(await exportBackupToUserFile('backup.json')).toBe('saved');
    expect(order).toEqual(['picker', 'snapshot', 'write', 'close', 'audit']);
    expect(write).toHaveBeenCalledWith(JSON.stringify(snapshot));
    expect(api.recordLocalBackupExported).toHaveBeenCalledWith(expect.objectContaining({ totalRecords: 7 }));
  });

  it('cancelling the picker does not read or record an export', async () => {
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => { throw new DOMException('cancelled', 'AbortError'); },
    });
    expect(await exportBackupToUserFile('backup.json')).toBe('cancelled');
    expect(api.exportLocalBackup).not.toHaveBeenCalled();
    expect(api.recordLocalBackupExported).not.toHaveBeenCalled();
  });

  it('aborts a failed file write and never records export success', async () => {
    const abort = vi.fn(async () => undefined);
    api.exportLocalBackup.mockResolvedValue({ totalRecords: 7 });
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => { throw new Error('disk full'); },
          close: vi.fn(),
          abort,
        }),
      }),
    });
    await expect(exportBackupToUserFile('backup.json')).rejects.toThrow('disk full');
    expect(abort).toHaveBeenCalledOnce();
    expect(api.recordLocalBackupExported).not.toHaveBeenCalled();
  });
});
