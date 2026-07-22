import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { makeDayPlan } from './dayPlan';

const NOW = '2026-06-05T14:00:00+08:00';
const TZ = 'Asia/Shanghai';

const ALL_DAYPLAN_KEYS = [
  // 同步预留基字段（§2.3）
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
  // 时区 / 自然日（§2.5）
  'timezone',
  'localDate',
  // DayPlan 专属（§3.2）
  'appDate',
  'taskIds',
  'budgetPomodoros',
  'budgetMode',
  'estimate',
  'settingsSnapshot',
].sort();

describe('makeDayPlan (S5b, §3.2 + §2.5)', () => {
  it('产出含 DayPlan 全部字段键（含同步预留 + 时区/自然日 + appDate）', () => {
    const d = makeDayPlan({ now: NOW, timezone: TZ, appDayStartOffsetMinutes: 0 });
    expect(Object.keys(d).sort()).toEqual(ALL_DAYPLAN_KEYS);
  });

  it('默认值逐项对齐 v4', () => {
    const d = makeDayPlan({ now: NOW, timezone: TZ, appDayStartOffsetMinutes: 0 });
    expect(d.taskIds).toEqual([]);
    expect(d.budgetPomodoros).toBe(0);
    expect(d.budgetMode).toBe('conservative');
    expect(d.estimate).toEqual({
      workWindowMin: 0,
      fixedDeductions: [],
      lifeDeductions: [],
      freeMin: 0,
      conservativePomodoros: 0,
      optimisticPomodoros: 0,
    });
    expect(d.settingsSnapshot).toEqual({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
    });
    // 同步预留（§2.3）
    expect(d.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(d.deletedAt).toBeNull();
    expect(d.deviceId).toBeNull();
    expect(d.syncedAt).toBeNull();
    expect(d.createdAt).toBe(NOW);
    expect(d.updatedAt).toBe(NOW);
  });

  it('localDate 由 now + timezone 派生；offset=0 时 appDate == localDate', () => {
    const d = makeDayPlan({ now: NOW, timezone: TZ, appDayStartOffsetMinutes: 0 });
    expect(d.timezone).toBe(TZ);
    expect(d.localDate).toBe('2026-06-05');
    expect(d.appDate).toBe('2026-06-05');
    expect(d.appDate).toBe(d.localDate);
  });

  it('offset=240 凌晨样例：appDate 归前一日，localDate 不变（§2.5 规则 6）', () => {
    // 本地 02:00 < 产品日起点 04:00 → 归属前一个产品日
    const d = makeDayPlan({
      now: '2026-06-05T02:00:00+08:00',
      timezone: TZ,
      appDayStartOffsetMinutes: 240,
    });
    expect(d.localDate).toBe('2026-06-05');
    expect(d.appDate).toBe('2026-06-04');
  });

  it('覆盖入口生效：settingsSnapshot', () => {
    const snapshot = {
      focusMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 30,
      longBreakEvery: 4,
    };
    const d = makeDayPlan({
      now: NOW,
      timezone: TZ,
      appDayStartOffsetMinutes: 0,
      settingsSnapshot: snapshot,
    });
    expect(d.settingsSnapshot).toEqual(snapshot);
  });
});
