# ADR-0002 · dataStore 抽象层与 IndexedDB objectStore 骨架（Phase 1 / S1）

- 状态：已采纳（2026-06-05）
- 范围：phase1-plan.md **S1**；落实 v4 **§2.1**（dataStore 抽象、组件不得直接读写底层存储）、**§2.2**（UUID v7 主键）、**§2.4 / 红线 12**（禁物理删除）。

## 背景

S0 仅交付存储边界类型 `StorageAdapter`（`get/getAll/put`，无物理删除原语），无任何实际存储实现。S1 提供 IndexedDB 实现与组件唯一读写入口，使数据可经统一抽象层落库。

## 决策

1. **store 清单 = 7 个，与 §3 七实体一一对应**：`tasks / dayPlans / sessions / events / energyRecords / unresolvedIntervals / settings`，集中定义于 `src/data/storage/stores.ts`（单一来源，避免散落字符串）。
2. **主键统一 `keyPath:'id'`（UUID v7，§2.2）**；写入主键由 S0 `newId()` 产出。
3. **二级索引本轮全部后置**：S1 只建主键。`events.occurredAt` / `dayPlans.appDate` / `tasks.status` 等二级索引依赖 S5 未定的字段 schema，提前建会绑死字段名；留到 S5/S10 需要时 **bump `DB_VERSION` + `onupgradeneeded` 增量添加**（已为此预留版本升级路径）。
4. **DB 名/版本**：`DB_NAME='pomodoro'`、`DB_VERSION=1`（实现方决策，D1）。
5. **抽象分层**：`StorageAdapter`（S0 端口，engine 级，参数 `string`）← `IndexedDbStorageAdapter`（S1 实现）← `dataStore`（facade，参数收窄为 `StoreName`，组件唯一入口）。

## 删除语义（§2.4、红线 12）

- 端口、适配器、facade **三层公开面均无物理删除**：`IndexedDbStorageAdapter` 不包装 `IDBObjectStore.delete` / `.clear`；`dataStore` 只暴露 `get/getAll/put`；`index.ts` 不导出任何删除能力或原始句柄。
- 回归守卫测试断言 `dataStore` 上 `delete/clear/remove` 均为 `undefined`，防止未来被加回。
- 业务删除一律走软删（写 `deletedAt` + 保留 tombstone），由 **S9** 落地；Event 不可删除。

## Event append-only 写入隔离（Codex S1 收口）

v4 §3.4 关键规则 1/2、红线 8：Event 写入后不可修改 / 软删 / 物删。为避免把"覆盖写 Event"烙进数据层公共面，dataStore 写入分两条：

- `put(store, value)`：覆盖写（创建/更新），**类型层面仅接受 `SyncableStoreName`**（6 个可同步实体 store，排除 events）；并加运行时纵深防御——`put(events, …)` 一律 reject。
- `appendEvent(value)`：Event 专属 append-only 入口，底层走 `StorageAdapter.add()`（`IDBObjectStore.add()`，insert 语义），**同 id 重复写入失败**，保证 Event 不可覆盖。
- 读取不受限：`get` / `getAll` 对全部 store 开放——Event 可读，只是不可改。

EventType / payload schema 仍属 **S7**；跨实体 + Event 原子事务仍属 **S8**——本次收口不做。

## 测试

- 用 `fake-indexeddb`（仅 devDependency）在 node 下真实跑 IndexedDB；`vitest.config.ts` 经 `setupFiles: ['fake-indexeddb/auto']` 注入全局 `indexedDB`，环境维持 `node`。
- `tsconfig.json` 的 `lib` 增加 `DOM`，仅为获得 IndexedDB 相关类型（`IDBDatabase` 等），**不引入任何 DOM 运行时依赖**。

## 不在 S1 做

S2（ID 单一来源/单调硬验收）、S3（时区/appDate）、S5（实体 schema 与字段类型）、S6（校验器）、S7（EventType/payload）、S8（跨实体 + Event 原子事务）、S9（软删/过滤）、S10（派生视图查询）、UI 接入；不建二级索引；不引入 ORM/重型封装。
