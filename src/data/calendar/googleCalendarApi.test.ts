import { describe, expect, it } from 'vitest';
import { ensureFocusCalendar, upsertCalendarEvent } from './googleCalendarApi';
import type { CalendarEventDraft } from './mapSessionToCalendarEvents';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const draft: CalendarEventDraft = {
  uid: 'focus-s1-t1@toy.viyi.cc',
  eventId: 's1t1aaaa',
  sessionId: 's1',
  taskId: 't1',
  title: '写周报',
  description: '实际投入 25 分钟',
  start: '2026-05-24T10:00:00+08:00',
  end: '2026-05-24T10:25:00+08:00',
  timeZone: 'Asia/Shanghai',
  discarded: false,
  actualDuration: 1500,
};

describe('ensureFocusCalendar', () => {
  it('reuses the stored calendar when it still exists', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toContain('/calendars/calendar-focus');
      return jsonResponse(200, { id: 'calendar-focus', summary: '番茄专注' });
    };
    await expect(ensureFocusCalendar('token', 'calendar-focus', fetchImpl)).resolves.toBe('calendar-focus');
  });

  it('creates 番茄专注 when no stored calendar remains', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/users/me/calendarList')) return jsonResponse(200, { items: [] });
      if (url.endsWith('/calendars') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ summary: '番茄专注' });
        return jsonResponse(200, { id: 'new-cal' });
      }
      throw new Error(`unexpected ${url}`);
    };
    await expect(ensureFocusCalendar('token', null, fetchImpl)).resolves.toBe('new-cal');
  });
});

describe('upsertCalendarEvent', () => {
  it('lets Google assign event ids and updates with the remembered id', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/events?sendUpdates=none') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body));
        expect(payload.id).toBeUndefined();
        expect(payload.iCalUID).toBeUndefined();
        return jsonResponse(200, { id: 'google-evt-1' });
      }
      if (url.includes('/events/google-evt-1') && init?.method === 'PUT') {
        const payload = JSON.parse(String(init.body));
        expect(payload.id).toBeUndefined();
        return jsonResponse(200, { id: 'google-evt-1' });
      }
      throw new Error(`unexpected ${url}`);
    };
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, { fetchImpl }))
      .resolves.toBe('google-evt-1');
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, {
      knownGoogleEventId: 'google-evt-1',
      fetchImpl,
    })).resolves.toBe('google-evt-1');
  });
});
