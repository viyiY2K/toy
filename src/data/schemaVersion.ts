/**
 * 数据结构版本（v4 §2.3）。
 *
 * `schemaVersion` 是用于迁移判断的**整数**，与规范文档版本号是两个独立概念，不可混用。
 * Phase 1 建立第一版正式数据地基，`CURRENT_SCHEMA_VERSION = 1`；新写入记录一律写本常量。
 * 旧原型若无版本数据视为 legacy（0 / unknown）。禁止把文档版本号写入记录的 schemaVersion。
 *
 * 本模块只提供常量与分类口径；把 schemaVersion 真正落到各实体记录属 S5/S11/S13；迁移行为属 S14。
 */

/** 当前数据结构版本（整数，单一来源）。Phase 1 = 1。 */
export const CURRENT_SCHEMA_VERSION = 1;

/** legacy 哨兵：无版本 / 旧原型数据按此处理。 */
export const LEGACY_SCHEMA_VERSION = 0;

/**
 * 是否为 legacy（早于当前结构版本）的记录版本号。
 * `null` / `undefined`（无版本旧数据）或 `< CURRENT_SCHEMA_VERSION` 均判为 legacy。
 * 纯分类判定，不做任何迁移 / 数据改写（迁移属 S14）。
 */
export function isLegacySchemaVersion(version: number | null | undefined): boolean {
  return version == null || version < CURRENT_SCHEMA_VERSION;
}
