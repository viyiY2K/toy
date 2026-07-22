/**
 * EnergyRecord 实体 schema 与默认值工厂（S5c，v4 §3.5 + §2.5）。
 *
 * EnergyRecord 是用户主动提交的能量/状态记录（未提交则不产生记录）。
 * `mood` Phase 1 暂缓采集、默认写 null（红线 11、§3.5 关键规则 3）；`recoveryDelta` 是派生指标，不入本体。
 * `localDate` 由 `occurredAt` 派生（§2.5）。
 *
 * 边界（与 S5a/S5b 一致）：本工厂只 **shape**，**不做字段一致性校验**（energyLevel/mood 1–10、
 * source×sessionId 规则一律留 S6）、**不落库 / 不发 Event**（留 S8）。
 */

import {
  makeLocalDateFields,
  makeSyncableBase,
  type IsoDateTime,
  type LocalDateFields,
  type SyncableBaseFields,
} from './common';

/** 能量记录触发来源（§3.5 source 枚举）。 */
export type EnergySource =
  | 'dayStart'
  | 'beforeFocus'
  | 'afterFocus'
  | 'afterShortBreak'
  | 'afterLongBreak'
  | 'afterExtraFocus'
  | 'afterExtraRest'
  | 'onReturn'
  | 'manual';

/** EnergyRecord 完整实体（§3.5）。 */
export interface EnergyRecord extends SyncableBaseFields, LocalDateFields {
  energyLevel: number;
  mood: number | null;
  source: EnergySource;
  sessionId: string | null;
  note: string | null;
  occurredAt: IsoDateTime;
}

/** `makeEnergyRecord` 入参。`now / occurredAt / timezone / source / energyLevel` 必填。 */
export interface MakeEnergyRecordInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now。 */
  now: IsoDateTime;
  /** 用户提交时刻（带 UTC 偏移 ISO）；作 localDate 派生的业务时间。 */
  occurredAt: IsoDateTime;
  /** 写入时设备 IANA 时区。 */
  timezone: string;
  source: EnergySource;
  /** 能量值；范围 1–10 校验留 S6。 */
  energyLevel: number;
  /** 默认 null（Phase 1 暂缓采集，§3.5 / 红线 11）。 */
  mood?: number | null;
  sessionId?: string | null;
  note?: string | null;
  /** 软删除时间戳覆盖（§2.4）；默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/** 构造一条带默认值的 EnergyRecord（不校验、不落库）。 */
export function makeEnergyRecord(input: MakeEnergyRecordInput): EnergyRecord {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  const { timezone, localDate } = makeLocalDateFields(input.occurredAt, input.timezone);
  return {
    ...base,
    timezone,
    localDate,
    energyLevel: input.energyLevel,
    mood: input.mood ?? null,
    source: input.source,
    sessionId: input.sessionId ?? null,
    note: input.note ?? null,
    occurredAt: input.occurredAt,
  };
}
