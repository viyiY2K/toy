/**
 * 本机自动备份偏好。只存在当前浏览器，不进可同步 Settings（文件夹句柄也无法跨设备使用）。
 */

import type { DeviceIdentityStorage } from '../sync/deviceIdentity';

export const DEFAULT_BACKUP_INTERVAL_MINUTES = 5;
export const MIN_BACKUP_INTERVAL_MINUTES = 1;
export const MAX_BACKUP_INTERVAL_MINUTES = 120;

const STORAGE_KEY = 'pomodoro:backupPreferences';

export interface BackupPreferences {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly directoryName: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
}

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = {
  enabled: false,
  intervalMinutes: DEFAULT_BACKUP_INTERVAL_MINUTES,
  directoryName: null,
  lastSuccessAt: null,
  lastError: null,
};

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function clampInterval(value: unknown): number {
  if (!Number.isInteger(value)) return DEFAULT_BACKUP_INTERVAL_MINUTES;
  const minutes = value as number;
  if (minutes < MIN_BACKUP_INTERVAL_MINUTES) return MIN_BACKUP_INTERVAL_MINUTES;
  if (minutes > MAX_BACKUP_INTERVAL_MINUTES) return MAX_BACKUP_INTERVAL_MINUTES;
  return minutes;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getBackupPreferences(
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): BackupPreferences {
  if (!storage) return { ...DEFAULT_BACKUP_PREFERENCES };
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_BACKUP_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_BACKUP_PREFERENCES };
    }
    const record = parsed as Record<string, unknown>;
    return {
      enabled: record.enabled === true,
      intervalMinutes: clampInterval(record.intervalMinutes),
      directoryName: optionalString(record.directoryName),
      lastSuccessAt: optionalString(record.lastSuccessAt),
      lastError: optionalString(record.lastError),
    };
  } catch {
    return { ...DEFAULT_BACKUP_PREFERENCES };
  }
}

export function updateBackupPreferences(
  patch: Partial<BackupPreferences>,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): BackupPreferences {
  if (!storage) throw new Error('当前环境没有可用的本地偏好存储');
  const current = getBackupPreferences(storage);
  const next: BackupPreferences = {
    enabled: patch.enabled ?? current.enabled,
    intervalMinutes: patch.intervalMinutes !== undefined
      ? clampInterval(patch.intervalMinutes)
      : current.intervalMinutes,
    directoryName: patch.directoryName !== undefined ? optionalString(patch.directoryName) : current.directoryName,
    lastSuccessAt: patch.lastSuccessAt !== undefined ? optionalString(patch.lastSuccessAt) : current.lastSuccessAt,
    lastError: patch.lastError !== undefined ? optionalString(patch.lastError) : current.lastError,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
