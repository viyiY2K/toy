import { describe, expect, it, vi } from 'vitest';
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
  it.each([401, 403, 429, 500])('does not recreate a stored calendar after HTTP %s', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, { error: { message: 'failed' } }));
    await expect(ensureFocusCalendar('token', 'calendar-focus', fetchImpl)).rejects.toThrow(String(status));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not create a calendar after the list request rejects authorization', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(401, { error: { message: 'Invalid Credentials' } }));
    await expect(ensureFocusCalendar('token', null, fetchImpl)).rejects.toThrow('401');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('still creates a calendar when the app-created scope cannot list calendars', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(403, { error: { message: 'Request had insufficient authentication scopes.' } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'new-cal' }));
    await expect(ensureFocusCalendar('token', null, fetchImpl)).resolves.toBe('new-cal');
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('POST');
  });

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
  it('recovers an accepted insert after its response is lost instead of inserting twice', async () => {
    const events: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (!init?.method) return jsonResponse(200, { items: events });
      if (init.method === 'POST') {
        events.push({ ...JSON.parse(String(init.body)), id: 'accepted-event' });
        throw new Error('response lost');
      }
      expect(init.method).toBe('PUT');
      expect(String(input)).toContain('/events/accepted-event?');
      return jsonResponse(200, { id: 'accepted-event' });
    });
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, { fetchImpl })).rejects.toThrow('response lost');
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, { fetchImpl })).resolves.toBe('accepted-event');
    expect(events).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('matches both identifiers across pages, ignoring other tasks, sessions and cancelled events', async () => {
    const event = (id: string, sessionId: string, taskId: string, status = 'confirmed') => ({
      id, status, extendedProperties: { private: { sessionId, taskId } },
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'PUT') {
        expect(url.pathname).toContain('/events/matched');
        return jsonResponse(200, { id: 'matched' });
      }
      expect(init?.method).toBeUndefined();
      expect(url.searchParams.getAll('privateExtendedProperty')).toEqual(['sessionId=s1']);
      if (!url.searchParams.has('pageToken')) return jsonResponse(200, {
        items: [event('other-task', 's1', 't2'), event('other-session', 's2', 't1'), event('deleted', 's1', 't1', 'cancelled')],
        nextPageToken: 'next/page',
      });
      expect(url.searchParams.get('pageToken')).toBe('next/page');
      return jsonResponse(200, { items: [event('matched', 's1', 't1')] });
    });
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, { fetchImpl })).resolves.toBe('matched');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 429, 500])('does not insert when duplicate lookup fails with HTTP %s', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, { error: { message: 'failed' } }));
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, { fetchImpl })).rejects.toThrow(String(status));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('searches again when the remembered event no longer exists', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'replacement' }));
    await expect(upsertCalendarEvent('token', 'calendar-focus', draft, {
      knownGoogleEventId: 'gone', fetchImpl,
    })).resolves.toBe('replacement');
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['PUT', 'GET', 'POST']);
  });

  it('lets Google assign event ids and updates with the remembered id', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/events?') && !init?.method) return jsonResponse(200, { items: [] });
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
