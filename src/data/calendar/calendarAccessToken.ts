/**
 * Google 访问令牌短存。只存在当前浏览器，过期后作废。
 * 不进可同步 Settings，也不把令牌写进任务 / 专注记录。
 */

import type { DeviceIdentityStorage } from '../sync/deviceIdentity';

const STORAGE_KEY = 'pomodoro:googleCalendarAccessToken';

export interface CalendarAccessToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export function getCalendarAccessToken(
  nowMs: number = Date.now(),
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarAccessToken | null {
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.accessToken !== 'string' || record.accessToken.length === 0) return null;
    if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) return null;
    if (record.expiresAt <= nowMs) return null;
    return { accessToken: record.accessToken, expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

export function saveCalendarAccessToken(
  accessToken: string,
  expiresAt: number,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarAccessToken {
  if (!storage) throw new Error('当前环境没有可用的本地偏好存储');
  const next: CalendarAccessToken = { accessToken, expiresAt };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearCalendarAccessToken(
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): void {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, '');
}
