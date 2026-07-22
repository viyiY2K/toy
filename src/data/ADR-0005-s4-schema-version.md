# ADR-0005 · schemaVersion 常量与 legacy 口径（Phase 1 / S4）

- 状态：已采纳（2026-06-05）
- 范围：phase1-plan.md **S4**；落实 v4 **§2.3**（schemaVersion 是整数数据结构版本、非文档版本）。

## 背景

v4 §2.3：每条可同步实体（及 Event）写入时带 `schemaVersion`——整数数据结构版本号，用于迁移判断，与文档版本号（当前 v4.0.0）是两个独立概念。Phase 1 `CURRENT_SCHEMA_VERSION = 1`，新写入写 1；无版本旧数据视为 legacy（0 / unknown）；不得把文档版本 4.0.0 当作记录 schemaVersion。

## 决策

1. **集中常量（`src/data/schemaVersion.ts`）**：`CURRENT_SCHEMA_VERSION = 1`、`LEGACY_SCHEMA_VERSION = 0`。写入侧一律引用常量，**不散落数字字面量**。
2. **legacy 分类**：`isLegacySchemaVersion(v)` —— `v == null`（undefined/null，无版本旧数据）或 `v < CURRENT_SCHEMA_VERSION` 判为 legacy。**纯判定，不做迁移/数据改写**。
3. **集中化守卫测试**：`schemaVersion.test.ts` 扫 `src/data` 非测试 `.ts`，断言不出现 `4.0.0` 字面量、不出现 `schemaVersion: <数字>` 直写——把 §2.3「常量集中、无散落字面量、不写 4.0.0」固化为自动化验收（与 S2 单一来源守卫同风格）。

## 不在 S4 做

- 不把 schemaVersion 真正写到记录：实体 schema 默认值属 S5，写入路径属 S11/S13。
- 不做迁移：`data.migration*` 事件、旧数据改写、版本升级流程属 S14 / DEV，本轮只提供分类口径。
- 不建/读 Settings；不接 UI；不引新依赖。
