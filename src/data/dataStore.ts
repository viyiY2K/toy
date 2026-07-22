import type { StorageAdapter } from './storage/storageAdapter';
import { IndexedDbStorageAdapter } from './storage/indexedDbAdapter';
import { newId } from './id';
import type {
  DayPlan,
  EnergyRecord,
  Session,
  Settings,
  Task,
  TaskDeletedReason,
  UnresolvedInterval,
} from './schema';
import {
  EVENT_STORE,
  STORE,
  STORE_NAMES,
  SYNCABLE_STORE_NAMES,
  type StoreName,
  type SyncableStoreName,
} from './storage/stores';

/**
 * IndexedDB 数据层 facade（v4 §2.1）。S12 起，公共 `dataStore` 只暴露读取；
 * 业务 create/update/softDelete/appendEvent 必须走 `executeAtomicWrite`。
 *
 * 写入分两类：
 * - `put`：覆盖写（创建/更新），**仅限可同步实体 store**；Event 不可用。
 * - `appendEvent`：Event 专属 append-only 写入，底层 insert，**同 id 不可覆盖**
 *   （v4 §3.4 关键规则 1/2、红线 8：Event 写入后不可修改/软删/物删）。
 *
 * 读取（`get`/`getAll`）对全部 store 开放——Event 可读，只是不可改。
 * **不提供任何物理删除**（§2.4、红线 12）；删除走 S9 软删。
 * `internalDataStore` 仅供本数据层的 S8/S12 基础设施与直接存储测试使用，绝不从
 * `src/data/index.ts` 公共 barrel 导出。
 */
