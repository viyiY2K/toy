import { migrateRecords } from './migrations';
import type { AtomicStorageTransaction, StorageAdapter } from './storageAdapter';
import { DB_NAME, DB_VERSION, PRIMARY_KEY, STORE, STORE_NAMES, type StoreName } from './stores';

/**
 * 打开（必要时升级）IndexedDB 数据库，按 stores.ts 建齐 8 个 objectStore。
 * onupgradeneeded 内只创建尚不存在的 store，且只设主键 keyPath（S1 不建二级索引）；
 * 建完 store 后按 oldVersion 跑对应的就地数据迁移（见 `migrations.ts`）。
 * 全新库 oldVersion === 0，没有历史记录，直接跳过迁移。
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: PRIMARY_KEY });
        }
      }
      /*
       * 一趟游标跑完整条迁移链（见 migrations.ts `migrateRecord`）。
       * 按版本各开一趟会让后一趟覆盖前一趟的结果——同一事务里两个游标读到的都是原始记录。
       */
      const upgrade = request.transaction;
      if (upgrade && event.oldVersion >= 1) {
        migrateRecords(upgrade, event.oldVersion);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'));
    transaction.onerror = () => {
      // 请求错误会冒泡并触发 abort；最终统一由 onabort 返回事务错误。
    };
  });
}

/**
 * 基于 IndexedDB 的 StorageAdapter 实现（v4 §2.1）。
 *
 * 实现 `get` / `getAll` / `put`（覆盖写）/ `add`（append-only insert，同主键失败）。
 * 端口本身不暴露通用物理删除原语（v4 §2.4、红线 12：可同步实体禁止物理删除、Event 不可删除）。
 * 业务删除一律走软删。唯一例外是 §7.14 `data.imported` 整库恢复：见 `replaceAllForImport`。
 *
 * 单 store 方法保留为基础能力；S8 的 `runAtomic` 负责跨 store 的实体 + Event 原子提交。
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise;
  }

  async get<T>(store: string, id: string): Promise<T | undefined> {
    const db = await this.db();
    return new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(store: string): Promise<T[]> {
    const db = await this.db();
    return new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(store: string, value: T): Promise<void> {
    const db = await this.db();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async add<T>(store: string, value: T): Promise<void> {
    const db = await this.db();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      // add() 是 insert 语义：主键已存在时抛 ConstraintError → 事务失败 → reject。
      tx.objectStore(store).add(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async runAtomic<T>(
    stores: readonly string[],
    work: (transaction: AtomicStorageTransaction) => Promise<T>,
  ): Promise<T> {
    const uniqueStores = [...new Set(stores)];
    if (uniqueStores.length === 0) {
      throw new Error('runAtomic 至少需要声明一个 store');
    }

    const db = await this.db();
    const transaction = db.transaction(uniqueStores, 'readwrite');
    const completion = transactionCompletion(transaction);
    // work 可能比事务更晚 settle；预先挂 rejection handler，避免 abort 被报告为未处理拒绝。
    void completion.catch(() => undefined);

    const scopedStores = new Set(uniqueStores);
    const objectStore = (store: string): IDBObjectStore => {
      if (!scopedStores.has(store)) {
        throw new Error(`store ${store} 未在本次 runAtomic 中声明`);
      }
      return transaction.objectStore(store);
    };

    const atomicTransaction: AtomicStorageTransaction = {
      async get<Value>(store: string, id: string): Promise<Value | undefined> {
        return requestResult(objectStore(store).get(id)) as Promise<Value | undefined>;
      },
      async getAll<Value>(store: string): Promise<Value[]> {
        return requestResult(objectStore(store).getAll()) as Promise<Value[]>;
      },
      async put<Value>(store: string, value: Value): Promise<void> {
        await requestResult(objectStore(store).put(value));
      },
      async add<Value>(store: string, value: Value): Promise<void> {
        await requestResult(objectStore(store).add(value));
      },
    };

    /*
     * IndexedDB 会在事件循环没有待处理请求时自动提交。用一个无副作用 get 链保持事务
     * 活跃，直到异步 work 返回；这样即使业务逻辑在两次事务请求间短暂 await，后续失败
     * 仍能 abort 已执行的写入，而不会形成部分提交。
     */
    let keepAlive = true;
    const keepAliveStore = transaction.objectStore(uniqueStores[0]!);
    const pumpKeepAlive = (): void => {
      if (!keepAlive) return;
      try {
        const request = keepAliveStore.get('__phase1_transaction_keepalive__');
        const pump = () => pumpKeepAlive();
        request.onsuccess = pump;
        request.onerror = pump;
      } catch {
        // 事务已经完成或 abort；completion 会给调用方最终结果。
      }
    };
    pumpKeepAlive();

    let result: T;
    try {
      result = await work(atomicTransaction);
    } catch (error) {
      keepAlive = false;
      try {
        transaction.abort();
      } catch {
        // 请求失败可能已经触发 abort；仍保留原始业务/请求错误。
      }
      await completion.catch(() => undefined);
      throw error;
    }

    keepAlive = false;
    await completion;
    return result;
  }

  /**
   * 全量备份的所有表必须共享同一读取事务，不能把实体与 Event 读成不同时间点。
   * 保留原始记录（含 tombstone），只供备份使用。
   */
  async readAllForBackup(): Promise<Record<StoreName, unknown[]>> {
    const db = await this.db();
    const transaction = db.transaction([...STORE_NAMES], 'readonly');
    const completion = transactionCompletion(transaction);
    const reads = STORE_NAMES.map(async (name) => [
      name,
      await requestResult(transaction.objectStore(name).getAll()),
    ] as const);
    const [entries] = await Promise.all([Promise.all(reads), completion]);
    return Object.fromEntries(entries) as Record<StoreName, unknown[]>;
  }

  /**
   * 仅供 §7.14 本地备份恢复：在一个事务里清空全部 objectStore 再写入快照。
   * 不是通用删除 API，不得从业务 command / UI 直接调用。
   */
  async replaceAllForImport(records: Readonly<Record<string, readonly unknown[]>>): Promise<void> {
    const db = await this.db();
    const transaction = db.transaction([...STORE_NAMES], 'readwrite');
    const completion = transactionCompletion(transaction);
    void completion.catch(() => undefined);
    try {
      // 与覆盖同事务检查，避免另一标签页在预检查之后启动计时却被覆盖掉。
      const sessions = await requestResult(transaction.objectStore(STORE.sessions).getAll());
      if (sessions.some((session) => session.deletedAt === null && session.status === 'active')) {
        throw new Error('请先结束当前计时，再恢复备份');
      }
      for (const name of STORE_NAMES) {
        const objectStore = transaction.objectStore(name);
        objectStore.clear();
        for (const value of records[name] ?? []) {
          // 全库恢复也不能用 put 静默吞掉重复 ID。
          objectStore.add(value);
        }
      }
    } catch (error) {
      // DataError / DataCloneError 可能同步抛出，必须回滚已排队的 clear/add。
      try {
        transaction.abort();
      } catch {
        // 请求失败可能已触发 abort，保留最初的错误。
      }
      await completion.catch(() => undefined);
      throw error;
    }
    await completion;
  }
}
