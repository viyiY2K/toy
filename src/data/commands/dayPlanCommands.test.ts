import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { DayPlan, Event } from '../schema';
import {
  acceptDayPlanBudget,
  addDayPlanDeduction,
  estimateDayPlanBudget,
  removeDayPlanDeduction,
  type DeductionType,
  updateDayPlanDeduction,
  updateDayPlanWorkWindow,
} from './dayPlanCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) =>
  `2027-01-04T09:${String(minute).padStart(2, '0')}:00+08:00`;

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

describe('Phase 2 S1a DayPlan budget commands', () => {
  it('updates the work window and deduction facts while recalculating the persisted estimate', async () => {
    const window = await updateDayPlanWorkWindow({
      now: at(0), timezone: TIMEZONE, workWindowMin: 360,
    });
    expect(window.value.estimate).toMatchObject({
      workWindowMin: 360,
      freeMin: 360,
      conservativePomodoros: 11,
      optimisticPomodoros: 12,
    });
    expect((await eventsFor(window.correlationId))[0]).toMatchObject({
      type: 'dayPlan.updated',
      payload: { field: 'estimate.workWindowMin', oldValue: 0, newValue: 360 },
    });

    const fixed = await addDayPlanDeduction({
      now: at(1), timezone: TIMEZONE, deductionType: 'fixed', label: '  站会  ', hours: 0.5,
    });
    const fixedItem = fixed.value.estimate.fixedDeductions[0]!;
    expect(fixedItem).toMatchObject({ label: '站会', hours: 0.5 });
    expect(fixed.value.estimate.freeMin).toBe(330);
    expect((await eventsFor(fixed.correlationId))[0]).toMatchObject({
      type: 'dayPlan.deductionAdded',
      payload: { deductionType: 'fixed', deductionId: fixedItem.id, label: '站会', hours: 0.5 },
    });

    const life = await addDayPlanDeduction({
      now: at(2), timezone: TIMEZONE, deductionType: 'life', label: '午餐', hours: 1,
    });
    const lifeItem = life.value.estimate.lifeDeductions[0]!;
    expect(life.value.estimate.freeMin).toBe(270);

    const changed = await updateDayPlanDeduction({
      now: at(3), timezone: TIMEZONE, deductionType: 'life',
      deductionId: lifeItem.id, hours: 0.5,
    });
    expect(changed.value.estimate.freeMin).toBe(300);
    expect((await eventsFor(changed.correlationId))[0]).toMatchObject({
      type: 'dayPlan.deductionUpdated',
      payload: {
        deductionType: 'life', deductionId: lifeItem.id, label: '午餐', oldHours: 1, newHours: 0.5,
      },
    });

    const removed = await removeDayPlanDeduction({
      now: at(4), timezone: TIMEZONE, deductionType: 'fixed', deductionId: fixedItem.id,
    });
    expect(removed.value.estimate.fixedDeductions).toEqual([]);
    expect(removed.value.estimate.freeMin).toBe(330);
    expect((await eventsFor(removed.correlationId))[0]).toMatchObject({
      type: 'dayPlan.deductionRemoved',
      payload: { deductionType: 'fixed', deductionId: fixedItem.id, label: '站会', hours: 0.5 },
    });
  });

  it('records estimate display and budget acceptance without a P3 mode-change Event', async () => {
    const estimated = await estimateDayPlanBudget({ now: at(5), timezone: TIMEZONE });
    expect((await eventsFor(estimated.correlationId))[0]).toMatchObject({
      type: 'dayPlan.budgetEstimated',
      payload: {
        budgetMode: 'conservative',
        conservativePomodoros: estimated.value.estimate.conservativePomodoros,
        optimisticPomodoros: estimated.value.estimate.optimisticPomodoros,
        workWindowMin: 360,
      },
    });
    expect(estimated.value.budgetPomodoros).toBe(0);

    const accepted = await acceptDayPlanBudget({
      now: at(6), timezone: TIMEZONE, budgetMode: 'optimistic', budgetPomodoros: 10,
    });
    expect(accepted.value).toMatchObject({ budgetMode: 'optimistic', budgetPomodoros: 10 });
    expect((await eventsFor(accepted.correlationId))).toMatchObject([
      {
        type: 'dayPlan.budgetAccepted',
        payload: { budgetMode: 'optimistic', budgetPomodoros: 10 },
      },
    ]);
    expect((await eventsFor(accepted.correlationId)).some(
      ({ type }) => type === 'dayPlan.budgetModeChanged',
    )).toBe(false);
  });

  it('rejects invalid/no-op inputs without changing the DayPlan or appending business Events', async () => {
    const plans = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    const before = plans.find(({ appDate }) => appDate === '2027-01-04')!;
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(addDayPlanDeduction({
      now: at(7), timezone: TIMEZONE, deductionType: 'fixed', label: '非法', hours: 0,
    })).rejects.toThrow(/大于 0/);
    await expect(updateDayPlanWorkWindow({
      now: at(8), timezone: TIMEZONE, workWindowMin: before.estimate.workWindowMin,
    })).rejects.toThrow(/必须与旧值不同/);
    await expect(removeDayPlanDeduction({
      now: at(9), timezone: TIMEZONE, deductionType: 'life', deductionId: before.id,
    })).rejects.toThrow(/不存在/);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, before.id)).toEqual(before);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('rolls back a valid DayPlan mutation when its matching Event fails validation', async () => {
    const before = (await dataStore.getAll<DayPlan>(STORE.dayPlans)).find(
      ({ appDate }) => appDate === '2027-01-04',
    )!;
    const beforeEventIds = new Set(
      (await dataStore.getAll<Event>(EVENT_STORE)).map(({ id }) => id),
    );

    await expect(addDayPlanDeduction({
      now: at(10),
      timezone: TIMEZONE,
      deductionType: 'unsupported' as DeductionType,
      label: '事务故障注入',
      hours: 0.25,
    })).rejects.toThrow(/value\.enum/);

    expect(await dataStore.get<DayPlan>(STORE.dayPlans, before.id)).toEqual(before);
    const appended = (await dataStore.getAll<Event>(EVENT_STORE)).filter(
      ({ id }) => !beforeEventIds.has(id),
    );
    expect(appended).toMatchObject([
      {
        type: 'error.unexpectedState',
        payload: {
          errorCode: 'ERR_WRITE_VALIDATION',
          context: {
            entityType: 'Event',
            operation: 'appendEvent',
            sourceEventType: 'dayPlan.deductionAdded',
          },
        },
      },
    ]);
    expect(appended.some(({ type }) => type.startsWith('dayPlan.'))).toBe(false);
  });
});
