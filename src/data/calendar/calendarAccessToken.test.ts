import { describe, expect, it } from 'vitest';
import {
  clearCalendarAccessToken,
  getCalendarAccessToken,
  saveCalendarAccessToken,
} from './calendarAccessToken';

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

describe('calendar access token', () => {
  it('round-trips a token that has not expired', () => {
    const storage = memoryStorage();
    saveCalendarAccessToken('ya29.token', 2_000, storage);
    expect(getCalendarAccessToken(1_000, storage)).toEqual({
      accessToken: 'ya29.token',
      expiresAt: 2_000,
    });
  });

  it('ignores an expired or cleared token', () => {
    const storage = memoryStorage();
    saveCalendarAccessToken('ya29.token', 500, storage);
    expect(getCalendarAccessToken(1_000, storage)).toBeNull();
    saveCalendarAccessToken('ya29.token', 2_000, storage);
    clearCalendarAccessToken(storage);
    expect(getCalendarAccessToken(1_000, storage)).toBeNull();
  });
});
