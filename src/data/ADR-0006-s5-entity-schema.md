# ADR-0006 · 全实体 schema 与默认值工厂（Phase 1 / S5）

- 状态：已采纳（2026-06-05）
- 范围：phase1-plan.md **S5**；落实 v4 **§2.3 / §2.4 / §2.5 / §3.1–§3.7**。
- 执行粒度：S5 分 4 个可独立验收子块提交——S5a 共享基座（`f069cb7`，含 Minor 修复 `4f1591d`）、S5b Task+DayPlan（`3a61d64`）、S5c Session/Event/EnergyRecord/UnresolvedInterval（`2852cfa`）、S5d Settings+内置种子+barrel 补全+本 ADR。

## 背景

S0–S4 建好地基设施（ID 入口、时间/appDate 派生、schemaVersion、dataStore/objectStore 骨架），但 7 个实体尚无字段结构定义。S5 把 v4 §3.1–§3.7 的 7 实体逐字段落成 TypeScript 跨端契约类型 + 默认值工厂，作为 S6 校验器、S7 事件、S8 原子写入、S10 派生视图、S11 初始化、S13 行为接入的共同依赖层。

## 决策

1. **交付形态 = 类型 + 纯默认值工厂**：每实体一个 TS 类型 + 一个 `makeX(input)` 纯函数（`src/data/schema/*.ts`）。工厂只 **shape**：套默认值、按业务时间派生 `localDate`（DayPlan 另派生 `appDate`）。工厂**不做字段一致性校验**（留 S6）、**不落库/不开事务/不发 Event**（留 S8）。`now` 由调用方注入（带 UTC 偏移 ISO），保证确定性与可测试。

2. **同步预留与 Event 例外**：可同步实体共用 `SyncableBaseFields`（§2.3）；Event 用 `EventBaseFields`，**不挂** `updatedAt`/`deletedAt`/`deviceId`/`syncedAt`（append-only，红线 7）。`deviceId`/`syncedAt` 为 Phase 5+ 预留，普通工厂入口恒写 `null`、不开放非 null 覆盖（S5a fix 收紧；未来同步阶段经专门路径开放）。

3. **timezone/localDate 归属**：仅 Session/Event/EnergyRecord/UnresolvedInterval/DayPlan 带 `timezone`+`localDate`（§2.5）；Task、Settings 不带。`localDate` 业务时间取值：Session/UnresolvedInterval=`startedAt`、Event/EnergyRecord=`occurredAt`、DayPlan=`createdAt`。仅 DayPlan 落库 `appDate`（业务键，创建时按 tz+offset 派生、不开放覆盖、不回算历史，§2.5 规则 5/6）；其余实体 `appDate` 查询时派生、不落字段。

4. **Session 单一字段集**：5 种 type 共用同一字段集，不适用字段存 `null`、不省略（红线 13）。`makeSession` 为单一通用工厂（非 per-type），type×status×字段适用性校验留 S6。

5. **创建不变量集中在工厂**（按 v4 规范实现的工程细节）：
   - `makeTask` 默认写入 `estimateRounds` 首轮 `{index:1, pomodoros:estimatedPomodoros, occurredAt:now}`（§3.1 规则 9/11）；`lineageId` 默认等于自身 id。
   - `makeSettings` 默认写入两套内置种子的**深拷贝**（§3.7 关键规则 2）。
   - 上述默认均可由调用方覆盖（迁移/特殊场景）。

6. **内置种子落 S5（S5d）**：短休 15 + 长休 13 = 28 项 `restSuggestions` 与 1 项 `planningPreparation` 模板定义在 `src/data/schema/builtins.ts`（单一来源），严格照 §3.7 清单（isBuiltIn/isEnabled=true、icon=null、组内 sortIndex 步长 1000、key 前缀与 appliesTo 一致）。S11 初始化只消费、不重定义。

7. **Event.type/payload 占位**：S5 的 Event 只交付 §3.4 顶层实体字段，`type` 为 `string`、`payload` 为 `Record<string, unknown>` 占位；EventType 全量枚举与各 payload schema 属 S7（届时收紧为判别联合，为类型增强、非结构改写）。

8. **barrel 分层**：`src/data/schema/index.ts` 为 schema 层 barrel；S5d 在主入口 `src/data/index.ts` 追加 `export * from './schema'`，上层只从 `src/data` import。

9. **不建二级索引**：S5 保持纯 TS 类型/schema 层，不改 `stores.ts`、不 bump `DB_VERSION`；`dayPlans.appDate` 唯一、`events.occurredAt`、`tasks.status` 等索引推迟到 S10；appDate 唯一性约束由 S6 校验器在写入前实现。

## 不在 S5 做

- 不做 S6 校验器（范围/枚举子集/跨字段一致性/单例/唯一/前缀/引用校验）。
- 不做 S7 EventType 枚举与 payload schema；不做 S8 原子写入/事务；不做 S9 软删读取过滤；不做 S10 派生视图/二级索引；不做 S11 初始化真实触发；不做 S13 行为接入；不接 UI。
- 不做 `createCustomRestSuggestion`（自定义 `*_custom_<UUID>` key 生成属后续行为）。

## 验收

- `npm run typecheck` 通过；`npm run test:run` 全绿（各实体工厂全字段键在场、默认值对齐 v4、localDate/appDate 派生、内置种子计数/字段、Event 例外、Session 同字段集、深拷贝）。
- 既有守卫：`single-id-source.test.ts`（schema 内不直接 import `uuid`，只经 `newId`）、`schemaVersion.test.ts`（无 `schemaVersion:<数字>` 字面量、无 `4.0.0`）对全部新文件继续通过。
- lint：项目未提供 lint 命令，未运行。
