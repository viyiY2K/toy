import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real API, storage, queue and runtime together; only Google and
// command-result projection are simulated. No real account or session is used.
vi.mock('../data/index', async () => ({
  ...await import('../data/calendar/calendarPreferences'),
  ...await import('../data/calendar/calendarAccessToken'),
  ...await import('../data/calendar/calendarQueue'),
  ...await import('../data/calendar/calendarEventIndex'),
  ...await import('../data/calendar/googleCalendarApi'),
  getGoogleCalendarClientId: () => 'test-client',
  isGoogleCalendarConfigured: () => true,
  calendarDraftsFromCommandResult: async (drafts) => drafts,
}));

let api;
let runtime;
let fetchMock;
let requestToken;
let events;
let mode;
let stopRetry;

function draft(n) {
  return {
    uid: `focus-session${n}-task1`, eventId: `unused${n}`, sessionId: `session${n}`,
    taskId: 'task1', title: '测试任务', description: '实际投入 25 分钟',
    start: '2026-09-19T10:00:00+08:00', end: '2026-09-19T10:25:00+08:00',
    timeZone: 'Asia/Shanghai', discarded: false, actualDuration: 1500,
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status });
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  vi.resetModules();
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  });
  requestToken = vi.fn();
  vi.stubGlobal('window', {
    setInterval, clearInterval,
    google: { accounts: { oauth2: { initTokenClient: (options) => ({
      requestAccessToken: () => {
        requestToken();
        options.callback({ access_token: 'renewed', expires_in: 3600 });
      },
    }) } } },
  });
  events = [];
  mode = 'ok';
  stopRetry = null;
  api = await import('../data/index');
  runtime = await import('./googleCalendarRuntime');
  api.updateCalendarPreferences({ connected: true, enabled: true, calendarId: 'focus-calendar' });
  api.saveCalendarAccessToken('test-token', Date.now() + 3600000);
  fetchMock = vi.fn(async (input, init) => {
    // Bound a regression of the old infinite microtask loop so it fails rather
    // than hanging the test runner.
    if (fetchMock.mock.calls.length > 12) {
      api.updateCalendarPreferences({ enabled: false });
      throw new Error('unbounded retry');
    }
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(init.body) : null;
    if (url.pathname.endsWith('/calendars/focus-calendar')) {
      if (mode === 'calendar401') return json(401, { error: { message: 'Invalid Credentials' } });
      if (mode === 'calendar503') return json(503, { error: { message: 'Unavailable' } });
      return json(200, { id: 'focus-calendar' });
    }
    if (mode === 'event401') return json(401, { error: { message: 'Invalid Credentials' } });
    if (mode === 'offline') throw new Error('offline');
    if (url.pathname.endsWith('/events') && !init?.method) {
      const sessionId = url.searchParams.get('privateExtendedProperty').slice('sessionId='.length);
      return json(200, { items: events.filter((event) => event.extendedProperties.private.sessionId === sessionId) });
    }
    if (init?.method === 'POST' && url.pathname.endsWith('/events')) {
      expect(body.id).toBeUndefined();
      expect(body.iCalUID).toBeUndefined();
      const event = { ...body, id: `event-${events.length + 1}` };
      events.push(event);
      if (mode === 'lostResponse') {
        mode = 'ok';
        throw new Error('response lost after insert');
      }
      return json(200, event);
    }
    if (init?.method === 'PUT') {
      const event = events.find((item) => url.pathname.endsWith(`/events/${item.id}`));
      expect(event).toBeDefined();
      Object.assign(event, body);
      return json(200, event);
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  stopRetry?.();
  await settle();
  vi.unstubAllGlobals();
});

describe('Google calendar recovery', () => {
  it('writes three successive sessions of the same task without prompting', async () => {
    for (let n = 1; n <= 3; n += 1) await runtime.syncFocusSessionsToGoogleCalendar([draft(n)]);
    expect(events).toHaveLength(3);
    expect(api.peekCalendarQueue()).toHaveLength(0);
    expect(requestToken).not.toHaveBeenCalled();
  });

  it.each(['calendar401', 'event401'])('stops after %s and manual retry renews and flushes', async (failure) => {
    mode = failure;
    await runtime.syncFocusSessionsToGoogleCalendar([draft(1)]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(failure === 'calendar401' ? 1 : 2);
    expect(api.getCalendarAccessToken()).toBeNull();
    expect(api.peekCalendarQueue()).toHaveLength(1);
    expect(api.getCalendarPreferences().lastError).toContain('授权已过期');
    expect(requestToken).not.toHaveBeenCalled();
    mode = 'ok';
    await runtime.retryGoogleCalendarWrites();
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(api.peekCalendarQueue()).toHaveLength(0);
    expect(api.getCalendarPreferences().lastError).toBeNull();
  });

  it('does not spin on calendar service failure and the next scheduled retry succeeds', async () => {
    mode = 'calendar503';
    await runtime.syncFocusSessionsToGoogleCalendar([draft(1)]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.peekCalendarQueue()).toHaveLength(1);
    expect(api.getCalendarAccessToken()).not.toBeNull();
    let tick;
    window.setInterval = (callback) => { tick = callback; return 1; };
    window.clearInterval = () => {};
    stopRetry = runtime.startGoogleCalendarRetryLoop();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(0);
    mode = 'ok';
    tick();
    await settle();
    expect(events).toHaveLength(1);
    expect(api.peekCalendarQueue()).toHaveLength(0);
    expect(requestToken).not.toHaveBeenCalled();
  });

  it('queues an expired token without prompting and renews only on manual retry', async () => {
    api.saveCalendarAccessToken('expired', Date.now() - 1);
    await runtime.syncFocusSessionsToGoogleCalendar([draft(1)]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestToken).not.toHaveBeenCalled();
    expect(api.peekCalendarQueue()).toHaveLength(1);
    await runtime.retryGoogleCalendarWrites();
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it.each(['offline', 'lostResponse'])('recovers %s with exactly one final event', async (failure) => {
    mode = failure;
    await runtime.syncFocusSessionsToGoogleCalendar([draft(1)]);
    expect(api.peekCalendarQueue()).toHaveLength(1);
    mode = 'ok';
    if (failure === 'lostResponse') {
      // Simulate a reload before retry: the queue survives but no Google id
      // was saved for the accepted write.
      vi.resetModules();
      runtime = await import('./googleCalendarRuntime');
    }
    await runtime.retryGoogleCalendarWrites();
    expect(events).toHaveLength(1);
    expect(api.peekCalendarQueue()).toHaveLength(0);
    expect(api.getGoogleEventIdForUid(draft(1).uid)).toBe('event-1');
  });
});
