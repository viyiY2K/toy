/**
 * 实体 schema 共享基座（S5a，v4 §2.3 / §2.5）。
 *
 * 本文件只提供"所有实体共有的字段类型 + 套默认值的纯工厂"，是 S5b+ 各实体 schema 的公共底座：
 * - `SyncableBaseFields`：可同步实体（Task/DayPlan/Session/EnergyRecord/UnresolvedInterval/Settings）共有的同步预留字段（§2.3）。
 * - `EventBaseFields`：Event 例外——只挂 id/createdAt/schemaVersion，**不挂** updatedAt/deletedAt/deviceId/syncedAt（§2.3 例外、红线 7）。
 * - `LocalDateFields`：按本地日期聚合实体（Session/Event/EnergyRecord/UnresolvedInterval/DayPlan）共有的 timezone/localDate（§2.5）。
 *
 * 边界（S5a 不越界）：
 * - 工厂只 **shape**（套默认值/派生 localDate），**不做字段一致性校验**（留 S6）、**不落库/不开事务/不发 Event**（留 S8）。
 * - `now` 由调用方注入（带 UTC 偏移的 ISO），保证可测试与确定性；本层不读"当前设备时间"。
 */

import { newId } from '../id';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { deriveLocalDate, type Instant, type IsoDate } from '../time';

/**
 * ISO 8601 带 UTC 偏移的时间戳串（如 `'2026-06-05T14:37:12+08:00'`）。
 * 仅作语义别名标注，运行时"必须带偏移"的校验留 S6 / 复用 S3 的 `toInstant`。
 */
export type IsoDateTime = string;

/**
 * 同步预留基字段（§2.3）。所有**可同步实体**共有；Event 不用此组（见 `EventBaseFields`）。
 * `deviceId` / `syncedAt` 为 Phase 5+ 预留，Phase 1 写 null。
 */
export interface SyncableBaseFields {
  id: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  schemaVersion: number;
  deletedAt: IsoDateTime | null;
  deviceId: string | null;
  syncedAt: IsoDateTime | null;
}

/**
 * Event 基字段（§2.3 例外、红线 7）。
 * Event 是 append-only 不可变历史：只挂 `id` / `createdAt` / `schemaVersion`，
 * 禁止 `updatedAt` / `deletedAt` / `deviceId` / `syncedAt`。
 */
export interface EventBaseFields {
  id: string;
  createdAt: IsoDateTime;
  schemaVersion: number;
}

/**
 * 时区 / 事实自然日字段片段（§2.5）。
 * 适用实体：Session / Event / EnergyRecord / UnresolvedInterval / DayPlan。
 * Task、Settings **不带**此组（§3.1 / §3.7 字段表无此两行）。
 * `appDate` 不在此片段：仅 DayPlan 落库 `appDate`，其余实体查询时派生（§2.5 规则 5）。
 */
export interface LocalDateFields {
  timezone: string;
  localDate: IsoDate;
}

/**
 * `makeSyncableBase` 入参。`now` 必填（createdAt=updatedAt=now，§2.3"创建时与 createdAt 相同"）。
 *
 * Phase 1 边界：`deviceId` / `syncedAt` 是 Phase 5+ 预留同步字段，Phase 1 普通写入必须保持 `null`，
 * 故本入参**不开放**对它们的覆盖；未来同步阶段如需写入非 null，应通过专门的同步施工单元重新开放专门路径，
 * 不经本 Phase 1 普通工厂入口。`deletedAt` 属 Phase 1 软删除字段（§2.4），保留覆盖入口。
 */
export interface SyncableBaseInput {
  /** 不传则由单一入口 `newId()` 生成（UUID v7）。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt 与 updatedAt 均取此值。 */
  now: IsoDateTime;
  /** 软删除时间戳覆盖（§2.4）；默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/**
 * 套用可同步实体同步预留字段默认值（不校验、不落库）。
 * `deviceId` / `syncedAt` 在 Phase 1 普通写入中恒为 `null`（Phase 5+ 同步专门路径再开放，见 `SyncableBaseInput`）。
 */
export function makeSyncableBase(input: SyncableBaseInput): SyncableBaseFields {
  return {
    id: input.id ?? newId(),
    createdAt: input.now,
    updatedAt: input.now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: input.deletedAt ?? null,
    deviceId: null,
    syncedAt: null,
  };
}

/** `makeEventBase` 入参。 */
export interface EventBaseInput {
  /** 不传则由 `newId()` 生成。 */
  id?: string;
  /** 记录写入存储时刻（带 UTC 偏移 ISO）。 */
  now: IsoDateTime;
}

/** 套用 Event 基字段默认值；不挂 updatedAt/deletedAt/deviceId/syncedAt（红线 7）。 */
export function makeEventBase(input: EventBaseInput): EventBaseFields {
  return {
    id: input.id ?? newId(),
    createdAt: input.now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * 由（业务时间 + 该记录 IANA timezone）构造 `{ timezone, localDate }`（§2.5）。
 * `businessTime` 按实体取其业务时间字段：Session/UnresolvedInterval 取 `startedAt`，
 * Event/EnergyRecord 取 `occurredAt`，DayPlan 取 `createdAt`。
 * 派生只依赖记录自带 timezone，不回算"当前设备时区"（红线 5）。`appDate` 由各调用方按需另行派生。
 */
export function makeLocalDateFields(businessTime: Instant, timezone: string): LocalDateFields {
  return { timezone, localDate: deriveLocalDate(businessTime, timezone) };
}
