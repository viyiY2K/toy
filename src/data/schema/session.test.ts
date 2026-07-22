import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { makeSession, type SessionType } from './session';

const NOW = '2026-06-05T14:37:12+08:00';
const STARTED = '2026-05-24T23:50:00+08:00';
const TZ = 'Asia/Shanghai';

const ALL_SESSION_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
  'timezone',
  'localDate',
  'type',
  'status',
  'taskId',
  'startedAt',
  'endedAt',
  'plannedDuration',
  'actualDuration',
  'pomodoroIndex',
  'skipKind',
  'originIntervalId',
  'sourceFocusSessionId',
  'suggestedRest',
  'actualRest',
  'dayPlanId',
].sort();

describe('makeSession (S5c, §3.3)', () => {
  it('产出含 Session 全部字段键（含同步预留 + 时区/自然日）', () => {
    const s = makeSession({ now: NOW, startedAt: STARTED, timezone: TZ, type: 'focus' });
    expect(Object.keys(s).sort()).toEqual(ALL_SESSION_KEYS);
  });

  it('5 种 type 字段键集合完全一致（红线 13）', () => {
    const types: SessionType[] = ['focus', 'shortBreak', 'longBreak', 'extraFocus', 'extraRest'];
    const keySets = types.map((type) =>
      Object.keys(makeSession({ now: NOW, startedAt: STARTED, timezone: TZ, type })).sort(),
    );
    for (const keys of keySets) {
      expect(keys).toEqual(ALL_SESSION_KEYS);
    }
  });

  it('默认值：status=active，不适用字段默认 null，同步预留正确', () => {
    const s = makeSession({ now: NOW, startedAt: STARTED, timezone: TZ, type: 'focus' });
    expect(s.status).toBe('active');
    expect(s.taskId).toBeNull();
    expect(s.endedAt).toBeNull();
    expect(s.plannedDuration).toBeNull();
    expect(s.actualDuration).toBeNull();
    expect(s.pomodoroIndex).toBeNull();
    expect(s.skipKind).toBeNull();
    expect(s.originIntervalId).toBeNull();
    expect(s.sourceFocusSessionId).toBeNull();
    expect(s.suggestedRest).toBeNull();
    expect(s.actualRest).toBeNull();
    expect(s.dayPlanId).toBeNull();
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(s.deviceId).toBeNull();
    expect(s.syncedAt).toBeNull();
    expect(s.createdAt).toBe(NOW);
    expect(s.updatedAt).toBe(NOW);
  });

  it('localDate 由 startedAt + timezone 派生（非 now、非 UTC 日）', () => {
    const s = makeSession({ now: NOW, startedAt: STARTED, timezone: TZ, type: 'focus' });
    expect(s.timezone).toBe(TZ);
    expect(s.localDate).toBe('2026-05-24');
    expect(s.startedAt).toBe(STARTED);
  });

  it('覆盖入口生效：focus 携带 taskId/pomodoroIndex/plannedDuration', () => {
    const s = makeSession({
      now: NOW,
      startedAt: STARTED,
      timezone: TZ,
      type: 'focus',
      taskId: 'task-1',
      pomodoroIndex: 1,
      plannedDuration: 1500,
    });
    expect(s.taskId).toBe('task-1');
    expect(s.pomodoroIndex).toBe(1);
    expect(s.plannedDuration).toBe(1500);
  });

  it('覆盖入口生效：extraFocus 携带 status=completed/originIntervalId/actualDuration', () => {
    const s = makeSession({
      now: NOW,
      startedAt: STARTED,
      timezone: TZ,
      type: 'extraFocus',
      status: 'completed',
      taskId: 'task-1',
      originIntervalId: 'interval-1',
      endedAt: NOW,
      actualDuration: 900,
    });
    expect(s.status).toBe('completed');
    expect(s.originIntervalId).toBe('interval-1');
    expect(s.actualDuration).toBe(900);
  });
});
