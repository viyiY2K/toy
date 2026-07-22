/**
 * Settings 实体 schema 与默认值工厂（S5d，v4 §3.7 + §2.3）。
 *
 * Settings 是**单条当前生效记录**（同一时间最多一条 deletedAt=null）；修改历史靠 Event 记录，不靠多版本。
 * 注意：Settings **不带** timezone/localDate（§3.7 字段表无此两行），故只 & `SyncableBaseFields`。
 *
 * 内置种子（短休 15 + 长休 13 = 28 项 restSuggestions、planningPreparation 模板）定义在 `./builtins`；
 * 首启默认 Settings 含两套内置种子（§3.7 关键规则 2）——本工厂默认即写入其**深拷贝**，S11 初始化只消费不重定义。
 *
 * 边界（与 S5a/S5b/S5c 一致）：本工厂只 **shape**（套默认值 + 内置种子深拷贝），
 * **不做字段一致性校验**（focusMinutes 5–120、longBreakMinutes∈{15,20,30}、longBreakEvery=4、单例、
 * key 唯一、appliesTo 与前缀一致、offset 0–1439 等一律留 S6）、**不落库 / 不发 Event**（留 S8）。
 */

import { makeSyncableBase, type IsoDateTime, type SyncableBaseFields } from './common';
import { BUILTIN_DAILY_TASK_TEMPLATES, BUILTIN_REST_SUGGESTIONS } from './builtins';

/** 休息建议项适用的休息类型（§3.7 restSuggestions.appliesTo 元素）。 */
export type RestSuggestionAppliesTo = 'shortBreak' | 'longBreak';

/** 休息建议项（§3.7 restSuggestions 数组元素结构）。 */
export interface RestSuggestion {
  key: string;
  label: string;
  appliesTo: RestSuggestionAppliesTo[];
  isBuiltIn: boolean;
  isEnabled: boolean;
  sortIndex: number;
  icon: string | null;
}

/** 每日任务模板（§3.7 dailyTaskTemplates 数组元素结构）。 */
export interface DailyTaskTemplate {
  templateKey: string;
  title: string;
  estimatedPomodoros: number;
  autoAddToDayPlan: boolean;
  sortPosition: 'first' | 'last';
  sortIndex: number;
  isBuiltIn: boolean;
}

/**
 * 休息建议项的只读视图（含只读 `appliesTo`）。
 * 用于内置种子 public 导出与 clone 入参，防止外部原地改写 canonical 常量。
 */
export type ReadonlyRestSuggestion = Readonly<Omit<RestSuggestion, 'appliesTo'>> & {
  readonly appliesTo: readonly RestSuggestionAppliesTo[];
};

/** 每日任务模板的只读视图（无嵌套数组，`Readonly` 即够）。 */
export type ReadonlyDailyTaskTemplate = Readonly<DailyTaskTemplate>;

/** 休息建议项展示排序策略（§3.7 restSuggestionDisplayMode 枚举）。 */
export type RestSuggestionDisplayMode = 'customOrder' | 'usageFrequency';

/** Settings 完整实体（§3.7）。同步预留字段见 `SyncableBaseFields`（§2.3）。 */
export interface Settings extends SyncableBaseFields {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  restSuggestions: RestSuggestion[];
  dailyTaskTemplates: DailyTaskTemplate[];
  lifetimePomodoroBaseline: number;
  restSuggestionDisplayMode: RestSuggestionDisplayMode;
  appDayStartOffsetMinutes: number;
}

/** 深拷贝内置 restSuggestions（含 appliesTo 数组），从只读 canonical 产出独立可变副本。 */
function cloneRestSuggestions(items: readonly ReadonlyRestSuggestion[]): RestSuggestion[] {
  return items.map((item) => ({ ...item, appliesTo: [...item.appliesTo] }));
}

/** 深拷贝内置 dailyTaskTemplates，从只读 canonical 产出独立可变副本。 */
function cloneDailyTaskTemplates(items: readonly ReadonlyDailyTaskTemplate[]): DailyTaskTemplate[] {
  return items.map((item) => ({ ...item }));
}

/** `makeSettings` 入参。`now` 必填；其余按 v4 默认值（含两套内置种子）。 */
export interface MakeSettingsInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now。 */
  now: IsoDateTime;
  focusMinutes?: number;
  shortBreakMinutes?: number;
  longBreakMinutes?: number;
  /** Phase 1 固定 4（校验留 S6）。 */
  longBreakEvery?: number;
  /** 默认内置 28 项深拷贝（§3.7 关键规则 2）。 */
  restSuggestions?: RestSuggestion[];
  /** 默认内置 1 项（planningPreparation）深拷贝（§3.7 关键规则 2）。 */
  dailyTaskTemplates?: DailyTaskTemplate[];
  lifetimePomodoroBaseline?: number;
  restSuggestionDisplayMode?: RestSuggestionDisplayMode;
  /** Phase 1 固定 0（UI 不开放，校验留 S6）。 */
  appDayStartOffsetMinutes?: number;
  /** 软删除时间戳覆盖（§2.4，仅数据修复/重置/迁移）；默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/**
 * 构造一条带默认值的 Settings（不校验、不落库）。
 * 默认即写入两套内置种子的深拷贝（§3.7 关键规则 2）；S11 首启初始化复用本工厂并写 settings.initialized。
 */
export function makeSettings(input: MakeSettingsInput): Settings {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  return {
    ...base,
    focusMinutes: input.focusMinutes ?? 25,
    shortBreakMinutes: input.shortBreakMinutes ?? 5,
    longBreakMinutes: input.longBreakMinutes ?? 15,
    longBreakEvery: input.longBreakEvery ?? 4,
    restSuggestions: input.restSuggestions ?? cloneRestSuggestions(BUILTIN_REST_SUGGESTIONS),
    dailyTaskTemplates:
      input.dailyTaskTemplates ?? cloneDailyTaskTemplates(BUILTIN_DAILY_TASK_TEMPLATES),
    lifetimePomodoroBaseline: input.lifetimePomodoroBaseline ?? 0,
    restSuggestionDisplayMode: input.restSuggestionDisplayMode ?? 'customOrder',
    appDayStartOffsetMinutes: input.appDayStartOffsetMinutes ?? 0,
  };
}
