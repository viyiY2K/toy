import { describe, expect, expectTypeOf, it } from 'vitest';
import { makeEvent, type Event, type MakeEventInput } from '../schema/event';
import { EVENT_TYPES, type EventContract, type EventOf, type EventPayloadMap, type EventType } from '.';

const NOW = '2026-06-05T14:37:12+08:00';
const TZ = 'Asia/Shanghai';

describe('Event contract (S7a, v4 §7)', () => {
  it('包含完整且无重复的 78 个事件类型', () => {
    expect(EVENT_TYPES).toHaveLength(78);
    expect(new Set(EVENT_TYPES).size).toBe(78);
    expect(EVENT_TYPES[0]).toBe('task.created');
    expect(EVENT_TYPES.at(-1)).toBe('diagnosticLog.exported');
  });

  it('按 v4 domain 保留每组事件数量', () => {
    const counts = Object.fromEntries(
      [...new Set(EVENT_TYPES.map((type) => type.split('.')[0]))].map((domain) => [
        domain,
        EVENT_TYPES.filter((type) => type.startsWith(`${domain}.`)).length,
      ]),
    );
    expect(counts).toEqual({
      task: 13,
      subtask: 4,
      dayPlan: 12,
      focus: 3,
      break: 3,
      restItem: 10,
      interrupt: 2,
      energy: 1,
      triage: 4,
      interval: 4,
      settings: 8,
      statsBaseline: 1,
      data: 5,
      demo: 2,
      notification: 1,
      prompt: 2,
      error: 2,
      diagnosticLog: 1,
    });
  });

  it('EventOf/Event/工厂保持 type 与 payload 的判别关联', () => {
    const event = makeEvent({
      now: NOW,
      timezone: TZ,
      type: 'focus.discarded',
      payload: {
        pomodoroIndex: 2,
        actualDuration: 300,
        reason: 'userInitiated',
        triggeredByInterruptEventId: null,
      },
    });
    expectTypeOf(event).toEqualTypeOf<Event<'focus.discarded'>>();
    expectTypeOf(event.payload).toEqualTypeOf<EventPayloadMap['focus.discarded']>();
    expectTypeOf<EventOf<'focus.discarded'>>().toMatchTypeOf<EventContract>();
    expect(event.type).toBe('focus.discarded');
  });

  it('判别联合可以按 type 收窄 payload', () => {
    function payloadSource(event: EventContract): string | undefined {
      return event.type === 'task.created' ? event.payload.source : undefined;
    }
    const contract: EventOf<'task.created'> = {
      type: 'task.created',
      payload: { title: 'Task', parentId: null, estimatedPomodoros: 1, source: 'manual' },
    };
    expect(payloadSource(contract)).toBe('manual');
  });

  it('保留 task.deleted 在 Phase 1 可省略 deletedReason 的显式 v4 例外', () => {
    const payload: EventPayloadMap['task.deleted'] = {};
    expect(payload).toEqual({});
  });
});

// 编译期负例：未知事件、缺字段、多字段、错误枚举和非空 payload 省略均被拒绝。
// @ts-expect-error unknown event type is not part of v4 §7
const unknownType: EventType = 'focus.paused';
void unknownType;

const missingField: EventOf<'task.created'> = {
  type: 'task.created',
  // @ts-expect-error task.created requires `source`
  payload: { title: 'Task', parentId: null, estimatedPomodoros: 1 },
};
void missingField;

const extraField: EventOf<'triage.captured'> = {
  type: 'triage.captured',
  // @ts-expect-error payload schema is exact at object-literal call sites
  payload: { title: 'Capture', source: 'manual' },
};
void extraField;

const invalidEnum: EventOf<'break.skipped'> = {
  type: 'break.skipped',
  // @ts-expect-error `earlyEnded` is a removed v3 value
  payload: { breakType: 'shortBreak', skipKind: 'earlyEnded', plannedDuration: 300 },
};
void invalidEnum;

// @ts-expect-error only the empty-payload event may omit payload
makeEvent({ now: NOW, timezone: TZ, type: 'task.created' });

const breakSkippedPayload: EventPayloadMap['break.skipped'] = {
  breakType: 'shortBreak',
  skipKind: 'explicitSkip',
  plannedDuration: 300,
};

// @ts-expect-error a union EventOf must still correlate type and payload
const mismatchedContract: EventOf<'task.created' | 'break.skipped'> = {
  type: 'task.created',
  payload: breakSkippedPayload,
};
void mismatchedContract;

// @ts-expect-error the default MakeEventInput is a discriminated union, not two independent unions
const mismatchedInput: MakeEventInput = {
  now: NOW,
  timezone: TZ,
  type: 'task.created',
  payload: breakSkippedPayload,
};
void mismatchedInput;

function makeFromUnknownType(type: EventType): void {
  // @ts-expect-error a union-typed event name cannot be paired with one arbitrary payload branch
  makeEvent({
    now: NOW,
    timezone: TZ,
    type,
    payload: breakSkippedPayload,
  });
}
void makeFromUnknownType;
