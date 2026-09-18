/**
 * Google 日历连接偏好。只存在当前浏览器，不进可同步 Settings。
 */

import type { DeviceIdentityStorage } from '../sync/deviceIdentity';

const STORAGE_KEY = 'pomodoro:googleCalendarPreferences';

export interface CalendarPreferences {
  readonly connected: boolean;
  readonly enabled: boolean;
  readonly calendarId: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
}

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  connected: false,
  enabled: false,
  calendarId: null,
  lastSuccessAt: null,
  lastError: null,
};

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getCalendarPreferences(
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarPreferences {
  if (!storage) return { ...DEFAULT_CALENDAR_PREFERENCES };
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_CALENDAR_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_CALENDAR_PREFERENCES };
    }
    const record = parsed as Record<string, unknown>;
    const connected = record.connected === true;
    return {
      connected,
      enabled: record.enabled === true,
      calendarId: optionalString(record.calendarId),
      lastSuccessAt: optionalString(record.lastSuccessAt),
      lastError: optionalString(record.lastError),
    };
  } catch {
    return { ...DEFAULT_CALENDAR_PREFERENCES };
  }
}

export function updateCalendarPreferences(
  patch: Partial<CalendarPreferences>,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarPreferences {
  if (!storage) throw new Error('当前环境没有可用的本地偏好存储');
  const current = getCalendarPreferences(storage);
  const next: CalendarPreferences = {
    connected: patch.connected ?? current.connected,
    enabled: patch.enabled ?? current.enabled,
    calendarId: patch.calendarId !== undefined ? optionalString(patch.calendarId) : current.calendarId,
    lastSuccessAt: patch.lastSuccessAt !== undefined
      ? optionalString(patch.lastSuccessAt)
      : current.lastSuccessAt,
    lastError: patch.lastError !== undefined ? optionalString(patch.lastError) : current.lastError,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
