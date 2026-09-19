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
  return `Google 日历 ${response.status}：${response.statusText || '请求失败'}`;
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
    const detail = await readGoogleError(response);
    return {
      ok: false,
      status: response.status,
      message: detail.startsWith('Google 日历 ') ? detail : `Google 日历 ${response.status}：${detail}`,
    };
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

function eventBody(draft: CalendarEventDraft) {
  return {
    summary: draft.title,
    description: draft.description,
    start: { dateTime: draft.start, timeZone: draft.timeZone },
    end: { dateTime: draft.end, timeZone: draft.timeZone },
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
    if (!existing.ok && existing.status !== 404) throw new Error(existing.message);
    if (existing.ok) throw new Error('Google 没有返回日历编号');
  }

  const list = await googleJson<CalendarListResponse>(
    fetchImpl,
    accessToken,
    '/users/me/calendarList',
  );
  if (list.ok) {
    const found = (list.body.items ?? []).find((item) => item.summary === GOOGLE_FOCUS_CALENDAR_SUMMARY);
    if (typeof found?.id === 'string') return found.id;
  } else if (list.status !== 403 || !/insufficient.*(?:scope|permission)/i.test(list.message)) {
    throw new Error(list.message);
  }
  // calendar.app.created 不包含 calendarList.list 权限；仅此权限不足可回退到创建。

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

interface EventResource {
  id?: string;
  status?: string;
  extendedProperties?: { private?: { sessionId?: string; taskId?: string } };
}

async function findCalendarEvent(
  fetchImpl: FetchLike,
  accessToken: string,
  calendarId: string,
  draft: CalendarEventDraft,
): Promise<string | null> {
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      privateExtendedProperty: `sessionId=${draft.sessionId}`,
      showDeleted: 'false',
    });
    if (pageToken) query.set('pageToken', pageToken);
    const result = await googleJson<{ items?: EventResource[]; nextPageToken?: string }>(
      fetchImpl, accessToken, `/calendars/${calendarId}/events?${query}`,
    );
    // 查询失败不等于不存在；保留队列，避免在结果未知时盲目新增。
    if (!result.ok) throw new Error(result.message);
    const found = (result.body.items ?? []).find((event) => (
      typeof event.id === 'string'
      && event.status !== 'cancelled'
      && event.extendedProperties?.private?.sessionId === draft.sessionId
      && event.extendedProperties.private.taskId === draft.taskId
    ));
    if (found?.id) return found.id;
    pageToken = result.body.nextPageToken;
  } while (pageToken);
  return null;
}

export async function upsertCalendarEvent(
  accessToken: string,
  calendarId: string,
  draft: CalendarEventDraft,
  options: { knownGoogleEventId?: string | null; fetchImpl?: FetchLike } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const knownGoogleEventId = options.knownGoogleEventId ?? null;
  const encodedCalendarId = encodeURIComponent(calendarId);
  const body = JSON.stringify(eventBody(draft));

  async function updateEvent(eventId: string): Promise<string | null> {
    const updated = await googleJson<{ id?: string }>(
      fetchImpl,
      accessToken,
      `/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      { method: 'PUT', body },
    );
    if (updated.ok) return updated.body.id ?? eventId;
    if (updated.status !== 404) throw new Error(updated.message);
    return null;
  }

  if (knownGoogleEventId) {
    const updatedId = await updateEvent(knownGoogleEventId);
    if (updatedId) return updatedId;
  }

  // POST 已成功但响应丢失时，本机尚未记住 Google id。用原有事实标识找回日程。
  const recoveredId = await findCalendarEvent(fetchImpl, accessToken, encodedCalendarId, draft);
  if (recoveredId) {
    const updatedId = await updateEvent(recoveredId);
    if (updatedId) return updatedId;
  }

  const inserted = await googleJson<{ id?: string }>(
    fetchImpl,
    accessToken,
    `/calendars/${encodedCalendarId}/events?sendUpdates=none`,
    { method: 'POST', body },
  );
  if (!inserted.ok || typeof inserted.body.id !== 'string') {
    throw new Error(inserted.ok ? 'Google 没有返回日程编号' : inserted.message);
  }
  return inserted.body.id;
}
