import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import {
  makeEventBase,
  makeLocalDateFields,
  makeSyncableBase,
} from './common';

const NOW = '2026-06-05T14:37:12+08:00';

describe('common: makeSyncableBase (S5a, §2.3)', () => {
  it('套用全部同步预留字段，预留项默认 null', () => {
    const base = makeSyncableBase({ now: NOW });
    expect(Object.keys(base).sort()).toEqual(
      ['createdAt', 'deletedAt', 'deviceId', 'id', 'schemaVersion', 'syncedAt', 'updatedAt'].sort(),
    );
    expect(base.createdAt).toBe(NOW);
    expect(base.updatedAt).toBe(NOW);
    expect(base.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(base.deletedAt).toBeNull();
    expect(base.deviceId).toBeNull();
    expect(base.syncedAt).toBeNull();
  });

  it('未传 id 时由单一入口生成（非空、各次不同）', () => {
    const a = makeSyncableBase({ now: NOW });
    const b = makeSyncableBase({ now: NOW });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('显式 id / deletedAt 覆盖项被采用', () => {
    const base = makeSyncableBase({ id: 'fixed-id', now: NOW, deletedAt: NOW });
    expect(base.id).toBe('fixed-id');
    expect(base.deletedAt).toBe(NOW);
  });

  it('deviceId / syncedAt 是 Phase 1 预留同步字段，普通写入恒为 null（不开放非 null override）', () => {
    // Phase 1 口径：普通工厂入口不接受 deviceId / syncedAt 覆盖，未来同步阶段经专门路径再开放。
    const base = makeSyncableBase({ id: 'fixed-id', now: NOW, deletedAt: NOW });
    expect(base.deviceId).toBeNull();
    expect(base.syncedAt).toBeNull();
  });
});

describe('common: makeEventBase (S5a, §2.3 例外 / 红线 7)', () => {
  it('只挂 id/createdAt/schemaVersion，不挂 updatedAt/deletedAt/deviceId/syncedAt', () => {
    const base = makeEventBase({ now: NOW });
    expect(Object.keys(base).sort()).toEqual(['createdAt', 'id', 'schemaVersion'].sort());
    expect('updatedAt' in base).toBe(false);
    expect('deletedAt' in base).toBe(false);
    expect('deviceId' in base).toBe(false);
    expect('syncedAt' in base).toBe(false);
    expect(base.createdAt).toBe(NOW);
    expect(base.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(base.id).toBeTruthy();
  });
});

describe('common: makeLocalDateFields (S5a, §2.5)', () => {
  it('由业务时间 + timezone 派生 localDate（事实自然日，非 UTC 日）', () => {
    // 北京时间 23:50 属于当日；同一时刻 UTC 已是次日，但 localDate 取本地日。
    const fields = makeLocalDateFields('2026-05-24T23:50:00+08:00', 'Asia/Shanghai');
    expect(fields).toEqual({ timezone: 'Asia/Shanghai', localDate: '2026-05-24' });
  });

  it('localDate 取业务时间字段，不受 now 影响', () => {
    const fields = makeLocalDateFields('2026-01-01T08:00:00+08:00', 'Asia/Shanghai');
    expect(fields.localDate).toBe('2026-01-01');
  });
});
