/**
 * 实体 schema 层 barrel（S5，已收尾）。
 *
 * S5a 共享基座（common）；S5b Task / DayPlan；S5c Session / Event / EnergyRecord /
 * UnresolvedInterval；S5d Settings + 内置种子。7 实体的类型与默认值工厂至此齐备。
 * 主数据层入口（`src/data/index.ts`）经 `export * from './schema'` 统一再导出（S5d 补全）。
 */
export type {
  IsoDateTime,
  SyncableBaseFields,
  EventBaseFields,
  LocalDateFields,
  SyncableBaseInput,
  EventBaseInput,
} from './common';
export { makeSyncableBase, makeEventBase, makeLocalDateFields } from './common';

// S5b: Task（§3.1）
export type {
  Task,
  TaskStatus,
  TaskOutcome,
  TaskCompletionSource,
  TaskDeletedReason,
  EstimateRound,
  TaskMetadata,
  MakeTaskInput,
} from './task';
export { makeTask } from './task';

// S5b: DayPlan（§3.2）
export type {
  DayPlan,
  BudgetMode,
  Deduction,
  DayPlanEstimate,
  SettingsSnapshot,
  MakeDayPlanInput,
} from './dayPlan';
export { makeDayPlan } from './dayPlan';

// S5c: Session（§3.3）
export type {
  Session,
  SessionType,
  SessionStatus,
  SkipKind,
  MakeSessionInput,
} from './session';
export { makeSession } from './session';

// S5c/S7a: Event（§3.4 append-only 顶层字段 + §7 静态判别契约）
export type { Event, MakeEventInput } from './event';
export { makeEvent } from './event';

// S5c: EnergyRecord（§3.5）
export type { EnergyRecord, EnergySource, MakeEnergyRecordInput } from './energyRecord';
export { makeEnergyRecord } from './energyRecord';

// S5c: UnresolvedInterval（§3.6）
export type {
  UnresolvedInterval,
  UnresolvedIntervalSource,
  UnresolvedIntervalStatus,
  MakeUnresolvedIntervalInput,
} from './unresolvedInterval';
export { makeUnresolvedInterval } from './unresolvedInterval';

// S5d: Settings（§3.7）
export type {
  Settings,
  RestSuggestion,
  RestSuggestionAppliesTo,
  DailyTaskTemplate,
  RestSuggestionDisplayMode,
  MakeSettingsInput,
} from './settings';
export { makeSettings } from './settings';

// S5d: 内置种子（§3.7 内置默认清单）
export { BUILTIN_REST_SUGGESTIONS, BUILTIN_DAILY_TASK_TEMPLATES } from './builtins';
