import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { makeEnergyRecord } from './energyRecord';

const NOW = '2026-06-05T14:37:12+08:00';
const OCCURRED = '2026-05-24T23:50:00+08:00';
const TZ = 'Asia/Shanghai';

const ALL_ENERGY_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
  'timezone',
  'localDate',
  'energyLevel',
  'mood',
  'source',
  'sessionId',
  'note',
  'occurredAt',
].sort();

describe('makeEnergyRecord (S5c, §3.5)', () => {
  it('产出含 EnergyRecord 全部字段键', () => {
    const r = makeEnergyRecord({
      now: NOW,
      occurredAt: OCCURRED,
      timezone: TZ,
      source: 'dayStart',
      energyLevel: 7,
    });
    expect(Object.keys(r).sort()).toEqual(ALL_ENERGY_KEYS);
  });

  it('默认值：mood=null（P1 暂缓采集）、sessionId=null、note=null，同步预留正确', () => {
    const r = makeEnergyRecord({
      now: NOW,
      occurredAt: OCCURRED,
      timezone: TZ,
      source: 'dayStart',
      energyLevel: 7,
    });
    expect(r.energyLevel).toBe(7);
    expect(r.mood).toBeNull();
    expect(r.source).toBe('dayStart');
    expect(r.sessionId).toBeNull();
    expect(r.note).toBeNull();
    expect(r.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(r.deviceId).toBeNull();
    expect(r.syncedAt).toBeNull();
    expect(r.createdAt).toBe(NOW);
    expect(r.updatedAt).toBe(NOW);
  });

  it('localDate 由 occurredAt + timezone 派生', () => {
    const r = makeEnergyRecord({
      now: NOW,
      occurredAt: OCCURRED,
      timezone: TZ,
      source: 'manual',
      energyLevel: 5,
    });
    expect(r.timezone).toBe(TZ);
    expect(r.localDate).toBe('2026-05-24');
    expect(r.occurredAt).toBe(OCCURRED);
  });

  it('覆盖入口生效：afterFocus 携带 sessionId/note', () => {
    const r = makeEnergyRecord({
      now: NOW,
      occurredAt: OCCURRED,
      timezone: TZ,
      source: 'afterFocus',
      energyLevel: 4,
      sessionId: 'session-1',
      note: '有点累',
    });
    expect(r.source).toBe('afterFocus');
    expect(r.sessionId).toBe('session-1');
    expect(r.note).toBe('有点累');
  });
});
