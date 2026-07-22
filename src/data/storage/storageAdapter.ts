/**
 * 存储边界抽象（v4 §2.1）。
 *
 * 落实"组件不得直接读写底层存储"：上层（含未来接入的 UI）只依赖本接口，
 * 不接触 IndexedDB / SQLite 等具体存储引擎，从而保证数据层可替换、可测试、可迁移。
 *
 * S0 边界：本文件只定义最小读写契约，证明数据层存在一个可替换的存储边界类型。
 * IndexedDB 实现、objectStore 结构、事务（transaction）机制、dataStore CRUD 全部留到 S1，
 * 届时再在本接口之上扩展，不在 S0 提前设计。
 *
 * 删除语义（v4 §2.4、红线 12）：可同步实体禁止物理删除、Event 不可删除。
 * 本接口**刻意不暴露通用物理删除原语**，以免给后续 S1/S9 留下误用入口；
 * 业务层删除一律走软删 API（写 deletedAt + 保留 tombstone），由 S9 实现，本轮不提前建。
 */
/**
 * 单个底层原子事务内可用的操作。
 *
 * 事务不暴露 delete/clear；Event 的 append-only 语义由上层 dataStore 把 `add`
 * 收窄为 `appendEvent`。所有方法都必须只访问 runAtomic 声明的 store。
 */
export interface AtomicStorageTransaction {
  get<T>(store: string, id: string): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  put<T>(store: string, value: T): Promise<void>;
  add<T>(store: string, value: T): Promise<void>;
}

export interface StorageAdapter {
  /** 按主键读取单条记录；不存在返回 undefined。 */
  get<T>(store: string, id: string): Promise<T | undefined>;
  /** 读取某个 store 的全部记录。 */
  getAll<T>(store: string): Promise<T[]>;
  /** 写入（创建或覆盖）一条记录。 */
  put<T>(store: string, value: T): Promise<void>;
  /**
   * 追加写入一条记录（insert 语义）；若主键已存在则失败。
   * 用于 append-only 写入（如 Event，v4 §3.4 关键规则 1/2），保证既有记录不被覆盖。
   */
  add<T>(store: string, value: T): Promise<void>;
  /**
   * 在一个底层事务中执行多个读写；work 抛错或任一请求失败时整体 abort。
   * work 只有在底层事务成功提交后才算完成。
   */
  runAtomic<T>(
    stores: readonly string[],
    work: (transaction: AtomicStorageTransaction) => Promise<T>,
  ): Promise<T>;
}
