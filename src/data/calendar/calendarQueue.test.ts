import { describe, expect, it } from 'vitest';
import {
  enqueueCalendarDrafts,
  peekCalendarQueue,
  recordCalendarQueueError,
  removeCalendarQueueItems,
} from './calendarQueue';
import type { CalendarEventDraft } from './mapSessionToCalendarEvents';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

function draft(uid: string): CalendarEventDraft {
  return {
    uid,
    sessionId: 'session-1',
    taskId: 'task-1',
    title: '写周报',
    description: '实际投入 25 分钟',
    start: '2026-05-24T10:00:00+08:00',
    end: '2026-05-24T10:25:00+08:00',
    timeZone: 'Asia/Shanghai',
    discarded: false,
    actualDuration: 1500,
  };
}

describe('calendar queue', () => {
  it('enqueues by uid without duplicating the same focus slice', () => {
    const storage = memoryStorage();
    enqueueCalendarDrafts([draft('a')], '2026-05-24T10:25:00+08:00', storage);
    enqueueCalendarDrafts([draft('a'), draft('b')], '2026-05-24T10:26:00+08:00', storage);
    expect(peekCalendarQueue(storage).map((item) => item.uid)).toEqual(['a', 'b']);
  });

  it('records a failure and removes a successful uid', () => {
    const storage = memoryStorage();
    enqueueCalendarDrafts([draft('a'), draft('b')], '2026-05-24T10:25:00+08:00', storage);
    recordCalendarQueueError('a', 'network', storage);
    removeCalendarQueueItems(['b'], storage);
    const remaining = peekCalendarQueue(storage);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ uid: 'a', attempts: 1, lastError: 'network' });
  });
});
