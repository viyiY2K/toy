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
  it('inserts a new event and updates on iCalUID conflict', async () => {
    let inserted = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/events?sendUpdates=none') && init?.method === 'POST') {
        inserted += 1;
        if (inserted === 1) return jsonResponse(200, { id: 'evt-1' });
        return jsonResponse(409, { error: { message: 'The requested identifier already exists.' } });
      }
      if (url.includes('iCalUID=')) return jsonResponse(200, { items: [{ id: 'evt-1' }] });
      if (url.includes('/events/evt-1') && init?.method === 'PUT') return jsonResponse(200, { id: 'evt-1' });
      throw new Error(`unexpected ${url}`);
    };
    await upsertCalendarEvent('token', 'calendar-focus', draft, fetchImpl);
    await upsertCalendarEvent('token', 'calendar-focus', draft, fetchImpl);
  });
});
