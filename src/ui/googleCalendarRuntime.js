import {
  calendarDraftsFromCommandResult,
  clearCalendarAccessToken,
  enqueueCalendarDrafts,
  ensureFocusCalendar,
  getCalendarAccessToken,
  getCalendarPreferences,
  getGoogleCalendarClientId,
  GOOGLE_CALENDAR_SCOPE,
  isGoogleCalendarConfigured,
  peekCalendarQueue,
  recordCalendarQueueError,
  removeCalendarQueueItems,
  saveCalendarAccessToken,
  updateCalendarPreferences,
  upsertCalendarEvent,
} from '../data/index';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

const listeners = new Set();
let gisPromise = null;
let accessToken = null;
let tokenExpiresAt = 0;
let flushPromise = null;
let retryIntervalId = null;

function clockIso() {
  return new Date().toISOString();
}

function notifyGoogleCalendarRuntime() {
  const prefs = getCalendarPreferences();
  for (const listener of listeners) listener(prefs);
}

export function subscribeGoogleCalendarRuntime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function rememberToken(token, expiresAt) {
  accessToken = token;
  tokenExpiresAt = expiresAt;
  saveCalendarAccessToken(token, expiresAt);
}

function restoreToken() {
  const stored = getCalendarAccessToken();
  if (!stored) return false;
  accessToken = stored.accessToken;
  tokenExpiresAt = stored.expiresAt;
  return true;
}

function tokenValid() {
  if (typeof accessToken === 'string' && accessToken.length > 0 && Date.now() < tokenExpiresAt) {
    return true;
  }
  return restoreToken();
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('无法加载 Google 登录')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisPromise = null;
      reject(new Error('无法加载 Google 登录'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

function requestAccessToken({ interactive }) {
  const clientId = getGoogleCalendarClientId();
  if (!clientId) throw new Error('还没有配置 Google 日历网页客户端');
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        const expiresIn = Number(response.expires_in ?? 3600);
        rememberToken(
          response.access_token,
          Date.now() + Math.max(30, expiresIn - 60) * 1000,
        );
        resolve(accessToken);
      },
      error_callback: (error) => {
        reject(new Error(error?.message || 'Google 授权已取消'));
      },
    });
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function getAccessToken({ interactive = false } = {}) {
  if (tokenValid()) return accessToken;
  await loadGis();
  return requestAccessToken({ interactive });
}

function rememberError(message) {
  updateCalendarPreferences({ lastError: message });
  notifyGoogleCalendarRuntime();
}

async function flushCalendarQueue() {
  const prefs = getCalendarPreferences();
  if (!prefs.connected || !prefs.enabled) return;
  const queued = peekCalendarQueue();
  if (queued.length === 0) return;

  const token = await getAccessToken({ interactive: false });
  const calendarId = await ensureFocusCalendar(token, prefs.calendarId);
  if (calendarId !== prefs.calendarId) {
    updateCalendarPreferences({ calendarId });
  }

  const succeeded = [];
  let lastError = null;
  for (const item of queued) {
    try {
      await upsertCalendarEvent(token, calendarId, item.draft);
      succeeded.push(item.uid);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      lastError = message;
      recordCalendarQueueError(item.uid, message);
    }
  }
  if (succeeded.length > 0) removeCalendarQueueItems(succeeded);
  updateCalendarPreferences({
    lastSuccessAt: succeeded.length > 0 ? clockIso() : prefs.lastSuccessAt,
    lastError,
  });
  notifyGoogleCalendarRuntime();
}

function enqueueFlush() {
  if (flushPromise) return flushPromise;
  flushPromise = flushCalendarQueue()
    .catch((cause) => {
      rememberError(cause instanceof Error ? cause.message : String(cause));
    })
    .finally(() => {
      flushPromise = null;
    });
  return flushPromise;
}

export async function connectGoogleCalendar() {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('还没有配置 Google 日历网页客户端');
  }
  const token = await getAccessToken({ interactive: true });
  const calendarId = await ensureFocusCalendar(token, getCalendarPreferences().calendarId);
  updateCalendarPreferences({
    connected: true,
    enabled: true,
    calendarId,
    lastError: null,
  });
  notifyGoogleCalendarRuntime();
  await enqueueFlush();
}

export async function disconnectGoogleCalendar() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  clearCalendarAccessToken();
  updateCalendarPreferences({
    connected: false,
    enabled: false,
    lastError: null,
  });
  notifyGoogleCalendarRuntime();
}

export function setGoogleCalendarWriteEnabled(enabled) {
  const prefs = getCalendarPreferences();
  updateCalendarPreferences({
    enabled,
    lastError: enabled ? null : prefs.lastError,
  });
  notifyGoogleCalendarRuntime();
  if (enabled) enqueueFlush();
}

export async function syncFocusSessionsToGoogleCalendar(result) {
  try {
    if (!isGoogleCalendarConfigured()) return;
    const prefs = getCalendarPreferences();
    if (!prefs.connected || !prefs.enabled) return;
    const drafts = await calendarDraftsFromCommandResult(result);
    if (drafts.length === 0) return;
    enqueueCalendarDrafts(drafts, clockIso());
    notifyGoogleCalendarRuntime();
    await enqueueFlush();
  } catch (cause) {
    rememberError(cause instanceof Error ? cause.message : String(cause));
  }
}

export async function retryGoogleCalendarWrites() {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('还没有配置 Google 日历网页客户端');
  }
  const prefs = getCalendarPreferences();
  if (!prefs.connected) throw new Error('还没连接 Google 日历');
  await getAccessToken({ interactive: true });
  await enqueueFlush();
  const leftover = peekCalendarQueue().length;
  const error = getCalendarPreferences().lastError;
  if (error) throw new Error(error);
  if (leftover > 0) throw new Error(`还有 ${leftover} 条没写出`);
}

export function startGoogleCalendarRetryLoop() {
  if (retryIntervalId !== null) {
    window.clearInterval(retryIntervalId);
    retryIntervalId = null;
  }
  enqueueFlush();
  retryIntervalId = window.setInterval(() => {
    if (!getCalendarPreferences().connected || peekCalendarQueue().length === 0) return;
    enqueueFlush();
  }, RETRY_INTERVAL_MS);
  return () => {
    window.clearInterval(retryIntervalId);
    retryIntervalId = null;
  };
}
