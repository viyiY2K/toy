import { describe, expect, it } from 'vitest';
import { makeEnergyRecord, makeSession, type EnergyRecord, type Session } from '../schema';
import type { ValidationContext } from './context';
import { collectEnergyRecordValidationIssues, validateEnergyRecord } from './energyRecord';

const NOW = '2026-06-05T14:00:00+08:00';
const TZ = 'Asia/Shanghai';

function record(overrides: Partial<EnergyRecord> = {}): EnergyRecord {
  return {
    ...makeEnergyRecord({ now: NOW, occurredAt: NOW, timezone: TZ, source: 'manual', energyLevel: 5 }),
    ...overrides,
  };
}

function context(sessions: Session[] = [], previous?: EnergyRecord): ValidationContext {
  return {
    getSession: async (id) => sessions.find((session) => session.id === id),
    getEnergyRecord: async (id) => (previous?.id === id ? previous : undefined),
  };
}

async function expectCode(value: unknown, code: string, ctx = context()): Promise<void> {
  const issues = await collectEnergyRecordValidationIssues(value, ctx);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateEnergyRecord (S6b, v4 §3.5)', () => {
  it.each(['dayStart', 'beforeFocus', 'onReturn', 'manual'] as const)(
    'accepts standalone source %s with sessionId=null',
    async (source) => {
      await expect(validateEnergyRecord(record({ source }), context())).resolves.toBeDefined();
    },
  );

  it.each([
    ['afterFocus', 'focus'],
    ['afterShortBreak', 'shortBreak'],
    ['afterLongBreak', 'longBreak'],
    ['afterExtraFocus', 'extraFocus'],
    ['afterExtraRest', 'extraRest'],
  ] as const)('accepts %s only with a matching %s Session', async (source, type) => {
    const session = makeSession({ now: NOW, startedAt: NOW, timezone: TZ, type });
    const value = record({ source, sessionId: session.id });
    await expect(validateEnergyRecord(value, context([session]))).resolves.toBe(value);
    await expectCode(value, 'energy.session.type', context());
  });

  it.each([
    [{ energyLevel: 0 }, 'number.min'],
    [{ energyLevel: 11 }, 'number.max'],
    [{ energyLevel: 1.5 }, 'number.integer'],
    [{ mood: 0 }, 'number.min'],
    [{ mood: 11 }, 'number.max'],
    [{ source: 'manual', sessionId: makeSession({ now: NOW, startedAt: NOW, timezone: TZ, type: 'focus' }).id }, 'energy.session.notApplicable'],
    [{ source: 'afterFocus', sessionId: null }, 'energy.session.required'],
  ] as const)('rejects invalid EnergyRecord %#', async (overrides, code) => {
    await expectCode(record(overrides as Partial<EnergyRecord>), code);
  });

  it('validates localDate and preserves occurrence facts on update', async () => {
    await expectCode(record({ localDate: '2026-06-04' }), 'localDate.derived');
    const previous = record();
    const updated = { ...previous, note: 'after note', updatedAt: '2026-06-05T15:00:00+08:00' };
    await expect(validateEnergyRecord(updated, context([], previous))).resolves.toBe(updated);
    await expectCode(
      { ...updated, occurredAt: '2026-06-05T15:00:00+08:00' },
      'energy.occurredAt.immutable',
      context([], previous),
    );
  });

  it('rejects extra runtime fields such as derived recoveryDelta', async () => {
    await expectCode({ ...record(), recoveryDelta: 2 }, 'field.extra');
  });
});
