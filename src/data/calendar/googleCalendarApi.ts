import type { CalendarEventDraft } from './mapSessionToCalendarEvents';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const GOOGLE_FOCUS_CALENDAR_SUMMARY = '番茄专注';
export const GOOGLE_CALENDAR_API_ROOT = 'https://www.googleapis.com/calendar/v3';

type FetchLike = typeof fetch;

function headers(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function readGoogleError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const error = (body as { error?: { message?: unknown } }).error;
      if (typeof error?.message === 'string' && error.message.length > 0) return error.message;
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Google 日历请求失败（${response.status}）`;
}

async function googleJson<T>(
  fetchImpl: FetchLike,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; status: number; body: T } | { ok: false; status: number; message: string }> {
  const response = await fetchImpl(`${GOOGLE_CALENDAR_API_ROOT}${path}`, {
    ...init,
    headers: {
      ...headers(accessToken),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    return { ok: false, status: response.status, message: await readGoogleError(response) };
  }
  if (response.status === 204) return { ok: true, status: 204, body: undefined as T };
  return { ok: true, status: response.status, body: await response.json() as T };
}

interface CalendarResource {
  id?: string;
  summary?: string;
}

interface CalendarListResponse {
  items?: CalendarResource[];
}

interface EventListResponse {
  items?: Array<{ id?: string }>;
}

function eventBody(draft: CalendarEventDraft) {
  return {
    summary: draft.title,
    description: draft.description,
    start: { dateTime: draft.start, timeZone: draft.timeZone },
    end: { dateTime: draft.end, timeZone: draft.timeZone },
    iCalUID: draft.uid,
    extendedProperties: {
      private: {
        sessionId: draft.sessionId,
        taskId: draft.taskId,
      },
    },
  };
}

export async function ensureFocusCalendar(
  accessToken: string,
  existingId: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  if (existingId) {
    const existing = await googleJson<CalendarResource>(
      fetchImpl,
      accessToken,
      `/calendars/${encodeURIComponent(existingId)}`,
    );
    if (existing.ok && typeof existing.body.id === 'string') return existing.body.id;
  }

  const list = await googleJson<CalendarListResponse>(
    fetchImpl,
    accessToken,
    '/users/me/calendarList',
  );
  if (list.ok) {
    const found = (list.body.items ?? []).find((item) => item.summary === GOOGLE_FOCUS_CALENDAR_SUMMARY);
    if (typeof found?.id === 'string') return found.id;
  }

  const created = await googleJson<CalendarResource>(
    fetchImpl,
    accessToken,
    '/calendars',
    { method: 'POST', body: JSON.stringify({ summary: GOOGLE_FOCUS_CALENDAR_SUMMARY }) },
  );
  if (!created.ok || typeof created.body.id !== 'string') {
    throw new Error(created.ok ? 'Google 没有返回新日历编号' : created.message);
  }
  return created.body.id;
}

export async function upsertCalendarEvent(
  accessToken: string,
  calendarId: string,
  draft: CalendarEventDraft,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const encodedCalendarId = encodeURIComponent(calendarId);
  const inserted = await googleJson<unknown>(
    fetchImpl,
    accessToken,
    `/calendars/${encodedCalendarId}/events?sendUpdates=none`,
    { method: 'POST', body: JSON.stringify(eventBody(draft)) },
  );
  if (inserted.ok) return;
  if (inserted.status !== 409) throw new Error(inserted.message);

  const listed = await googleJson<EventListResponse>(
    fetchImpl,
    accessToken,
    `/calendars/${encodedCalendarId}/events?iCalUID=${encodeURIComponent(draft.uid)}`,
  );
  const eventId = listed.ok ? listed.body.items?.[0]?.id : undefined;
  if (!listed.ok || typeof eventId !== 'string') {
    throw new Error(listed.ok ? '找不到已存在的日历日程' : listed.message);
  }
  const updated = await googleJson<unknown>(
    fetchImpl,
    accessToken,
    `/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'PUT', body: JSON.stringify(eventBody(draft)) },
  );
  if (!updated.ok) throw new Error(updated.message);
}
