/**
 * IndexedDB 结构升级时的就地数据迁移（合并番茄钟功能批次）。
 *
 * 只在 `onupgradeneeded` 的 versionchange 事务里调用，全部用游标同步排队请求，
 * 不 await——versionchange 事务在没有待处理请求时会自动提交，穿插 await 有提前
 * 提交的风险。任何一步失败都会 abort 事务，`indexedDB.open()` 随之 reject，
 * 迁移整体回滚，不会留下改了一半的库。
 *
 * v1 → v2（`CURRENT_SCHEMA_VERSION` 1 → 2，v4.1 §3.1 / §3.3 / §3.8）：
 * - Session：`taskId` 标量改 `taskIds` 数组（null → `[]`，有值 → `[taskId]`），补 `mergeGroupId: null`；
 * - Task：补 `mergeGroupId: null`；
 * - 全部可同步实体：`schemaVersion` 改写为 2——写入校验要求 `schemaVersion === CURRENT_SCHEMA_VERSION`
 *   （见 `validation/primitives.ts`），不改写的话升级后第一次更新旧记录就会被校验拒绝；
 * - **Event 一律不动**：append-only 不可变历史，写入后不允许修改任何字段（§3.4 关键规则 1/2、红线 7/8）。
 *   旧 Event 保持写入当时的结构版本，且没有 `mergeGroupId` 字段，读侧按缺失即 null 处理。
 */

import { EVENT_STORE, STORE, SYNCABLE_STORE_NAMES } from './stores';

/** 本模块负责的目标结构版本；与 `CURRENT_SCHEMA_VERSION` 同步 bump。 */
const TARGET_SCHEMA_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把一条旧记录就地改成 v2 形状。返回 `undefined` 表示无需改写（幂等：重复迁移不产生变化）。
 * 纯函数，方便单测直接覆盖形状转换本身。
 */
export function migrateRecordToVersion2(
  store: string,
  record: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(record)) return undefined;
  const next = { ...record };
  let changed = false;

  if (store === STORE.sessions && !Array.isArray(next.taskIds)) {
    // §3.3：focus 关联任务由标量改数组；break 类原本就是 null，迁移后为空数组。
    const legacyTaskId = next.taskId;
    next.taskIds = typeof legacyTaskId === 'string' ? [legacyTaskId] : [];
    delete next.taskId;
    changed = true;
  }
  if ((store === STORE.sessions || store === STORE.tasks) && !('mergeGroupId' in next)) {
    next.mergeGroupId = null;
    changed = true;
  }
  if (next.schemaVersion !== TARGET_SCHEMA_VERSION) {
    // 只动 schemaVersion，不碰 updatedAt——迁移不是一次业务修改，不应伪造用户操作时间。
    next.schemaVersion = TARGET_SCHEMA_VERSION;
    changed = true;
  }

  return changed ? next : undefined;
}

function rewriteStore(transaction: IDBTransaction, store: string): void {
  const request = transaction.objectStore(store).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const migrated = migrateRecordToVersion2(store, cursor.value);
    if (migrated !== undefined) cursor.update(migrated);
    cursor.continue();
  };
}

/**
 * 执行 v1 → v2 迁移。调用方保证只在 `oldVersion` 落在 [1, 2) 时触发；
 * 全新库（oldVersion === 0）没有历史记录，不需要迁移。
 */
export function migrateToVersion2(transaction: IDBTransaction): void {
  for (const store of SYNCABLE_STORE_NAMES) {
    if ((store as string) === EVENT_STORE) continue; // 纵深防御：Event 永远不参与就地改写。
    rewriteStore(transaction, store);
  }
}
