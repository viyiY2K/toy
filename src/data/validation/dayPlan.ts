import type { DayPlan } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  requireRecord,
  validateExactKeys,
  validateFiniteNumber,
  validateInteger,
  validateIsoDate,
  validateStoredLocalDate,
  validateSyncableBase,
  validateUuidV7,
  type ValidationIssue,
} from './primitives';

const DAY_PLAN_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'timezone',
  'localDate',
  'appDate',
  'taskIds',
  'budgetPomodoros',
  'budgetMode',
  'estimate',
  'settingsSnapshot',
] as const;

function validateDeductionArray(
  value: unknown,
  path: string,
  collector: ValidationCollector,
): number {
  if (!Array.isArray(value)) {
    collector.add('type.array', path, '必须为数组');
    return 0;
  }
  let totalMinutes = 0;
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const deduction = requireRecord(item, itemPath, collector);
    if (!deduction) return;
    validateExactKeys(deduction, ['id', 'label', 'hours'], itemPath, collector);
    if (validateUuidV7(deduction.id, `${itemPath}.id`, collector) && typeof deduction.id === 'string') {
      collector.check(!ids.has(deduction.id), 'dayPlan.deduction.duplicateId', `${itemPath}.id`, '扣除项 id 不得重复');
      ids.add(deduction.id);
    }
    collector.check(
      typeof deduction.label === 'string' && deduction.label.trim().length > 0,
      'dayPlan.deduction.label',
      `${itemPath}.label`,
      '必须为非空字符串',
    );
    if (validateFiniteNumber(deduction.hours, `${itemPath}.hours`, collector, 0)) {
      totalMinutes += deduction.hours * 60;
    }
  });
  return totalMinutes;
}

function validateEstimate(value: unknown, collector: ValidationCollector): void {
  const estimate = requireRecord(value, 'estimate', collector);
  if (!estimate) return;
  validateExactKeys(
    estimate,
    [
      'workWindowMin',
      'fixedDeductions',
      'lifeDeductions',
      'freeMin',
      'conservativePomodoros',
      'optimisticPomodoros',
    ],
    'estimate',
    collector,
  );
  const validWindow = validateInteger(estimate.workWindowMin, 'estimate.workWindowMin', collector, 0);
  const fixedMinutes = validateDeductionArray(estimate.fixedDeductions, 'estimate.fixedDeductions', collector);
  const lifeMinutes = validateDeductionArray(estimate.lifeDeductions, 'estimate.lifeDeductions', collector);
  const validFree = validateInteger(estimate.freeMin, 'estimate.freeMin', collector, 0);
  validateInteger(estimate.conservativePomodoros, 'estimate.conservativePomodoros', collector, 0);
  validateInteger(estimate.optimisticPomodoros, 'estimate.optimisticPomodoros', collector, 0);
  if (validWindow && validFree && typeof estimate.workWindowMin === 'number') {
    const expected = Math.max(0, Math.round(estimate.workWindowMin - fixedMinutes - lifeMinutes));
    collector.check(estimate.freeMin === expected, 'dayPlan.estimate.freeMin', 'estimate.freeMin', `必须等于 ${expected}`);
  }
}

function validateSettingsSnapshot(value: unknown, collector: ValidationCollector): void {
  const snapshot = requireRecord(value, 'settingsSnapshot', collector);
  if (!snapshot) return;
  validateExactKeys(
    snapshot,
    ['focusMinutes', 'shortBreakMinutes', 'longBreakMinutes', 'longBreakEvery'],
    'settingsSnapshot',
    collector,
  );
  validateInteger(snapshot.focusMinutes, 'settingsSnapshot.focusMinutes', collector, 5, 120);
  validateInteger(snapshot.shortBreakMinutes, 'settingsSnapshot.shortBreakMinutes', collector, 1, 30);
  collector.check(
    snapshot.longBreakMinutes === 15 || snapshot.longBreakMinutes === 20 || snapshot.longBreakMinutes === 30,
    'settings.longBreakMinutes',
    'settingsSnapshot.longBreakMinutes',
    '只允许 15/20/30',
  );
  collector.check(snapshot.longBreakEvery === 4, 'settings.longBreakEvery', 'settingsSnapshot.longBreakEvery', 'Phase 1 必须为 4');
}

