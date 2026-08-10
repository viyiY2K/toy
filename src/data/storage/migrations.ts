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
 *
 * v2 → v3（`CURRENT_SCHEMA_VERSION` 2 → 3，v4.3 §3.3 / §3.8）：
 * - Session：补 `taskSegments: []`。历史合并 Session 没有分段事实可还原（当时既没有逐个
 *   勾选成员的入口，也没记过成员完成时刻），一律留空数组，**不伪造分段**——空分段在
 *   统计侧表现为"该成员在这条历史 Session 上投入 0"，比编一个平均分摊的假数据诚实；
 * - MergeGroup：补 `title`（系统默认名）与 `completedAt: null`；
 * - 同样改写全部可同步实体的 `schemaVersion`，理由同 v1 → v2。
 */

import { DEFAULT_MERGE_GROUP_TITLE } from '../schema/mergeGroup';
import { EVENT_STORE, STORE, SYNCABLE_STORE_NAMES } from './stores';

/** v1 → v2 的目标结构版本。 */
const VERSION_2 = 2;

/** 本模块负责的最新目标结构版本；与 `CURRENT_SCHEMA_VERSION` 同步 bump。 */
const TARGET_SCHEMA_VERSION = 3;

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
  if (next.schemaVersion !== VERSION_2) {
    // 只动 schemaVersion，不碰 updatedAt——迁移不是一次业务修改，不应伪造用户操作时间。
    next.schemaVersion = VERSION_2;
    changed = true;
  }

  return changed ? next : undefined;
}

/**
 * 把一条 v2 记录就地改成 v3 形状（v4.3 §3.3 / §3.8）。返回 `undefined` 表示无需改写。
 *
 * `taskSegments` 一律补空数组：历史合并 Session 没有可还原的分段事实——当时既没有
 * "进行中逐个勾选成员完成"的入口，也从未记录过成员的完成时刻，因此**不伪造分段**。
 * 空分段在统计侧表现为各成员在这条历史 Session 上投入 0，比编一份平均分摊的假数据诚实。
 */
export function migrateRecordToVersion3(
  store: string,
  record: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(record)) return undefined;
  const next = { ...record };
  let changed = false;

  if (store === STORE.sessions && !Array.isArray(next.taskSegments)) {
    next.taskSegments = [];
    changed = true;
  }
  if (store === STORE.mergeGroups) {
    if (typeof next.title !== 'string' || next.title.trim() === '') {
      next.title = DEFAULT_MERGE_GROUP_TITLE;
      changed = true;
    }
    if (!('completedAt' in next)) {
      next.completedAt = null;
      changed = true;
    }
  }
  if (next.schemaVersion !== TARGET_SCHEMA_VERSION) {
    next.schemaVersion = TARGET_SCHEMA_VERSION;
    changed = true;
  }

  return changed ? next : undefined;
}

/**
 * 把一条记录按 `oldVersion` 依次跑完需要的迁移步骤。
 *
 * **必须逐条串成链，不能每个版本各开一趟游标**：同一个 versionchange 事务里对同一个
 * store 开两个游标，两边读到的都是**改写前**的原始记录，后写的那趟会把前一趟的结果
 * 整个覆盖掉（v1 → v3 时表现为 `schemaVersion` 变成 3、但 v2 补的 `mergeGroupId`
 * 不翼而飞）。一条记录只被读一次、只被 update 一次，才是安全的。
 */
export function migrateRecord(
  store: string,
  record: unknown,
  oldVersion: number,
): Record<string, unknown> | undefined {
  let current = record;
  let changed = false;
  for (const [introducedIn, migrate] of [
    [2, migrateRecordToVersion2],
    [3, migrateRecordToVersion3],
  ] as const) {
    if (oldVersion >= introducedIn) continue;
    const next = migrate(store, current);
    if (next !== undefined) {
      current = next;
      changed = true;
    }
  }
  return changed ? (current as Record<string, unknown>) : undefined;
}

/**
 * 执行就地迁移。调用方传入 `oldVersion`，本函数自己决定要跑哪几步。
 * 全新库（`oldVersion === 0`）没有历史记录，调用方直接跳过即可。
 */
export function migrateRecords(transaction: IDBTransaction, oldVersion: number): void {
  for (const store of SYNCABLE_STORE_NAMES) {
    if ((store as string) === EVENT_STORE) continue; // 纵深防御：Event 永远不参与就地改写。
    const request = transaction.objectStore(store).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const migrated = migrateRecord(store, cursor.value, oldVersion);
      if (migrated !== undefined) cursor.update(migrated);
      cursor.continue();
    };
  }
}
