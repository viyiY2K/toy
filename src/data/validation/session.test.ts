import { describe, expect, it } from 'vitest';
import {
  makeDayPlan,
  makeSession,
  makeSettings,
  makeTask,
  makeUnresolvedInterval,
  type Session,
} from '../schema';
import type { ValidationContext } from './context';
import { EntityValidationError } from './primitives';
import { collectSessionValidationIssues, validateSession } from './session';

const NOW = '2026-06-05T14:00:00+08:00';
const ENDED = '2026-06-05T14:10:00+08:00';
const TZ = 'Asia/Shanghai';
const task = makeTask({ now: NOW, title: 'focus' });
const settings = makeSettings({ now: NOW });
const dayPlan = makeDayPlan({ now: NOW, timezone: TZ, appDayStartOffsetMinutes: 0 });
const interval = makeUnresolvedInterval({
  now: NOW,
  startedAt: NOW,
  endedAt: ENDED,
  timezone: TZ,
  source: 'appReopened',
});
const sourceFocus = makeSession({
  now: NOW,
  startedAt: NOW,
  timezone: TZ,
  type: 'focus',
  status: 'completed',
  taskId: task.id,
  endedAt: ENDED,
  plannedDuration: 1500,
  actualDuration: 600,
  pomodoroIndex: 1,
  dayPlanId: dayPlan.id,
});

function context(sessions: Session[] = []): ValidationContext {
  return {
    getSession: async (id) => sessions.find((session) => session.id === id),
    getTask: async (id) => (id === task.id ? task : undefined),
    getDayPlan: async (id) => (id === dayPlan.id ? dayPlan : undefined),
    getActiveDayPlanByAppDate: async (appDate) => (appDate === dayPlan.appDate ? dayPlan : undefined),
    getUnresolvedInterval: async (id) => (id === interval.id ? interval : undefined),
    getActiveSettings: async () => settings,
  };
}

function focus(overrides: Partial<Session> = {}): Session {
  return {
    ...makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'focus',
      taskId: task.id,
      plannedDuration: 1500,
      pomodoroIndex: 1,
      dayPlanId: dayPlan.id,
    }),
    ...overrides,
  };
}

