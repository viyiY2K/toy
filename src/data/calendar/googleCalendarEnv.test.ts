import { describe, expect, it } from 'vitest';
import { getGoogleCalendarClientId, isGoogleCalendarConfigured } from './googleCalendarEnv';

describe('google calendar env', () => {
  it('treats an empty client id as unconfigured', () => {
    expect(isGoogleCalendarConfigured({ VITE_GOOGLE_CALENDAR_CLIENT_ID: '' })).toBe(false);
    expect(getGoogleCalendarClientId({ VITE_GOOGLE_CALENDAR_CLIENT_ID: 'abc.apps.googleusercontent.com' }))
      .toBe('abc.apps.googleusercontent.com');
  });
});
