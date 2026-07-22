import { EVENT_STORE, STORE } from '../dataStore';
import { newId } from '../id';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import { calculateDayPlanEstimate } from '../planning/dayPlanBudget';
import { makeEvent, type BudgetMode, type DayPlan, type Deduction } from '../schema';
import {
  executeAtomicWrite,
  type ValidatedAtomicWriteTransaction,
} from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';

export type DeductionType = 'fixed' | 'life';

function eventFields(clock: InitializationClock, correlationId: string) {
  return { now: clock.now, timezone: clock.timezone, correlationId } as const;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} 必须是非负整数`);
}

function assertPositiveHours(value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error('hours 必须是大于 0 的有限数字');
}

function assertLabel(value: string): string {
  const label = value.trim();
  if (label.length === 0) throw new Error('label 必须是非空字符串');
  return label;
}

async function currentDayPlan(
  transaction: ValidatedAtomicWriteTransaction,
  dayPlanId: string,
): Promise<DayPlan> {
  const dayPlan = await transaction.get<DayPlan>(STORE.dayPlans, dayPlanId);
  if (!dayPlan) throw new Error('当前 appDate DayPlan 不存在');
  return dayPlan;
}

function recalculate(
  dayPlan: DayPlan,
  changes: Partial<
    Pick<DayPlan['estimate'], 'workWindowMin' | 'fixedDeductions' | 'lifeDeductions'>
  >,
): DayPlan['estimate'] {
  return calculateDayPlanEstimate({
    workWindowMin: changes.workWindowMin ?? dayPlan.estimate.workWindowMin,
    fixedDeductions: changes.fixedDeductions ?? dayPlan.estimate.fixedDeductions,
    lifeDeductions: changes.lifeDeductions ?? dayPlan.estimate.lifeDeductions,
    settingsSnapshot: dayPlan.settingsSnapshot,
  });
}

function listFor(dayPlan: DayPlan, type: DeductionType): Deduction[] {
  return type === 'fixed'
    ? dayPlan.estimate.fixedDeductions
    : dayPlan.estimate.lifeDeductions;
}

function estimateChange(type: DeductionType, deductions: Deduction[]) {
  return type === 'fixed'
    ? { fixedDeductions: deductions }
    : { lifeDeductions: deductions };
}

export async function updateDayPlanWorkWindow(
  input: InitializationClock & { workWindowMin: number },
): Promise<TaskCommandResult<DayPlan>> {
  assertNonNegativeInteger(input.workWindowMin, 'workWindowMin');
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'DayPlan',
        entityId: initialized.dayPlan.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      if (dayPlan.estimate.workWindowMin === input.workWindowMin) {
        throw new Error('新 workWindowMin 必须与旧值不同');
      }
      const updated: DayPlan = {
        ...dayPlan,
        estimate: recalculate(dayPlan, { workWindowMin: input.workWindowMin }),
        updatedAt: input.now,
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.updated',
          dayPlanId: dayPlan.id,
          payload: {
            field: 'estimate.workWindowMin',
            oldValue: dayPlan.estimate.workWindowMin,
            newValue: input.workWindowMin,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function addDayPlanDeduction(
  input: InitializationClock & { deductionType: DeductionType; label: string; hours: number },
): Promise<TaskCommandResult<DayPlan>> {
  const label = assertLabel(input.label);
  assertPositiveHours(input.hours);
  const deduction: Deduction = { id: newId(), label, hours: input.hours };
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'DayPlan',
        entityId: initialized.dayPlan.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      const deductions = [...listFor(dayPlan, input.deductionType), deduction];
      const updated: DayPlan = {
        ...dayPlan,
        estimate: recalculate(dayPlan, estimateChange(input.deductionType, deductions)),
        updatedAt: input.now,
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.deductionAdded',
          dayPlanId: dayPlan.id,
          payload: {
            deductionType: input.deductionType,
            deductionId: deduction.id,
            label: deduction.label,
            hours: deduction.hours,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function updateDayPlanDeduction(
  input: InitializationClock & {
    deductionType: DeductionType;
    deductionId: string;
    hours: number;
  },
): Promise<TaskCommandResult<DayPlan>> {
  assertPositiveHours(input.hours);
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'DayPlan',
        entityId: initialized.dayPlan.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      const previous = listFor(dayPlan, input.deductionType);
      const index = previous.findIndex(({ id }) => id === input.deductionId);
      if (index < 0) throw new Error('deductionId 不存在');
      const deduction = previous[index]!;
      if (deduction.hours === input.hours) throw new Error('新 hours 必须与旧值不同');
      const deductions = previous.map((item) =>
        item.id === deduction.id ? { ...item, hours: input.hours } : item,
      );
      const updated: DayPlan = {
        ...dayPlan,
        estimate: recalculate(dayPlan, estimateChange(input.deductionType, deductions)),
        updatedAt: input.now,
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.deductionUpdated',
          dayPlanId: dayPlan.id,
          payload: {
            deductionType: input.deductionType,
            deductionId: deduction.id,
            label: deduction.label,
            oldHours: deduction.hours,
            newHours: input.hours,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function removeDayPlanDeduction(
  input: InitializationClock & { deductionType: DeductionType; deductionId: string },
): Promise<TaskCommandResult<DayPlan>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'DayPlan',
        entityId: initialized.dayPlan.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      const previous = listFor(dayPlan, input.deductionType);
      const deduction = previous.find(({ id }) => id === input.deductionId);
      if (!deduction) throw new Error('deductionId 不存在');
      const deductions = previous.filter(({ id }) => id !== deduction.id);
      const updated: DayPlan = {
        ...dayPlan,
        estimate: recalculate(dayPlan, estimateChange(input.deductionType, deductions)),
        updatedAt: input.now,
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.deductionRemoved',
          dayPlanId: dayPlan.id,
          payload: {
            deductionType: input.deductionType,
            deductionId: deduction.id,
            label: deduction.label,
            hours: deduction.hours,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/** 用户请求展示一次当前预算估算；budgetPomodoros 在接受前保持不变。 */
export async function estimateDayPlanBudget(
  input: InitializationClock,
): Promise<TaskCommandResult<DayPlan>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'DayPlan',
        entityId: initialized.dayPlan.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      const updated: DayPlan = {
        ...dayPlan,
        estimate: recalculate(dayPlan, {}),
        updatedAt: input.now,
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.budgetEstimated',
          dayPlanId: dayPlan.id,
          payload: {
            budgetMode: updated.budgetMode,
            conservativePomodoros: updated.estimate.conservativePomodoros,
            optimisticPomodoros: updated.estimate.optimisticPomodoros,
            workWindowMin: updated.estimate.workWindowMin,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

export async function acceptDayPlanBudget(
  input: InitializationClock & { budgetMode: BudgetMode; budgetPomodoros: number },
): Promise<TaskCommandResult<DayPlan>> {
  assertNonNegativeInteger(input.budgetPomodoros, 'budgetPomodoros');
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.dayPlans, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'DayPlan',
        entityId: initialized.dayPlan.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const dayPlan = await currentDayPlan(transaction, initialized.dayPlan.id);
      const updated: DayPlan = {
        ...dayPlan,
        budgetMode: input.budgetMode,
        budgetPomodoros: input.budgetPomodoros,
        updatedAt: input.now,
      };
      await transaction.put(STORE.dayPlans, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'dayPlan.budgetAccepted',
          dayPlanId: dayPlan.id,
          payload: {
            budgetPomodoros: updated.budgetPomodoros,
            budgetMode: updated.budgetMode,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}