export async function collectDayPlanValidationIssues(
  value: unknown,
  context?: ValidationContext,
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const dayPlan = requireRecord(value, 'DayPlan', collector);
  if (!dayPlan) return collector.issues;
  validateExactKeys(dayPlan, DAY_PLAN_KEYS, 'DayPlan', collector);
  validateSyncableBase(dayPlan, collector);
  validateStoredLocalDate(dayPlan.localDate, dayPlan.createdAt, dayPlan.timezone, collector);
  validateIsoDate(dayPlan.appDate, 'appDate', collector);

  if (!Array.isArray(dayPlan.taskIds)) {
    collector.add('type.array', 'taskIds', '必须为数组');
  } else {
    const ids = new Set<string>();
    for (const [index, id] of dayPlan.taskIds.entries()) {
      if (validateUuidV7(id, `taskIds[${index}]`, collector) && typeof id === 'string') {
        collector.check(!ids.has(id), 'dayPlan.taskIds.duplicate', `taskIds[${index}]`, 'Task id 不得重复');
        ids.add(id);
        if (context?.getTask) {
          collector.check((await context.getTask(id)) !== undefined, 'dayPlan.task.missing', `taskIds[${index}]`, '引用的 Task 不存在');
        } else {
          collector.add('validation.context.required', `taskIds[${index}]`, '校验 Task 引用需要事务查询上下文');
        }
      }
    }
  }
  validateInteger(dayPlan.budgetPomodoros, 'budgetPomodoros', collector, 0);
  collector.check(
    dayPlan.budgetMode === 'conservative' || dayPlan.budgetMode === 'optimistic' || dayPlan.budgetMode === 'manual',
    'dayPlan.budgetMode',
    'budgetMode',
    '非法预算模式',
  );
  validateEstimate(dayPlan.estimate, collector);
  validateSettingsSnapshot(dayPlan.settingsSnapshot, collector);
  if (typeof dayPlan.id === 'string') {
    if (context?.getDayPlan) {
      const previous = await context.getDayPlan(dayPlan.id);
      if (previous) {
        collector.check(dayPlan.timezone === previous.timezone, 'dayPlan.timezone.immutable', 'timezone', '创建后不可修改');
        collector.check(dayPlan.localDate === previous.localDate, 'dayPlan.localDate.immutable', 'localDate', '创建后不可修改');
        collector.check(dayPlan.appDate === previous.appDate, 'dayPlan.appDate.immutable', 'appDate', '创建后不可修改');
      }
    } else {
      collector.add('validation.context.required', 'DayPlan.id', '校验创建事实不可变性需要事务查询上下文');
    }
  }
  if (dayPlan.deletedAt === null && typeof dayPlan.appDate === 'string' && typeof dayPlan.id === 'string') {
    if (context?.getActiveDayPlanByAppDate) {
      const existing = await context.getActiveDayPlanByAppDate(dayPlan.appDate);
      collector.check(
        existing === undefined || existing.id === dayPlan.id,
        'dayPlan.appDate.unique',
        'appDate',
        '同一 appDate 只能有一条有效 DayPlan',
      );
    } else {
      collector.add('validation.context.required', 'appDate', '校验有效 DayPlan 唯一性需要事务查询上下文');
    }
  }

  return collector.issues;
}

export async function validateDayPlan(
  value: unknown,
  context?: ValidationContext,
): Promise<DayPlan> {
  const issues = await collectDayPlanValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('DayPlan', issues);
  return value as DayPlan;
}
