import { describe, expect, it } from 'vitest';
import { makeTask } from '../schema';
import { collectTaskValidationIssues } from './task';

const NOW = '2026-06-05T14:37:12+08:00';
const DEVICE_ID = '018f5e2a-0000-7000-8000-000000000000';

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe('S6a common validation primitives (§2.2–§2.5)', () => {
  it('accepts a factory-created syncable entity', async () => {
    await expect(collectTaskValidationIssues(makeTask({ now: NOW, title: 'valid' }))).resolves.toEqual([]);
  });

  it.each([
    ['id', 'not-a-v7-id', 'id.uuidV7'],
    ['createdAt', '2026-06-05T14:37:12', 'time.isoWithOffset'],
    ['updatedAt', 'not-a-time', 'time.isoWithOffset'],
    ['schemaVersion', 4, 'schemaVersion.current'],
    ['deletedAt', '2026-06-05', 'time.isoWithOffset'],
  ])('rejects invalid Phase 1 base field %s', async (field, value, expectedCode) => {
    const task = { ...makeTask({ now: NOW, title: 'invalid' }), [field]: value };
    expect(codes(await collectTaskValidationIssues(task))).toContain(expectedCode);
  });

  // deviceId/syncedAt 的"配对"规则（S4，ADR-0035）：本地写入模式下两者要么都是 null
  // （从未同步过），要么都是合法非空值（此前 'sync' 模式写入落下的、本次本地编辑原样带过）。
  describe('deviceId/syncedAt pairing under local write mode', () => {
    it('rejects deviceId set without syncedAt（内容本身也不是合法 UUID）', async () => {
      const task = { ...makeTask({ now: NOW, title: 'invalid' }), deviceId: 'device-a' };
      const result = codes(await collectTaskValidationIssues(task));
      expect(result).toContain('sync.syncedAt.pairing');
      expect(result).toContain('id.uuidV7');
    });

    it('rejects syncedAt set without deviceId', async () => {
      const task = { ...makeTask({ now: NOW, title: 'invalid' }), syncedAt: NOW };
      const result = codes(await collectTaskValidationIssues(task));
      expect(result).toContain('sync.deviceId.pairing');
    });

    it('accepts both null (从未同步过，Phase 1 原有口径)', async () => {
      await expect(
        collectTaskValidationIssues({ ...makeTask({ now: NOW, title: 'valid' }), deviceId: null, syncedAt: null }),
      ).resolves.toEqual([]);
    });

    it('accepts both set to valid non-null values（模拟编辑一条此前已同步过的记录，S1 发现的生命周期缺口在此修复）', async () => {
      const task = { ...makeTask({ now: NOW, title: 'valid' }), deviceId: DEVICE_ID, syncedAt: NOW };
      await expect(collectTaskValidationIssues(task)).resolves.toEqual([]);
    });

    it('rejects a syntactically invalid syncedAt even when deviceId is also set', async () => {
      const task = { ...makeTask({ now: NOW, title: 'invalid' }), deviceId: DEVICE_ID, syncedAt: 'not-a-time' };
      expect(codes(await collectTaskValidationIssues(task))).toContain('time.isoWithOffset');
    });
  });

  describe("mode='sync'（同步引擎写入）", () => {
    it('rejects null deviceId/syncedAt under sync mode', async () => {
      const task = makeTask({ now: NOW, title: 'invalid' });
      const result = codes(await collectTaskValidationIssues(task, undefined, 'sync'));
      expect(result).toContain('id.uuidV7');
      expect(result).toContain('time.isoWithOffset');
    });

    it('accepts valid non-null deviceId/syncedAt under sync mode', async () => {
      const task = { ...makeTask({ now: NOW, title: 'valid' }), deviceId: DEVICE_ID, syncedAt: NOW };
      await expect(collectTaskValidationIssues(task, undefined, 'sync')).resolves.toEqual([]);
    });
  });

  it('rejects missing and additional top-level fields', async () => {
    const task = { ...makeTask({ now: NOW, title: 'invalid' }), bucket: 'today' } as Record<string, unknown>;
    delete task.note;
    const result = codes(await collectTaskValidationIssues(task));
    expect(result).toContain('field.missing');
    expect(result).toContain('field.extra');
  });

  it.each([
    '2026-02-29T14:00:00+08:00',
    '2026-04-31T14:00:00+08:00',
    '2026-01-01T24:00:00+08:00',
    '2026-01-01T14:60:00+08:00',
    '2026-01-01T14:00:60+08:00',
    '2026-01-01T14:00:00+14:01',
    '2026-01-01T14:00:00+15:00',
  ])('rejects normalized or out-of-range ISO timestamp %s', async (createdAt) => {
    const issues = await collectTaskValidationIssues({ ...makeTask({ now: NOW, title: 'x' }), createdAt });
    expect(codes(issues)).toContain('time.isoWithOffset');
  });

  it.each(['2024-02-29T23:59:59.123Z', '2026-01-01T00:00:00+14:00'])(
    'accepts valid calendar edge timestamp %s',
    async (createdAt) => {
      expect(await collectTaskValidationIssues({ ...makeTask({ now: NOW, title: 'x' }), createdAt })).toEqual([]);
    },
  );
});
