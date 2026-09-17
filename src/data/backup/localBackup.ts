/**
 * Web 本地 IndexedDB 全量备份的文件格式（v4 §7.14 data.exported / data.imported）。
 *
 * 只描述快照形状与解析校验；真正写文件 / 选文件夹由 UI 负责。
 * 快照包含软删 tombstone，恢复后历史删除事实仍在。
 */

import { dataStore, EVENT_STORE, STORE, STORE_NAMES, type StoreName } from '../dataStore';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';

export const LOCAL_BACKUP_KIND = 'toy.localBackup';
export const LOCAL_BACKUP_FORMAT = 'json';

export type LocalBackupRecords = Record<StoreName, readonly unknown[]>;

export interface LocalBackupFile {
  readonly kind: typeof LOCAL_BACKUP_KIND;
  readonly format: typeof LOCAL_BACKUP_FORMAT;
  readonly schemaVersion: string;
  readonly exportedAt: string;
  readonly totalRecords: number;
  readonly records: LocalBackupRecords;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function countBackupRecords(records: LocalBackupRecords): number {
  return STORE_NAMES.reduce((total, store) => total + records[store].length, 0);
}

export async function createLocalBackupSnapshot(exportedAt: string): Promise<LocalBackupFile> {
  const records = {
    [STORE.tasks]: await dataStore.getAllIncludingDeleted(STORE.tasks),
    [STORE.dayPlans]: await dataStore.getAllIncludingDeleted(STORE.dayPlans),
    [STORE.sessions]: await dataStore.getAllIncludingDeleted(STORE.sessions),
    [STORE.energyRecords]: await dataStore.getAllIncludingDeleted(STORE.energyRecords),
    [STORE.unresolvedIntervals]: await dataStore.getAllIncludingDeleted(STORE.unresolvedIntervals),
    [STORE.settings]: await dataStore.getAllIncludingDeleted(STORE.settings),
    [STORE.mergeGroups]: await dataStore.getAllIncludingDeleted(STORE.mergeGroups),
    [EVENT_STORE]: await dataStore.getAll(EVENT_STORE),
  } as LocalBackupRecords;
  const totalRecords = countBackupRecords(records);
  return {
    kind: LOCAL_BACKUP_KIND,
    format: LOCAL_BACKUP_FORMAT,
    schemaVersion: String(CURRENT_SCHEMA_VERSION),
    exportedAt,
    totalRecords,
    records,
  };
}

export function serializeLocalBackup(backup: LocalBackupFile): string {
  return JSON.stringify(backup);
}

export function parseLocalBackup(jsonText: string): LocalBackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (!isRecord(parsed)) throw new Error('备份文件格式不正确');
  if (parsed.kind !== LOCAL_BACKUP_KIND) throw new Error('这不是本应用的备份文件');
  if (parsed.format !== LOCAL_BACKUP_FORMAT) throw new Error('目前只支持 JSON 备份');
  if (parsed.schemaVersion !== String(CURRENT_SCHEMA_VERSION)) {
    throw new Error(
      `这份备份的数据版本是 ${String(parsed.schemaVersion)}，当前应用是 ${CURRENT_SCHEMA_VERSION}，还不能自动升级后导入`,
    );
  }
  if (typeof parsed.exportedAt !== 'string' || parsed.exportedAt.length === 0) {
    throw new Error('备份文件缺少导出时间');
  }
  if (!isRecord(parsed.records)) throw new Error('备份文件缺少 records');

  const records = {} as Record<StoreName, unknown[]>;
  for (const store of STORE_NAMES) {
    const values = parsed.records[store];
    if (!Array.isArray(values)) throw new Error(`备份文件缺少 ${store} 记录`);
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) {
        throw new Error(`备份文件中 ${store} 有记录缺少 id`);
      }
    }
    records[store] = values;
  }

  const totalRecords = countBackupRecords(records);
  if (parsed.totalRecords !== totalRecords) {
    throw new Error('备份文件记录数对不上，可能已损坏');
  }
  if (records[STORE.settings].length < 1) {
    throw new Error('备份里没有设置记录，不能恢复');
  }

  return {
    kind: LOCAL_BACKUP_KIND,
    format: LOCAL_BACKUP_FORMAT,
    schemaVersion: String(parsed.schemaVersion),
    exportedAt: parsed.exportedAt,
    totalRecords,
    records,
  };
}
