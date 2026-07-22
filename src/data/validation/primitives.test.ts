import { describe, expect, it } from 'vitest';
import { makeTask } from '../schema';
import { collectTaskValidationIssues } from './task';

const NOW = '2026-06-05T14:37:12+08:00';

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
    ['deviceId', 'device-a', 'sync.deviceId.reserved'],
    ['syncedAt', NOW, 'sync.syncedAt.reserved'],
  ])('rejects invalid Phase 1 base field %s', async (field, value, expectedCode) => {
    const task = { ...makeTask({ now: NOW, title: 'invalid' }), [field]: value };
    expect(codes(await collectTaskValidationIssues(task))).toContain(expectedCode);
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
