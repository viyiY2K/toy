import { describe, expect, it } from 'vitest';
import { getGoogleEventIdForUid, rememberGoogleEventId } from './calendarEventIndex';

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

describe('calendar event index', () => {
  it('remembers the Google event id for a local uid', () => {
    const storage = memoryStorage();
    expect(getGoogleEventIdForUid('focus-s1-t1@toy.viyi.cc', storage)).toBeNull();
    rememberGoogleEventId('focus-s1-t1@toy.viyi.cc', 'abc123', storage);
    expect(getGoogleEventIdForUid('focus-s1-t1@toy.viyi.cc', storage)).toBe('abc123');
  });
});
