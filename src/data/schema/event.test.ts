import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { makeEvent } from './event';

const NOW = '2026-06-05T14:37:12+08:00';
const TZ = 'Asia/Shanghai';

const ALL_EVENT_KEYS = [
  // Event 基字段（§3.4：仅 id/createdAt/schemaVersion）
  'id',
  'createdAt',
  'schemaVersion',
  // 时区/自然日（§2.5）
  'timezone',
  'localDate',
  // Event 专属（§3.4）
  'type',
  'occurredAt',
  'payload',
  'taskId',
  'sessionId',
  'dayPlanId',
  'energyRecordId',
  'unresolvedIntervalId',
  'settingsId',
  'correlationId',
].sort();

describe('makeEvent (S5c, §3.4)', () => {
  it('产出含 Event 全部字段键', () => {
    const e = makeEvent({
      now: NOW,
      timezone: TZ,
      type: 'task.created',
      payload: { title: 'Task', parentId: null, estimatedPomodoros: 1, source: 'manual' },
    });
    expect(Object.keys(e).sort()).toEqual(ALL_EVENT_KEYS);
  });

  it('Event 不挂 updatedAt/deletedAt/deviceId/syncedAt（append-only，红线 7）', () => {
    const e = makeEvent({
      now: NOW,
      timezone: TZ,
      type: 'task.created',
      payload: { title: 'Task', parentId: null, estimatedPomodoros: 1, source: 'manual' },
    });
    expect('updatedAt' in e).toBe(false);
    expect('deletedAt' in e).toBe(false);
    expect('deviceId' in e).toBe(false);
    expect('syncedAt' in e).toBe(false);
  });

  it('空 payload 事件默认={}；关联 id/correlationId=null、occurredAt 默认=now', () => {
    const e = makeEvent({ now: NOW, timezone: TZ, type: 'triage.movedToList' });
    expect(e.payload).toEqual({});
    expect(e.taskId).toBeNull();
    expect(e.sessionId).toBeNull();
    expect(e.dayPlanId).toBeNull();
    expect(e.energyRecordId).toBeNull();
    expect(e.unresolvedIntervalId).toBeNull();
    expect(e.settingsId).toBeNull();
    expect(e.correlationId).toBeNull();
    expect(e.occurredAt).toBe(NOW);
    expect(e.createdAt).toBe(NOW);
    expect(e.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('localDate 由 occurredAt + timezone 派生（occurredAt 可早于 createdAt）', () => {
    const e = makeEvent({
      now: NOW,
      occurredAt: '2026-05-24T23:50:00+08:00',
      timezone: TZ,
      type: 'focus.started',
      payload: { pomodoroIndex: 1, plannedDuration: 1500, taskEstimateAtStart: 1 },
    });
    expect(e.localDate).toBe('2026-05-24');
    expect(e.occurredAt).toBe('2026-05-24T23:50:00+08:00');
    expect(e.createdAt).toBe(NOW);
  });

  it('覆盖入口生效：payload / 关联 id / correlationId', () => {
    const e = makeEvent({
      now: NOW,
      timezone: TZ,
      type: 'dayPlan.taskAdded',
      payload: { addedAtIndex: 0, source: 'systemDailyTemplate' },
      taskId: 'task-1',
      dayPlanId: 'plan-1',
      correlationId: 'corr-1',
    });
    expect(e.payload).toEqual({ addedAtIndex: 0, source: 'systemDailyTemplate' });
    expect(e.taskId).toBe('task-1');
    expect(e.dayPlanId).toBe('plan-1');
    expect(e.correlationId).toBe('corr-1');
  });
});