export interface DataStore {
  get<T>(store: StoreName, id: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  getIncludingDeleted<T>(store: SyncableStoreName, id: string): Promise<T | undefined>;
  getAllIncludingDeleted<T>(store: SyncableStoreName): Promise<T[]>;
}

/** @internal 未校验存储能力；上层业务不得直接取得。 */
export interface InternalDataStore extends DataStore {
  put<T>(store: SyncableStoreName, value: T): Promise<void>;
  appendEvent<T>(value: T): Promise<void>;
  runAtomic<T>(
    stores: readonly StoreName[],
    work: (transaction: AtomicDataTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AtomicEventRecord {
  correlationId: string | null;
}

export interface SyncableEntityMap {
  tasks: Task;
  dayPlans: DayPlan;
  sessions: Session;
  energyRecords: EnergyRecord;
  unresolvedIntervals: UnresolvedInterval;
  settings: Settings;
}

export interface TaskSoftDeleteOptions {
  deletedReason?: TaskDeletedReason | null;
}

/**
 * 一个业务写操作的事务视图。correlationId 在事务入口只生成一次；事务内追加的
 * 所有 Event 必须使用它，从而保证同一业务操作的事件可稳定关联（v4 §3.4）。
 */
export interface AtomicDataTransaction {
  readonly correlationId: string;
  get<T>(store: StoreName, id: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  getIncludingDeleted<T>(store: SyncableStoreName, id: string): Promise<T | undefined>;
  getAllIncludingDeleted<T>(store: SyncableStoreName): Promise<T[]>;
  put<T>(store: SyncableStoreName, value: T): Promise<void>;
  appendEvent<T extends AtomicEventRecord>(value: T): Promise<void>;
  softDelete<S extends SyncableStoreName>(
    store: S,
    id: string,
    deletedAt: string,
    ...options: S extends typeof STORE.tasks ? [options?: TaskSoftDeleteOptions] : []
  ): Promise<SyncableEntityMap[S]>;
}

const adapter: StorageAdapter = new IndexedDbStorageAdapter();
const syncableStores = new Set<StoreName>(SYNCABLE_STORE_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVisible(store: StoreName, value: unknown): boolean {
  // Event 没有 deletedAt 且永远可读；可同步实体只有 deletedAt === null 才是有效记录。
  return store === EVENT_STORE || (syncableStores.has(store) && isRecord(value) && value.deletedAt === null);
}

/** @internal S9/S12 共用的纯 tombstone 构造；调用方必须在 put 前完成 S6 校验。 */
export function buildSoftDeleteTombstone<S extends SyncableStoreName>(
  store: S,
  existing: SyncableEntityMap[S],
  deletedAt: string,
  ...options: S extends typeof STORE.tasks ? [options?: TaskSoftDeleteOptions] : []
): SyncableEntityMap[S] {
  if (!isRecord(existing)) {
    throw new Error(`无法软删除非法的 ${store} 记录`);
  }
  if (existing.deletedAt !== null) {
    throw new Error(`${store} 记录 ${String(existing.id)} 已经软删除`);
  }
  const tombstone =
    store === STORE.tasks
      ? {
          ...existing,
          updatedAt: deletedAt,
          deletedAt,
          status: 'deleted',
          outcome: null,
          completionSource: null,
          completedAt: null,
          archivedAt: null,
          deletedReason: (options[0] as TaskSoftDeleteOptions | undefined)?.deletedReason ?? null,
        }
      : { ...existing, updatedAt: deletedAt, deletedAt };
  return tombstone as SyncableEntityMap[S];
}

export const internalDataStore: InternalDataStore = {
  async get<T>(store: StoreName, id: string): Promise<T | undefined> {
    const value = await adapter.get<T>(store, id);
    return value !== undefined && isVisible(store, value) ? value : undefined;
  },
  async getAll<T>(store: StoreName): Promise<T[]> {
    const values = await adapter.getAll<T>(store);
    return values.filter((value) => isVisible(store, value));
  },
  getIncludingDeleted<T>(store: SyncableStoreName, id: string): Promise<T | undefined> {
    return adapter.get<T>(store, id);
  },
  getAllIncludingDeleted<T>(store: SyncableStoreName): Promise<T[]> {
    return adapter.getAll<T>(store);
  },
  async put<T>(store: SyncableStoreName, value: T): Promise<void> {
    // 运行时纵深防御：即便类型被绕过，也拒绝覆盖写 Event（append-only）。
    if ((store as StoreName) === EVENT_STORE) {
      throw new Error(
        'events 是 append-only，禁止 put 覆盖写入，请用 appendEvent()（v4 §3.4 关键规则 1/2、红线 8）',
      );
    }
    await adapter.put<T>(store, value);
  },
  appendEvent<T>(value: T): Promise<void> {
    // insert 语义：同 id 重复写入会失败，保证 Event 不可覆盖。
    return adapter.add<T>(EVENT_STORE, value);
  },
  async runAtomic<T>(
    stores: readonly StoreName[],
    work: (transaction: AtomicDataTransaction) => Promise<T>,
  ): Promise<T> {
    const uniqueStores = [...new Set(stores)];
    if (uniqueStores.length === 0) {
      throw new Error('runAtomic 至少需要声明一个 store');
    }

    const declaredStores = new Set<StoreName>(uniqueStores);
    const assertDeclared = (store: StoreName): void => {
      if (!declaredStores.has(store)) {
        throw new Error(`store ${store} 未在本次 runAtomic 中声明`);
      }
    };
    const correlationId = newId();

    return adapter.runAtomic<T>(uniqueStores, async (transaction) => {
      const atomicDataTransaction: AtomicDataTransaction = {
        correlationId,
        get<Value>(store: StoreName, id: string): Promise<Value | undefined> {
          assertDeclared(store);
          return transaction.get<Value>(store, id).then((value) =>
            value !== undefined && isVisible(store, value) ? value : undefined,
          );
        },
        async getAll<Value>(store: StoreName): Promise<Value[]> {
          assertDeclared(store);
          const values = await transaction.getAll<Value>(store);
          return values.filter((value) => isVisible(store, value));
        },
        getIncludingDeleted<Value>(
          store: SyncableStoreName,
          id: string,
        ): Promise<Value | undefined> {
          assertDeclared(store);
          return transaction.get<Value>(store, id);
        },
        getAllIncludingDeleted<Value>(store: SyncableStoreName): Promise<Value[]> {
          assertDeclared(store);
          return transaction.getAll<Value>(store);
        },
        async put<Value>(store: SyncableStoreName, value: Value): Promise<void> {
          assertDeclared(store);
          if ((store as StoreName) === EVENT_STORE) {
            throw new Error('events 是 append-only，禁止 put 覆盖写入');
          }
          await transaction.put(store, value);
        },
        async appendEvent<Value extends AtomicEventRecord>(value: Value): Promise<void> {
          assertDeclared(EVENT_STORE);
          if (value.correlationId !== correlationId) {
            throw new Error('事务内 Event 必须使用本次业务操作的 correlationId');
          }
          await transaction.add(EVENT_STORE, value);
        },
        async softDelete<S extends SyncableStoreName>(
          store: S,
          id: string,
          deletedAt: string,
          ...options: S extends typeof STORE.tasks ? [options?: TaskSoftDeleteOptions] : []
        ): Promise<SyncableEntityMap[S]> {
          assertDeclared(store);
          if ((store as StoreName) === EVENT_STORE) {
            throw new Error('Event 不允许软删除（v4 §2.4）');
          }

          const existing = await transaction.get<SyncableEntityMap[S]>(store, id);
          if (!existing || !isRecord(existing)) {
            throw new Error(`无法软删除不存在的 ${store} 记录 ${id}`);
          }
          const tombstone = buildSoftDeleteTombstone(store, existing, deletedAt, ...options);
          await transaction.put(store, tombstone);
          return tombstone as SyncableEntityMap[S];
        },
      };

      return work(atomicDataTransaction);
    });
  },
};

/** 公共只读 facade；运行时对象本身也不携带任何 raw 写方法。 */
export const dataStore: DataStore = {
  get<T>(store: StoreName, id: string): Promise<T | undefined> {
    return internalDataStore.get<T>(store, id);
  },
  getAll<T>(store: StoreName): Promise<T[]> {
    return internalDataStore.getAll<T>(store);
  },
  getIncludingDeleted<T>(store: SyncableStoreName, id: string): Promise<T | undefined> {
    return internalDataStore.getIncludingDeleted<T>(store, id);
  },
  getAllIncludingDeleted<T>(store: SyncableStoreName): Promise<T[]> {
    return internalDataStore.getAllIncludingDeleted<T>(store);
  },
};

export { EVENT_STORE, STORE, STORE_NAMES, SYNCABLE_STORE_NAMES };
export type { StoreName, SyncableStoreName };
