/**
 * 本地 uid → Google 事件 id。只为了同一次专注重试时更新，不进可同步实体。
 */

import type { DeviceIdentityStorage } from '../sync/deviceIdentity';

const STORAGE_KEY = 'pomodoro:googleCalendarEventIndex';
const MAX_INDEX_ENTRIES = 2000;

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function readIndex(storage: DeviceIdentityStorage): Record<string, string> {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const next: Record<string, string> = {};
    for (const [uid, googleEventId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof googleEventId === 'string' && googleEventId.length > 0) next[uid] = googleEventId;
    }
    return next;
  } catch {
    return {};
  }
}

export function getGoogleEventIdForUid(
  uid: string,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): string | null {
  if (!storage) return null;
  return readIndex(storage)[uid] ?? null;
}

export function rememberGoogleEventId(
  uid: string,
  googleEventId: string,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): void {
  if (!storage) return;
  const current = readIndex(storage);
  current[uid] = googleEventId;
  const entries = Object.entries(current);
  const trimmed = entries.length > MAX_INDEX_ENTRIES
    ? Object.fromEntries(entries.slice(entries.length - MAX_INDEX_ENTRIES))
    : current;
  storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}
