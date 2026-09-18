import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR_PREFERENCES,
  getCalendarPreferences,
  updateCalendarPreferences,
} from './calendarPreferences';

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

describe('calendar preferences', () => {
  it('defaults to disconnected and not writing', () => {
    expect(getCalendarPreferences(memoryStorage())).toEqual(DEFAULT_CALENDAR_PREFERENCES);
  });

  it('merges a patch and keeps the dedicated calendar id after disconnect', () => {
    const storage = memoryStorage();
    const saved = updateCalendarPreferences(
      {
        connected: true,
        enabled: true,
        calendarId: 'calendar-focus',
        lastSuccessAt: '2026-05-24T10:25:00+08:00',
      },
      storage,
    );
    expect(saved).toMatchObject({
      connected: true,
      enabled: true,
      calendarId: 'calendar-focus',
    });
    expect(updateCalendarPreferences({ connected: false, enabled: false }, storage)).toMatchObject({
      connected: false,
      enabled: false,
      calendarId: 'calendar-focus',
    });
  });

  it('ignores a corrupted stored value', () => {
    const storage = memoryStorage({ 'pomodoro:googleCalendarPreferences': '{not json' });
    expect(getCalendarPreferences(storage).connected).toBe(false);
  });
});
