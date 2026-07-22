import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { makeUnresolvedInterval } from './unresolvedInterval';

const NOW = '2026-06-05T14:37:12+08:00';
const STARTED = '2026-05-24T23:50:00+08:00';
const ENDED = '2026-05-25T00:30:00+08:00';
const TZ = 'Asia/Shanghai';

const ALL_INTERVAL_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
  'timezone',
  'localDate',
  'source',
  'startedAt',
  'endedAt',
  'status',
  'classifiedAt',
  'ignoredAt',
  'ignoreReason',
].sort();

describe('makeUnresolvedInterval (S5c, §3.6)', () => {
  it('产出含 UnresolvedInterval 全部字段键（全表全字段，红线 11）', () => {
    const u = makeUnresolvedInterval({
      now: NOW,
      startedAt: STARTED,
      endedAt: ENDED,
      timezone: TZ,
      source: 'appReopened',
    });
    expect(Object.keys(u).sort()).toEqual(ALL_INTERVAL_KEYS);
  });

  it('默认值：status=pending，归类字段默认 null，同步预留正确', () => {
    const u = makeUnresolvedInterval({
      now: NOW,
      startedAt: STARTED,
      endedAt: ENDED,
      timezone: TZ,
      source: 'appReopened',
    });
    expect(u.status).toBe('pending');
    expect(u.classifiedAt).toBeNull();
    expect(u.ignoredAt).toBeNull();
    expect(u.ignoreReason).toBeNull();
    expect(u.source).toBe('appReopened');
    expect(u.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(u.deviceId).toBeNull();
    expect(u.syncedAt).toBeNull();
    expect(u.createdAt).toBe(NOW);
    expect(u.updatedAt).toBe(NOW);
  });

  it('localDate 由 startedAt + timezone 派生（"发生在哪天"，非处理日）', () => {
    const u = makeUnresolvedInterval({
      now: NOW,
      startedAt: STARTED,
      endedAt: ENDED,
      timezone: TZ,
      source: 'systemRecovered',
    });
    expect(u.timezone).toBe(TZ);
    expect(u.localDate).toBe('2026-05-24');
    expect(u.startedAt).toBe(STARTED);
    expect(u.endedAt).toBe(ENDED);
  });

  it('覆盖入口生效：classified 携带 status/classifiedAt', () => {
    const u = makeUnresolvedInterval({
      now: NOW,
      startedAt: STARTED,
      endedAt: ENDED,
      timezone: TZ,
      source: 'userNoResponse',
      status: 'classified',
      classifiedAt: NOW,
    });
    expect(u.status).toBe('classified');
    expect(u.classifiedAt).toBe(NOW);
  });
});
