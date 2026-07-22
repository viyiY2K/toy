/**
 * IndexedDB 物理存储元信息（单一来源）。
 *
 * v4 §1.1 明确"不规定 objectStore 名称/事务写法"，故 store 命名、DB 名/版本属实现方决策（D1，稳定最小）。
 * 下方 7 个 store 与 v4 §3 的 7 个实体一一对应（§3.1–§3.7）。
 *
 * 主键：全部以 `id` 为 keyPath（UUID v7，§2.2）。
 * S1 边界：只建主键，不建二级索引；二级索引（如 events.occurredAt / dayPlans.appDate / tasks.status）
 * 留到需要它们的步骤（S5/S10）届时 bump DB 版本 + onupgradeneeded 增量添加。
 */
export const DB_NAME = 'pomodoro';
export const DB_VERSION = 1;

/** 全部 store 共用的主键 keyPath（UUID v7）。 */
export const PRIMARY_KEY = 'id';

/** 7 个实体的 objectStore 名（值即 IndexedDB store 名）。 */
export const STORE = {
  tasks: 'tasks',
  dayPlans: 'dayPlans',
  sessions: 'sessions',
  events: 'events',
  energyRecords: 'energyRecords',
  unresolvedIntervals: 'unresolvedIntervals',
  settings: 'settings',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/** 所有 store 名的数组（建库与遍历用）。 */
export const STORE_NAMES: readonly StoreName[] = Object.values(STORE);

/** Event 专属 store（append-only，v4 §3.4 关键规则 1/2）。 */
export const EVENT_STORE = STORE.events;

/**
 * 可同步实体 store 名（除 events 外的 6 个）。
 * 这些 store 允许覆盖写（创建/更新）；Event 不在此列，只能 append。
 */
export type SyncableStoreName = Exclude<StoreName, typeof STORE.events>;

/** 可同步实体 store 名数组（剔除 events）。 */
export const SYNCABLE_STORE_NAMES: readonly SyncableStoreName[] = STORE_NAMES.filter(
  (name): name is SyncableStoreName => name !== STORE.events,
);
