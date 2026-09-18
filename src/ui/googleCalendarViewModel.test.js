import { describe, expect, it } from 'vitest';
import { formatGoogleCalendarStatus } from './googleCalendarViewModel';

const prefs = {
  connected: false,
  enabled: false,
  calendarId: null,
  lastSuccessAt: null,
  lastError: null,
};

describe('formatGoogleCalendarStatus', () => {
  it('explains the web client requirement when unconfigured', () => {
    expect(formatGoogleCalendarStatus(prefs, { configured: false })).toContain('Web application');
  });

  it('distinguishes connected, paused, and last write', () => {
    expect(formatGoogleCalendarStatus(prefs)).toBe('还没连接 Google 日历');
    expect(formatGoogleCalendarStatus({ ...prefs, connected: true, enabled: false })).toContain('已暂停');
    expect(formatGoogleCalendarStatus({
      ...prefs,
      connected: true,
      enabled: true,
      lastError: 'invalid_grant',
    })).toContain('invalid_grant');
  });
});
