/**
 * 把已结束的专注投影成日历日程草稿。
 *
 * 不是数据真值：不写 Session / Task / Event，也不把 Google 日程编号回写进实体。
 * 时长用 actualDuration（或合并分段的 actualDuration），开始时刻用动手时刻，
 * 结束时刻 = 开始 + 实际秒数。
 */

import type { Session } from '../schema';

export const CALENDAR_EVENT_UID_HOST = 'toy.viyi.cc';

export interface CalendarEventDraft {
  uid: string;
  /** Google Calendar event.id：仅允许 0-9 / a-v，同一 session+task 稳定，不同 session 不重复。 */
  eventId: string;
  sessionId: string;
  taskId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  discarded: boolean;
  actualDuration: number;
}

export interface CalendarEventTitleLookup {
  readonly [taskId: string]: string | undefined;
}

function offsetMinutesFromIso(iso: string): number {
  if (iso.endsWith('Z')) return 0;
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function formatIsoWithOffset(epochMs: number, offsetMinutes: number): string {
  const localMs = epochMs + offsetMinutes * 60_000;
  const date = new Date(localMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function addSecondsToIso(iso: string, seconds: number): string {
  const startMs = Date.parse(iso);
  if (!Number.isFinite(startMs)) throw new Error(`无效时间: ${iso}`);
  return formatIsoWithOffset(startMs + seconds * 1000, offsetMinutesFromIso(iso));
}

export function calendarEventUid(sessionId: string, taskId: string): string {
  return `focus-${sessionId}-${taskId}@${CALENDAR_EVENT_UID_HOST}`;
}

/** Google 事件 id 只允许 base32hex（0-9、a-v）。UUID 去掉连字符后天然合法。 */
export function googleCalendarEventId(sessionId: string, taskId: string): string {
  const compact = `${sessionId}${taskId}`.toLowerCase().replace(/[^0-9a-v]/g, '');
  if (compact.length >= 5) return compact.slice(0, 1024);
  const fallback = calendarEventUid(sessionId, taskId)
    .toLowerCase()
    .replace(/[^0-9a-v]/g, '');
  return (fallback + '0'.repeat(5)).slice(0, 1024);
}

export function formatInvestedDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  if (rest === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${rest} 秒`;
}

function descriptionFor(actualDuration: number, discarded: boolean): string {
  const invested = `实际投入 ${formatInvestedDuration(actualDuration)}`;
  return discarded ? `作废\n${invested}` : invested;
}

function draftFromSlice(
  session: Session,
  taskId: string,
  startedAt: string,
  actualDuration: number,
  titles: CalendarEventTitleLookup,
): CalendarEventDraft {
  const discarded = session.status === 'discarded';
  return {
    uid: calendarEventUid(session.id, taskId),
    eventId: googleCalendarEventId(session.id, taskId),
    sessionId: session.id,
    taskId,
    title: titles[taskId]?.trim() || '未命名任务',
    description: descriptionFor(actualDuration, discarded),
    start: startedAt,
    end: addSecondsToIso(startedAt, actualDuration),
    timeZone: session.timezone,
    discarded,
    actualDuration,
  };
}

function isFocusSession(session: Session): boolean {
  return session.type === 'focus' || session.type === 'extraFocus';
}

/**
 * 一次已结束的专注 → 0..n 条任务日程。
 * 休息、进行中、投入为 0、无法按任务归因的历史合并记录，都返回空数组。
 */
export function mapSessionToCalendarEvents(
  session: Session,
  titles: CalendarEventTitleLookup = {},
): CalendarEventDraft[] {
  if (session.deletedAt != null) return [];
  if (!isFocusSession(session)) return [];
  if (session.status !== 'completed' && session.status !== 'discarded') return [];
  if (session.actualDuration == null || session.actualDuration <= 0) return [];

  if (session.taskSegments.length > 0) {
    return session.taskSegments
      .filter((segment) => segment.actualDuration > 0)
      .map((segment) => draftFromSlice(
        session,
        segment.taskId,
        segment.startedAt,
        segment.actualDuration,
        titles,
      ));
  }

  if (session.taskIds.length !== 1) return [];
  const taskId = session.taskIds[0];
  if (taskId === undefined) return [];
  return [draftFromSlice(session, taskId, session.startedAt, session.actualDuration, titles)];
}
