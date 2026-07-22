/**
 * DayPlan 实体 schema 与默认值工厂（S5b，v4 §3.2 + §2.5）。
 *
 * DayPlan 表示某产品日的执行计划（今日任务有序列表、番茄预算、时段估算）。
 * 业务唯一键是 `appDate`（产品日），由创建时 `timezone` + `appDayStartOffsetMinutes` 派生（§2.5 规则 5/6）；
 * `localDate` 是创建当天事实自然日辅助字段；二者均**不随 offset 修改而重写**。
 *
 * 边界（与 S5a 一致）：本工厂只 **shape**（套默认值 + 派生 localDate/appDate），
 * **不做字段一致性校验**（appDate 唯一、taskIds 去重、freeMin 公式、conservative/optimistic 公式留 S6）、
 * **不落库 / 不发 Event**（留 S8）。
 */

import {
  makeLocalDateFields,
  makeSyncableBase,
  type IsoDateTime,
  type LocalDateFields,
  type SyncableBaseFields,
} from './common';
import { deriveAppDate, type IsoDate } from '../time';

/** 预算估算模式（§3.2 budgetMode 枚举）。 */
export type BudgetMode = 'conservative' | 'optimistic' | 'manual';

/**
 * 扣除项（§3.2，`fixedDeductions` / `lifeDeductions` 共用元素结构）。
 * `id` 为 UUID v7（用于 §7.3 dayPlan.deduction* 稳定定位）；本工厂默认不生成扣除项（空数组）。
 */
export interface Deduction {
  id: string;
  label: string;
  hours: number;
}

/** 当天时段与番茄数估算（§3.2 estimate 对象结构）；freeMin/conservative/optimistic 为落库派生值。 */
export interface DayPlanEstimate {
  workWindowMin: number;
  fixedDeductions: Deduction[];
  lifeDeductions: Deduction[];
  freeMin: number;
  conservativePomodoros: number;
  optimisticPomodoros: number;
}

/** 建立当天 DayPlan 时的计时设置快照（§3.2 settingsSnapshot；仅这四个字段，不含 baseline/restSuggestions 等）。 */
export interface SettingsSnapshot {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
}

/** DayPlan 完整实体（§3.2）。同步预留字段见 `SyncableBaseFields`，时区/自然日见 `LocalDateFields`。 */
export interface DayPlan extends SyncableBaseFields, LocalDateFields {
  /** 业务唯一键：所属产品日（§2.5、§3.2）。 */
  appDate: IsoDate;
  taskIds: string[];
  budgetPomodoros: number;
  budgetMode: BudgetMode;
  estimate: DayPlanEstimate;
  settingsSnapshot: SettingsSnapshot;
}

/** v4 默认计时设置快照（§3.7 默认值 25/5/15/4，§3.2 settingsSnapshot）。 */
const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

/** 默认空估算（§3.2 estimate 默认）。每次构造新对象，避免共享引用。 */
function defaultEstimate(): DayPlanEstimate {
  return {
    workWindowMin: 0,
    fixedDeductions: [],
    lifeDeductions: [],
    freeMin: 0,
    conservativePomodoros: 0,
    optimisticPomodoros: 0,
  };
}

/** `makeDayPlan` 入参。`now` / `timezone` / `appDayStartOffsetMinutes` 必填；其余按 v4 默认值。 */
export interface MakeDayPlanInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 创建时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now，且作 localDate/appDate 派生的业务时间。 */
  now: IsoDateTime;
  /** 写入时设备 IANA 时区（如 'Asia/Shanghai'）。 */
  timezone: string;
  /** 产品日起始偏移分钟（Phase 1 = 0，由调用方注入 Settings 值，见 §3.7）。 */
  appDayStartOffsetMinutes: number;
  taskIds?: string[];
  budgetPomodoros?: number;
  budgetMode?: BudgetMode;
  estimate?: DayPlanEstimate;
  /** 默认 v4 计时默认快照；真实创建时由 S11 注入当前 Settings 快照。 */
  settingsSnapshot?: SettingsSnapshot;
  /** 软删除时间戳覆盖（§2.4）；默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/**
 * 构造一条带默认值的 DayPlan（不校验、不落库）。
 * `appDate` / `localDate` 在创建时按 `now` + `timezone` + `offset` 派生（§2.5 规则 5/6）；
 * Phase 1 仅为当前产品日创建，故不开放 `appDate` 覆盖。
 */
export function makeDayPlan(input: MakeDayPlanInput): DayPlan {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  const { timezone, localDate } = makeLocalDateFields(input.now, input.timezone);
  return {
    ...base,
    timezone,
    localDate,
    appDate: deriveAppDate(input.now, input.timezone, input.appDayStartOffsetMinutes),
    taskIds: input.taskIds ?? [],
    budgetPomodoros: input.budgetPomodoros ?? 0,
    budgetMode: input.budgetMode ?? 'conservative',
    estimate: input.estimate ?? defaultEstimate(),
    settingsSnapshot: input.settingsSnapshot ?? { ...DEFAULT_SETTINGS_SNAPSHOT },
  };
}