async function expectCode(value: unknown, code: string, ctx = context()): Promise<void> {
  const issues = await collectSessionValidationIssues(value, ctx);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateSession (S6b, v4 §3.3)', () => {
  it('accepts all five Session types and does not compare actualDuration with timestamp delta', async () => {
    const values: Session[] = [
      focus(),
      focus({ status: 'completed', endedAt: ENDED, actualDuration: 17 }),
      {
        ...makeSession({
          now: NOW,
          startedAt: NOW,
          timezone: TZ,
          type: 'shortBreak',
          status: 'completed',
          endedAt: ENDED,
          plannedDuration: 300,
          actualDuration: 42,
          sourceFocusSessionId: sourceFocus.id,
          suggestedRest: 'short_scalp_massage',
          actualRest: 'short_scalp_massage',
          dayPlanId: dayPlan.id,
        }),
      },
      makeSession({
        now: NOW,
        startedAt: NOW,
        timezone: TZ,
        type: 'longBreak',
        status: 'skipped',
        endedAt: ENDED,
        plannedDuration: 900,
        actualDuration: 0,
        skipKind: 'explicitSkip',
        sourceFocusSessionId: sourceFocus.id,
        dayPlanId: dayPlan.id,
      }),
      makeSession({
        now: NOW,
        startedAt: NOW,
        timezone: TZ,
        type: 'extraFocus',
        status: 'completed',
        taskId: task.id,
        endedAt: ENDED,
        actualDuration: 61,
        originIntervalId: interval.id,
      }),
      makeSession({
        now: NOW,
        startedAt: NOW,
        timezone: TZ,
        type: 'extraRest',
        status: 'completed',
        endedAt: ENDED,
        actualDuration: 62,
        originIntervalId: interval.id,
        actualRest: 'long_listen_music',
      }),
    ];
    for (const session of values) {
      await expect(validateSession(session, context([sourceFocus]))).resolves.toBe(session);
    }
  });

  it.each([
    [{ status: 'active', endedAt: ENDED }, 'session.active.endedAt'],
    [{ status: 'active', actualDuration: 1 }, 'session.active.actualDuration'],
    [{ status: 'completed', endedAt: null, actualDuration: 1 }, 'session.endedAt.required'],
    [{ status: 'completed', endedAt: ENDED, actualDuration: null }, 'session.actualDuration.required'],
    [{ status: 'skipped', endedAt: ENDED, actualDuration: 1, skipKind: 'missed' }, 'session.skipped.duration'],
    [{ status: 'completed', endedAt: ENDED, actualDuration: 1, skipKind: 'missed' }, 'session.skipKind.state'],
    [{ status: 'skipped', endedAt: ENDED, actualDuration: 0, skipKind: 'missed' }, 'session.status.type'],
  ] as const)('rejects invalid status matrix %#', async (overrides, code) => {
    await expectCode(focus(overrides as Partial<Session>), code);
  });

  it('enforces type-specific required and null fields', async () => {
    await expectCode(focus({ taskId: null }), 'session.task.required');
    await expectCode(focus({ pomodoroIndex: null }), 'session.pomodoroIndex.required');
    await expectCode(focus({ actualRest: 'short_scalp_massage' }), 'session.field.notApplicable');
    await expectCode(
      makeSession({
        now: NOW,
        startedAt: NOW,
        timezone: TZ,
        type: 'extraFocus',
        status: 'completed',
        taskId: task.id,
        endedAt: ENDED,
        actualDuration: 1,
      }),
      'session.interval.required',
    );
  });

  it('covers skipped, extra*, and discarded type/status matrix rejections', async () => {
    const skippedBreak = makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'shortBreak',
      status: 'skipped',
      endedAt: ENDED,
      plannedDuration: 300,
      actualDuration: 0,
      sourceFocusSessionId: sourceFocus.id,
      dayPlanId: dayPlan.id,
    });
    await expectCode(skippedBreak, 'session.skipped.kind', context([sourceFocus]));

    const validExtraFocus = makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'extraFocus',
      status: 'completed',
      taskId: task.id,
      endedAt: ENDED,
      actualDuration: 1,
      originIntervalId: interval.id,
    });
    await expectCode({ ...validExtraFocus, status: 'active', endedAt: null, actualDuration: null }, 'session.extra.status');
    await expectCode({ ...validExtraFocus, taskId: null }, 'session.task.required');
    await expectCode({ ...validExtraFocus, actualRest: 'short_scalp_massage' }, 'session.field.notApplicable');

    const validExtraRest = makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'extraRest',
      status: 'completed',
      endedAt: ENDED,
      actualDuration: 1,
      originIntervalId: interval.id,
    });
    await expectCode({ ...validExtraRest, status: 'active', endedAt: null, actualDuration: null }, 'session.extra.status');
    await expectCode({ ...validExtraRest, taskId: task.id }, 'session.field.notApplicable');

    const discardedBreak = makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'longBreak',
      status: 'discarded',
      endedAt: ENDED,
      plannedDuration: 900,
      actualDuration: 1,
      sourceFocusSessionId: sourceFocus.id,
      dayPlanId: dayPlan.id,
    });
    await expectCode(discardedBreak, 'session.status.type', context([sourceFocus]));
  });

  it('enforces planned and actual duration rules', async () => {
    await expectCode(focus({ plannedDuration: 1499 }), 'session.plannedDuration.settings');
    await expectCode(focus({ plannedDuration: null }), 'session.plannedDuration.standard');
    const extra = makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'extraRest',
      status: 'completed',
      endedAt: ENDED,
      actualDuration: 0,
      originIntervalId: interval.id,
    });
    await expectCode(extra, 'session.actualDuration.extra');
    await expectCode({ ...extra, actualDuration: 1, plannedDuration: 60 }, 'session.plannedDuration.extra');
  });

  it('validates source focus, rest scope, Task/interval references, and current DayPlan binding', async () => {
    const shortBreak = makeSession({
      now: NOW,
      startedAt: NOW,
      timezone: TZ,
      type: 'shortBreak',
      plannedDuration: 300,
      sourceFocusSessionId: sourceFocus.id,
      suggestedRest: 'long_listen_music',
      dayPlanId: dayPlan.id,
    });
    await expectCode(shortBreak, 'session.restKey.appliesTo', context([sourceFocus]));
    await expectCode(shortBreak, 'session.sourceFocus.invalid', context());
    await expectCode(focus({ taskId: makeTask({ now: NOW, title: 'missing' }).id }), 'session.task.missing');
    await expectCode(focus({ dayPlanId: null }), 'session.dayPlan.current');
  });

  it('derives localDate from startedAt and keeps creation facts immutable on update', async () => {
    await expectCode(focus({ localDate: '2026-06-04' }), 'localDate.derived');
    const previous = focus();
    const completed = { ...previous, status: 'completed' as const, endedAt: ENDED, actualDuration: 20, updatedAt: ENDED };
    await expect(validateSession(completed, context([previous]))).resolves.toBe(completed);
    await expectCode({ ...completed, startedAt: '2026-06-05T15:00:00+08:00' }, 'session.startedAt.immutable', context([previous]));
    await expectCode({ ...completed, plannedDuration: 1200 }, 'session.plannedDuration.immutable', context([previous]));
  });

  it('returns structured timezone issues instead of leaking Intl RangeError', async () => {
    const invalid = { ...focus(), timezone: 'Mars/Olympus' };
    await expect(collectSessionValidationIssues(invalid, context())).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'timezone.iana' })]),
    );
    await expect(validateSession(invalid, context())).rejects.toBeInstanceOf(EntityValidationError);
  });
});
