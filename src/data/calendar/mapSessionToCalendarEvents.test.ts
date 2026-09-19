import { describe, expect, it } from 'vitest';
import { makeSession, type MakeSessionInput } from '../schema';
import {
  addSecondsToIso,
  calendarEventUid,
  formatInvestedDuration,
  googleCalendarEventId,
  mapSessionToCalendarEvents,
} from './mapSessionToCalendarEvents';

const NOW = '2026-05-24T10:25:00+08:00';
const STARTED = '2026-05-24T10:00:00+08:00';
const TZ = 'Asia/Shanghai';
const TASK_A = '0197aaaaaaaaaaaaaaaaaaaaaaaaa1';
const TASK_B = '0197aaaaaaaaaaaaaaaaaaaaaaaaa2';
const TASK_C = '0197aaaaaaaaaaaaaaaaaaaaaaaaa3';

function focusSession(overrides: Partial<MakeSessionInput> = {}) {
  return makeSession({
    now: NOW,
    startedAt: STARTED,
    timezone: TZ,
    type: 'focus',
    status: 'completed',
    taskIds: [TASK_A],
    endedAt: NOW,
    plannedDuration: 1500,
    actualDuration: 1500,
    pomodoroIndex: 1,
    ...overrides,
  });
}

describe('addSecondsToIso', () => {
  it('keeps the original UTC offset when adding actual duration', () => {
    expect(addSecondsToIso(STARTED, 480)).toBe('2026-05-24T10:08:00+08:00');
    expect(addSecondsToIso(STARTED, 1500)).toBe('2026-05-24T10:25:00+08:00');
  });
});

describe('formatInvestedDuration', () => {
  it('uses minutes when the duration is exact, otherwise keeps leftover seconds', () => {
    expect(formatInvestedDuration(8)).toBe('8 秒');
    expect(formatInvestedDuration(480)).toBe('8 分钟');
    expect(formatInvestedDuration(492)).toBe('8 分 12 秒');
  });
});

describe('mapSessionToCalendarEvents', () => {
  it('maps a completed independent focus onto one event using actualDuration', () => {
    const session = focusSession({
      id: 'session-independent',
      endedAt: '2026-05-24T10:25:02+08:00',
      actualDuration: 1500,
    });
    expect(mapSessionToCalendarEvents(session, { [TASK_A]: '写周报' })).toEqual([
      {
        uid: calendarEventUid('session-independent', TASK_A),
        eventId: googleCalendarEventId('session-independent', TASK_A),
        sessionId: 'session-independent',
        taskId: TASK_A,
        title: '写周报',
        description: '实际投入 25 分钟\n内部打扰 0 次\n外部打扰 0 次',
        start: STARTED,
        end: '2026-05-24T10:25:00+08:00',
        timeZone: TZ,
        discarded: false,
        actualDuration: 1500,
      },
    ]);
  });

  it('maps a discarded independent focus and marks the description', () => {
    const session = focusSession({
      id: 'session-discarded',
      status: 'discarded',
      actualDuration: 480,
    });
    const [event] = mapSessionToCalendarEvents(session, { [TASK_A]: '写周报' });
    expect(event).toMatchObject({
      title: '写周报',
      description: '作废\n实际投入 8 分钟\n内部打扰 0 次\n外部打扰 0 次',
      start: STARTED,
      end: '2026-05-24T10:08:00+08:00',
      discarded: true,
      actualDuration: 480,
    });
  });

  it('writes one event per merge member with actual time, skipping zero-duration members', () => {
    const session = focusSession({
      id: 'session-merge',
      taskIds: [TASK_A, TASK_B, TASK_C],
      mergeGroupId: 'merge-1',
      actualDuration: 1500,
      taskSegments: [
        {
          taskId: TASK_A,
          startedAt: STARTED,
          endedAt: '2026-05-24T10:08:00+08:00',
          actualDuration: 480,
        },
        {
          taskId: TASK_B,
          startedAt: '2026-05-24T10:08:00+08:00',
          endedAt: NOW,
          actualDuration: 1020,
        },
        {
          taskId: TASK_C,
          startedAt: NOW,
          endedAt: NOW,
          actualDuration: 0,
        },
      ],
    });
    const events = mapSessionToCalendarEvents(session, {
      [TASK_A]: '回邮件',
      [TASK_B]: '报销',
      [TASK_C]: '还没轮到',
    });
    expect(events.map((event) => [event.title, event.start, event.end, event.actualDuration])).toEqual([
      ['回邮件', STARTED, '2026-05-24T10:08:00+08:00', 480],
      ['报销', '2026-05-24T10:08:00+08:00', '2026-05-24T10:25:00+08:00', 1020],
    ]);
    expect(events.some((event) => event.taskId === TASK_C)).toBe(false);
    expect(events.some((event) => event.title.includes('合并'))).toBe(false);
  });

  it('gives the same task a different calendar event id in a later session', () => {
    const first = googleCalendarEventId('0197bbbbbbbbbbbbbbbbbbbbbbbbb1', TASK_A);
    const second = googleCalendarEventId('0197bbbbbbbbbbbbbbbbbbbbbbbbb2', TASK_A);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-v]+$/);
    expect(second).toMatch(/^[0-9a-v]+$/);
  });

  it('maps extraFocus the same way as an independent task', () => {
    const session = focusSession({
      id: 'session-extra',
      type: 'extraFocus',
      plannedDuration: null,
      pomodoroIndex: null,
      originIntervalId: 'interval-1',
      actualDuration: 600,
    });
    const [event] = mapSessionToCalendarEvents(session, { [TASK_A]: '补一段' });
    expect(event).toMatchObject({
      title: '补一段',
      start: STARTED,
      end: '2026-05-24T10:10:00+08:00',
      actualDuration: 600,
      discarded: false,
    });
  });

  it('does not write breaks, active sessions, zero duration, or unattributable historical merges', () => {
    expect(mapSessionToCalendarEvents(makeSession({
      now: NOW,
      startedAt: STARTED,
      timezone: TZ,
      type: 'shortBreak',
      status: 'completed',
      endedAt: NOW,
      plannedDuration: 300,
      actualDuration: 300,
    }))).toEqual([]);
    expect(mapSessionToCalendarEvents(focusSession({
      status: 'active',
      endedAt: null,
      actualDuration: null,
    }))).toEqual([]);
    expect(mapSessionToCalendarEvents(focusSession({ actualDuration: 0 }))).toEqual([]);
    expect(mapSessionToCalendarEvents(focusSession({
      taskIds: [TASK_A, TASK_B],
      mergeGroupId: 'merge-old',
      taskSegments: [],
    }))).toEqual([]);
  });

  it('puts interrupt counts into the calendar description', () => {
    const session = focusSession({
      id: 'session-interrupts',
      status: 'discarded',
      actualDuration: 143,
    });
    const [event] = mapSessionToCalendarEvents(
      session,
      { [TASK_A]: '写周报' },
      { internal: 2, external: 1 },
    );
    expect(event?.description).toBe('作废\n实际投入 2 分 23 秒\n内部打扰 2 次\n外部打扰 1 次');
  });

  it('falls back to a placeholder title when the task is missing', () => {
    const [event] = mapSessionToCalendarEvents(focusSession({ id: 'session-missing-title' }));
    expect(event?.title).toBe('未命名任务');
  });
});
