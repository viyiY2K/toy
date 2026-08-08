/**
 * 数据层公共入口（barrel）。
 *
 * 上层（含未来接入的 UI）只从本模块 import，不深入内部文件路径。
 * S0 仅导出已建立的最小能力；后续 S1+ 步骤逐步扩充导出面。
 */
export { newId } from './id';
export { dataStore, STORE, STORE_NAMES, SYNCABLE_STORE_NAMES, EVENT_STORE } from './dataStore';
export type {
  DataStore,
  SyncableEntityMap,
  StoreName,
  SyncableStoreName,
  TaskSoftDeleteOptions,
} from './dataStore';
export { getDeviceTimeZone, deriveLocalDate, deriveAppDate } from './time';
export type { IsoDate, Instant } from './time';
export {
  CURRENT_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  isLegacySchemaVersion,
} from './schemaVersion';

// S5: 全实体 schema 层（7 实体类型 + 默认值工厂 + 内置种子）。
// 上层只从本主入口 import；schema 层细节见 ./schema（S5a–S5d）。
export * from './schema';
export * from './events';
export * from './validation';
export * from './writes/executeAtomicWrite';
export * from './initialization/currentAppDate';
export * from './queries/currentTaskViews';
export * from './queries/currentTimerViews';
export * from './queries/currentRecoveryView';
export * from './queries/sessionStats';
export * from './queries/statsDashboard';
export * from './stats/awarenessStats';
export * from './stats/dateRange';
export * from './stats/sessionStats';
export * from './planning/dayPlanBudget';
export * from './commands/taskCommands';
export * from './commands/timerCommands';
export * from './commands/awarenessCommands';
export * from './commands/dayPlanCommands';
export * from './commands/intervalCommands';
export * from './commands/batchTaskCommands';
export * from './commands/settingsCommands';

// S7: 多端同步 UI 接入面（登录 + 触发同步 + 冲突解决）。
// 同步模块内部文件（src/data/sync/*）不直接对外，UI 只能从这里拿到这几个函数。
export { isSyncConfigured } from './sync/supabaseClient';
export { requestMagicLink, getAuthState, onAuthStateChange, signOut } from './sync/authFlow';
export type { AuthState, AuthStatus } from './sync/authFlow';
export {
  runSync,
  onSyncStateChange,
  getSyncState,
  resolveLifetimePomodoroBaselineConflict,
} from './sync/syncEngine';
export type { SyncRunResult, SyncState } from './sync/syncEngine';
