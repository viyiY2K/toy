import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { STORE_NAMES } from '../storage/stores';
import {
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_KIND,
  countBackupRecords,
  parseLocalBackup,
  serializeLocalBackup,
  type LocalBackupFile,
} from './localBackup';

function emptyRecords(): LocalBackupFile['records'] {
  return Object.fromEntries(STORE_NAMES.map((store) => [store, []])) as unknown as LocalBackupFile['records'];
}

function validBackup(overrides: Partial<LocalBackupFile> = {}): LocalBackupFile {
  const records = emptyRecords();
  records.settings = [{ id: '01900000-0000-7000-8000-000000000001' }];
  const totalRecords = countBackupRecords(records);
  return {
    kind: LOCAL_BACKUP_KIND,
    format: LOCAL_BACKUP_FORMAT,
    schemaVersion: String(CURRENT_SCHEMA_VERSION),
    exportedAt: '2026-09-17T12:00:00+08:00',
    totalRecords,
    records,
    ...overrides,
  };
}

describe('local backup file format', () => {
  it('round-trips a valid snapshot', () => {
    const backup = validBackup();
    expect(parseLocalBackup(serializeLocalBackup(backup))).toEqual(backup);
  });

  it('rejects random JSON, the wrong kind, and a mismatched schema version', () => {
    expect(() => parseLocalBackup('not-json')).toThrow(/不是有效的 JSON/);
    expect(() => parseLocalBackup(JSON.stringify({ kind: 'other' }))).toThrow(/不是本应用的备份文件/);
    expect(() => parseLocalBackup(serializeLocalBackup(validBackup({ schemaVersion: '1' })))).toThrow(
      /数据版本是 1/,
    );
  });

  it('rejects a missing store, a record without id, and a lying totalRecords', () => {
    const missingStore = validBackup();
    const parsed = JSON.parse(serializeLocalBackup(missingStore)) as Record<string, unknown>;
    const records = { ...(parsed.records as Record<string, unknown>) };
    delete records.tasks;
    parsed.records = records;
    expect(() => parseLocalBackup(JSON.stringify(parsed))).toThrow(/缺少 tasks/);

    expect(() =>
      parseLocalBackup(serializeLocalBackup(validBackup({
        records: { ...emptyRecords(), settings: [{ title: 'no-id' }] },
        totalRecords: 1,
      }))),
    ).toThrow(/缺少 id/);

    expect(() => parseLocalBackup(serializeLocalBackup(validBackup({ totalRecords: 99 })))).toThrow(
      /记录数对不上/,
    );
  });

  it('rejects a backup with no settings records', () => {
    expect(() =>
      parseLocalBackup(serializeLocalBackup(validBackup({
        records: emptyRecords(),
        totalRecords: 0,
      }))),
    ).toThrow(/没有设置记录/);
  });
});
