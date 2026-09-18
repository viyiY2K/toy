/**
 * 日历写入队列。只存在当前浏览器，失败后可重试，不进入可同步实体。
 */

import type { DeviceIdentityStorage } from '../sync/deviceIdentity';
import {
  googleCalendarEventId,
  type CalendarEventDraft,
} from './mapSessionToCalendarEvents';

const STORAGE_KEY = 'pomodoro:googleCalendarQueue';
const MAX_QUEUE_LENGTH = 200;

export interface CalendarQueueItem {
  readonly uid: string;
  readonly draft: CalendarEventDraft;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function isDraft(value: unknown): value is CalendarEventDraft {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.uid === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.taskId === 'string'
    && typeof record.title === 'string'
    && typeof record.description === 'string'
    && typeof record.start === 'string'
    && typeof record.end === 'string'
    && typeof record.timeZone === 'string'
    && typeof record.discarded === 'boolean'
    && typeof record.actualDuration === 'number';
}

function normalizeDraft(draft: CalendarEventDraft): CalendarEventDraft {
  return {
    ...draft,
    eventId: draft.eventId || googleCalendarEventId(draft.sessionId, draft.taskId),
  };
}

function readQueue(storage: DeviceIdentityStorage): CalendarQueueItem[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.uid !== 'string' || !isDraft(record.draft)) return [];
      return [{
        uid: record.uid,
        draft: normalizeDraft(record.draft),
        enqueuedAt: typeof record.enqueuedAt === 'string' ? record.enqueuedAt : record.draft.start,
        attempts: Number.isInteger(record.attempts) ? Number(record.attempts) : 0,
        lastError: typeof record.lastError === 'string' ? record.lastError : null,
      }];
    });
  } catch {
    return [];
  }
}

function writeQueue(storage: DeviceIdentityStorage, items: readonly CalendarQueueItem[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_QUEUE_LENGTH)));
}

export function peekCalendarQueue(
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarQueueItem[] {
  if (!storage) return [];
  return readQueue(storage);
}

export function enqueueCalendarDrafts(
  drafts: readonly CalendarEventDraft[],
  now: string,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarQueueItem[] {
  if (!storage) throw new Error('当前环境没有可用的本地偏好存储');
  const current = readQueue(storage);
  const byUid = new Map(current.map((item) => [item.uid, item]));
  for (const draft of drafts) {
    const existing = byUid.get(draft.uid);
    byUid.set(draft.uid, {
      uid: draft.uid,
      draft: normalizeDraft(draft),
      enqueuedAt: existing?.enqueuedAt ?? now,
      attempts: existing?.attempts ?? 0,
      lastError: existing?.lastError ?? null,
    });
  }
  const next = [...byUid.values()];
  writeQueue(storage, next);
  return next;
}

export function removeCalendarQueueItems(
  uids: readonly string[],
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarQueueItem[] {
  if (!storage) return [];
  const remove = new Set(uids);
  const next = readQueue(storage).filter((item) => !remove.has(item.uid));
  writeQueue(storage, next);
  return next;
}

export function recordCalendarQueueError(
  uid: string,
  error: string,
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): CalendarQueueItem[] {
  if (!storage) return [];
  const next = readQueue(storage).map((item) => (
    item.uid === uid
      ? { ...item, attempts: item.attempts + 1, lastError: error }
      : item
  ));
  writeQueue(storage, next);
  return next;
}
