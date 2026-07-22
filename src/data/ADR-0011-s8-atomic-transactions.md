# ADR-0011 · 跨 store 原子事务与 correlationId（Phase 1 / S8）

- 范围：`phase1-plan.md` **S8**；落实 v4 **§3.4 关键规则 5、8**。
- 决策：`StorageAdapter.runAtomic(storeNames, work)` 用单个 IndexedDB
  `readwrite` transaction 承载事务内 `get/getAll/put/add`；`dataStore.runAtomic`
  将其收窄为 `get/getAll/put/appendEvent`。
- 原子性：work 抛错或任一 IDB 请求失败时显式 `abort()`；调用成功只在
  `transaction.oncomplete` 后返回。事务存活请求链防止异步 work 中途被 IndexedDB
  自动提交，确保晚到错误仍能整体回滚。
- 事件关联：每次 `dataStore.runAtomic` 仅调用一次统一 `newId()`，把 UUID v7
  `correlationId` 暴露给事务；事务内每条 Event 必须带同一个值，否则拒绝并回滚。
- append-only：事务内 `put` 仅接受六个可同步实体 store；Event 只能调用底层
  `add` 语义的 `appendEvent`，同 id 冲突会 abort，既有 Event 不会被覆盖。
- 范围边界：本单元只提供原子存储机制，不实现 S9 软删除/默认过滤、S12 错误事件、
  S11 初始化、业务命令或 UI；写入前实体/Event 契约校验由后续 S12 包装层接入。
