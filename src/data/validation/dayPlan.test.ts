import { describe, expect, it } from 'vitest';
import { makeDayPlan, makeTask, type DayPlan } from '../schema';
import { newId } from '../id';
import { collectDayPlanValidationIssues, validateDayPlan } from './dayPlan';

const NOW = '2026-06-05T14:00:00+08:00';
const TZ = 'Asia/Shanghai';

function validDayPlan(overrides: Partial<DayPlan> = {}): DayPlan {
  return {
    ...makeDayPlan({ now: NOW, timezone: TZ, appDayStartOffsetMinutes: 0 }),
    ...overrides,
  };
}

const EMPTY_DAY_PLAN_CONTEXT = {
  getTask: async () => undefined,
  getDayPlan: async () => undefined,
  getActiveDayPlanByAppDate: async () => undefined,
};

async function expectCode(value: unknown, code: string): Promise<void> {
  const issues = await collectDayPlanValidationIssues(value);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateDayPlan (S6a, v4 §3.2)', () => {
  it('accepts the complete default DayPlan', async () => {
    const dayPlan = validDayPlan();
    await expect(validateDayPlan(dayPlan, EMPTY_DAY_PLAN_CONTEXT)).resolves.toBe(dayPlan);
  });

  it('accepts unique existing Task references and enforces appDate uniqueness', async () => {
    const task = makeTask({ now: NOW, title: 'today' });
    const dayPlan = validDayPlan({ taskIds: [task.id] });
    await expect(
      validateDayPlan(dayPlan, {
        getTask: async (id) => (id === task.id ? task : undefined),
        getDayPlan: async () => dayPlan,
        getActiveDayPlanByAppDate: async () => dayPlan,
      }),
    ).resolves.toBe(dayPlan);

    const other = validDayPlan();
    const issues = await collectDayPlanValidationIssues(dayPlan, {
      getTask: async () => task,
      getDayPlan: async () => dayPlan,
      getActiveDayPlanByAppDate: async () => other,
    });
    expect(issues.map((issue) => issue.code)).toContain('dayPlan.appDate.unique');
  });

  it('keeps timezone/localDate/appDate immutable while allowing ordinary updates', async () => {
    const previous = validDayPlan();
    const updated = { ...previous, budgetPomodoros: 3, updatedAt: '2026-06-05T15:00:00+08:00' };
    const context = {
      getDayPlan: async () => previous,
      getActiveDayPlanByAppDate: async () => previous,
    };
    await expect(validateDayPlan(updated, context)).resolves.toBe(updated);

    for (const [field, value, code] of [
      ['timezone', 'Asia/Tokyo', 'dayPlan.timezone.immutable'],
      ['localDate', '2026-06-06', 'dayPlan.localDate.immutable'],
      ['appDate', '2026-06-06', 'dayPlan.appDate.immutable'],
    ] as const) {
      const issues = await collectDayPlanValidationIssues({ ...updated, [field]: value }, context);
      expect(issues.map((issue) => issue.code)).toContain(code);
    }
  });

  it('rejects duplicate, malformed, and missing Task references', async () => {
    const id = newId();
    await expectCode(validDayPlan({ taskIds: [id, id] }), 'dayPlan.taskIds.duplicate');
    await expectCode(validDayPlan({ taskIds: ['not-a-v7'] }), 'id.uuidV7');
    const issues = await collectDayPlanValidationIssues(validDayPlan({ taskIds: [id] }), {
      getTask: async () => undefined,
    });
    expect(issues.map((issue) => issue.code)).toContain('dayPlan.task.missing');
  });

  it('validates freeMin after summing unrounded deduction minutes', async () => {
    const estimate = {
      workWindowMin: 100,
      fixedDeductions: [{ id: newId(), label: 'A', hours: 0.333 }],
      lifeDeductions: [{ id: newId(), label: 'B', hours: 0.333 }],
      freeMin: 60,
      conservativePomodoros: 1,
      optimisticPomodoros: 2,
    };
    await expect(validateDayPlan(validDayPlan({ estimate }), EMPTY_DAY_PLAN_CONTEXT)).resolves.toBeDefined();
    await expectCode(validDayPlan({ estimate: { ...estimate, freeMin: 61 } }), 'dayPlan.estimate.freeMin');
    await expect(
      validateDayPlan(
        validDayPlan({
          estimate: { ...estimate, workWindowMin: 10, freeMin: 0 },
        }),
        EMPTY_DAY_PLAN_CONTEXT,
      ),
    ).resolves.toBeDefined();
  });

  it('validates deduction shape, values, and per-array identity', async () => {
    const id = newId();
    const invalid = validDayPlan({
      estimate: {
        workWindowMin: 60,
        fixedDeductions: [
          { id, label: '', hours: 0 },
          { id, label: 'duplicate', hours: 1 },
        ],
        lifeDeductions: [],
        freeMin: 0,
        conservativePomodoros: 0,
        optimisticPomodoros: 0,
      },
    });
    const result = (await collectDayPlanValidationIssues(invalid)).map((issue) => issue.code);
    expect(result).toContain('dayPlan.deduction.label');
    expect(result).toContain('number.minExclusive');
    expect(result).toContain('dayPlan.deduction.duplicateId');
  });

  it.each([
    [{ budgetPomodoros: -1 }, 'number.min'],
    [{ budgetMode: 'automatic' }, 'dayPlan.budgetMode'],
    [{ settingsSnapshot: { focusMinutes: 4, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 } }, 'number.min'],
    [{ settingsSnapshot: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 25, longBreakEvery: 4 } }, 'settings.longBreakMinutes'],
    [{ settingsSnapshot: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 3 } }, 'settings.longBreakEvery'],
  ] as const)('rejects invalid numeric/enumerated field %#', async (overrides, code) => {
    await expectCode(validDayPlan(overrides as Partial<DayPlan>), code);
  });

  it('validates IANA timezone, stored localDate, appDate format, and exact nested keys', async () => {
    await expectCode(validDayPlan({ timezone: 'Mars/Olympus' }), 'timezone.iana');
    await expectCode(validDayPlan({ localDate: '2026-06-04' }), 'localDate.derived');
    await expectCode(validDayPlan({ appDate: '06/05/2026' }), 'date.iso');
    await expectCode(
      validDayPlan({ settingsSnapshot: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 } as never }),
      'field.missing',
    );
  });
});
