import type { DayPlanEstimate, Deduction, SettingsSnapshot } from '../schema';

export interface CalculateDayPlanEstimateInput {
  workWindowMin: number;
  fixedDeductions: readonly Deduction[];
  lifeDeductions: readonly Deduction[];
  settingsSnapshot: SettingsSnapshot;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} 必须是非负整数`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
}

function deductionMinutes(deductions: readonly Deduction[], label: string): number {
  return deductions.reduce((total, deduction, index) => {
    if (!Number.isFinite(deduction.hours) || deduction.hours <= 0) {
      throw new Error(`${label}[${index}].hours 必须是大于 0 的有限数字`);
    }
    return total + deduction.hours * 60;
  }, 0);
}

/** v4 §3.2 的唯一 DayPlan 预算估算公式；只对最终 freeMin 做一次 round。 */
export function calculateDayPlanEstimate(
  input: CalculateDayPlanEstimateInput,
): DayPlanEstimate {
  assertNonNegativeInteger(input.workWindowMin, 'workWindowMin');
  const { focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery } =
    input.settingsSnapshot;
  assertPositiveInteger(focusMinutes, 'settingsSnapshot.focusMinutes');
  assertPositiveInteger(shortBreakMinutes, 'settingsSnapshot.shortBreakMinutes');
  assertPositiveInteger(longBreakMinutes, 'settingsSnapshot.longBreakMinutes');
  assertPositiveInteger(longBreakEvery, 'settingsSnapshot.longBreakEvery');

  const deductionsMin =
    deductionMinutes(input.fixedDeductions, 'fixedDeductions') +
    deductionMinutes(input.lifeDeductions, 'lifeDeductions');
  const freeMin = Math.max(0, Math.round(input.workWindowMin - deductionsMin));
  const singlePomodoroMin = focusMinutes + shortBreakMinutes;
  const pomodoroGroupMin =
    longBreakEvery * focusMinutes +
    (longBreakEvery - 1) * shortBreakMinutes +
    longBreakMinutes;
  const completeGroups = Math.floor(freeMin / pomodoroGroupMin);
  const remainingGroupMin = freeMin - completeGroups * pomodoroGroupMin;

  return {
    workWindowMin: input.workWindowMin,
    fixedDeductions: input.fixedDeductions.map((deduction) => ({ ...deduction })),
    lifeDeductions: input.lifeDeductions.map((deduction) => ({ ...deduction })),
    freeMin,
    conservativePomodoros:
      completeGroups * longBreakEvery + Math.floor(remainingGroupMin / singlePomodoroMin),
    optimisticPomodoros: Math.floor(freeMin / singlePomodoroMin),
  };
}
