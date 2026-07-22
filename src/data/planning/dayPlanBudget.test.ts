import { describe, expect, it } from 'vitest';
import { newId } from '../id';
import { calculateDayPlanEstimate } from './dayPlanBudget';

const DEFAULT_SNAPSHOT = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

describe('S1a DayPlan budget formula', () => {
  it('uses the v4 complete-group and single-pomodoro formulas', () => {
    expect(
      calculateDayPlanEstimate({
        workWindowMin: 360,
        fixedDeductions: [],
        lifeDeductions: [],
        settingsSnapshot: DEFAULT_SNAPSHOT,
      }),
    ).toMatchObject({
      freeMin: 360,
      conservativePomodoros: 11,
      optimisticPomodoros: 12,
    });
  });

  it('sums fractional deduction minutes before one final round and floors negative free time', () => {
    const result = calculateDayPlanEstimate({
      workWindowMin: 60,
      fixedDeductions: [{ id: newId(), label: 'A', hours: 0.333 }],
      lifeDeductions: [{ id: newId(), label: 'B', hours: 0.333 }],
      settingsSnapshot: DEFAULT_SNAPSHOT,
    });
    expect(result.freeMin).toBe(20);

    expect(
      calculateDayPlanEstimate({
        workWindowMin: 30,
        fixedDeductions: [{ id: newId(), label: '超窗', hours: 1 }],
        lifeDeductions: [],
        settingsSnapshot: DEFAULT_SNAPSHOT,
      }).freeMin,
    ).toBe(0);
  });

  it('does not clamp the exact v4 formula to an invented conservative <= optimistic rule', () => {
    expect(
      calculateDayPlanEstimate({
        workWindowMin: 250,
        fixedDeductions: [],
        lifeDeductions: [],
        settingsSnapshot: {
          focusMinutes: 5,
          shortBreakMinutes: 30,
          longBreakMinutes: 15,
          longBreakEvery: 4,
        },
      }),
    ).toMatchObject({ conservativePomodoros: 8, optimisticPomodoros: 7 });
  });

  it('rejects invalid calculation inputs before they can become persisted facts', () => {
    expect(() =>
      calculateDayPlanEstimate({
        workWindowMin: -1,
        fixedDeductions: [],
        lifeDeductions: [],
        settingsSnapshot: DEFAULT_SNAPSHOT,
      }),
    ).toThrow(/非负整数/);
    expect(() =>
      calculateDayPlanEstimate({
        workWindowMin: 60,
        fixedDeductions: [{ id: newId(), label: '非法', hours: 0 }],
        lifeDeductions: [],
        settingsSnapshot: DEFAULT_SNAPSHOT,
      }),
    ).toThrow(/大于 0/);
  });
});
