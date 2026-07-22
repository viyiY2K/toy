import { describe, expect, it } from 'vitest';
import { makeUnresolvedInterval, type UnresolvedInterval } from '../schema';
import type { ValidationContext } from './context';
import {
  collectUnresolvedIntervalValidationIssues,
  validateUnresolvedInterval,
} from './unresolvedInterval';

const START = '2026-06-05T14:00:00+08:00';
const END = '2026-06-05T15:00:00+08:00';
const TZ = 'Asia/Shanghai';

function interval(overrides: Partial<UnresolvedInterval> = {}): UnresolvedInterval {
  return {
    ...makeUnresolvedInterval({
      now: END,
      startedAt: START,
      endedAt: END,
      timezone: TZ,
      source: 'appReopened',
    }),
    ...overrides,
  };
}

function context(previous?: UnresolvedInterval): ValidationContext {
  return {
    getUnresolvedInterval: async (id) => (previous?.id === id ? previous : undefined),
  };
}

async function expectCode(value: unknown, code: string, ctx = context()): Promise<void> {
  const issues = await collectUnresolvedIntervalValidationIssues(value, ctx);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateUnresolvedInterval (S6b, v4 §3.6)', () => {
  it('accepts pending, classified, and ignored state matrices', async () => {
    const values = [
      interval(),
      interval({ status: 'classified', classifiedAt: END }),
      interval({ status: 'ignored', ignoredAt: END, ignoreReason: 'not useful' }),
    ];
    for (const value of values) {
      await expect(validateUnresolvedInterval(value, context())).resolves.toBe(value);
    }
  });

  it.each([
    [{ endedAt: START }, 'interval.time.order'],
    [{ endedAt: '2026-06-05T13:59:59+08:00' }, 'interval.time.order'],
    [{ status: 'classified', classifiedAt: null }, 'interval.classifiedAt.required'],
    [{ status: 'classified', classifiedAt: END, ignoredAt: END }, 'interval.ignoredAt.state'],
    [{ status: 'ignored', ignoredAt: null }, 'interval.ignoredAt.required'],
    [{ status: 'ignored', ignoredAt: END, classifiedAt: END }, 'interval.classifiedAt.state'],
    [{ status: 'pending', classifiedAt: END }, 'interval.classifiedAt.state'],
    [{ status: 'pending', ignoredAt: END }, 'interval.ignoredAt.state'],
    [{ status: 'pending', ignoreReason: 'reason' }, 'interval.ignoreReason.state'],
    [{ status: 'ignored', ignoredAt: END, deletedAt: END }, 'interval.ignored.audit'],
  ] as const)('rejects invalid interval matrix %#', async (overrides, code) => {
    await expectCode(interval(overrides as Partial<UnresolvedInterval>), code);
  });

  it('validates source and localDate', async () => {
    await expectCode({ ...interval(), source: 'idleDetection' }, 'interval.source');
    await expectCode(interval({ localDate: '2026-06-04' }), 'localDate.derived');
  });

  it('allows status resolution but preserves occurrence facts on update', async () => {
    const previous = interval();
    const classified = { ...previous, status: 'classified' as const, classifiedAt: END, updatedAt: END };
    await expect(validateUnresolvedInterval(classified, context(previous))).resolves.toBe(classified);
    await expectCode(
      { ...classified, startedAt: '2026-06-05T14:30:00+08:00' },
      'interval.startedAt.immutable',
      context(previous),
    );
  });

  it('rejects derived duration as an extra stored field', async () => {
    await expectCode({ ...interval(), duration: 3600 }, 'field.extra');
  });
});
