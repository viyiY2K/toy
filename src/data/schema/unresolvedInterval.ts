/**
 * UnresolvedInterval 实体 schema 与默认值工厂（S5c，v4 §3.6 + §2.5）。
 *
 * UnresolvedInterval 表示系统发现的"无法可靠判断用户在做什么"的时间段，待用户事后归类。
 * **结构 Phase 1 必须建齐（全表全字段），行为整体 P2**（红线 11、§3.6）。
 * `localDate` 由 `startedAt` 派生（"这段时间发生在哪天"，非"哪天处理"，§3.6 关键规则 7）。
 * `duration` 是派生指标（endedAt − startedAt），不入本体。
 *
 * 边界（与 S5a/S5b 一致）：本工厂只 **shape**，**不做字段一致性校验**（endedAt>startedAt、
 * status×classifiedAt/ignoredAt 一律留 S6）、**不落库 / 不发 Event**（留 S8）。
 */

import {
  makeLocalDateFields,
  makeSyncableBase,
  type IsoDateTime,
  type LocalDateFields,
  type SyncableBaseFields,
} from './common';

/** 未归类时段来源（§3.6 source 枚举）。 */
export type UnresolvedIntervalSource =
  | 'appReopened'
  | 'systemRecovered'
  | 'timerStateLost'
  | 'userNoResponse';

/** 归类状态（§3.6 status 枚举）。 */
export type UnresolvedIntervalStatus = 'pending' | 'classified' | 'ignored';

/** UnresolvedInterval 完整实体（§3.6）。 */
export interface UnresolvedInterval extends SyncableBaseFields, LocalDateFields {
  source: UnresolvedIntervalSource;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  status: UnresolvedIntervalStatus;
  classifiedAt: IsoDateTime | null;
  ignoredAt: IsoDateTime | null;
  ignoreReason: string | null;
}

/** `makeUnresolvedInterval` 入参。`now / startedAt / endedAt / timezone / source` 必填。 */
export interface MakeUnresolvedIntervalInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now。 */
  now: IsoDateTime;
  /** 时段开始时刻（带 UTC 偏移 ISO）；作 localDate 派生的业务时间。 */
  startedAt: IsoDateTime;
  /** 时段结束时刻（带 UTC 偏移 ISO）；endedAt>startedAt 校验留 S6。 */
  endedAt: IsoDateTime;
  /** 写入时设备 IANA 时区。 */
  timezone: string;
  source: UnresolvedIntervalSource;
  /** 默认 'pending'（§3.6 默认值）。 */
  status?: UnresolvedIntervalStatus;
  classifiedAt?: IsoDateTime | null;
  ignoredAt?: IsoDateTime | null;
  ignoreReason?: string | null;
  /** 软删除时间戳覆盖（§2.4）；正常 ignored 不软删，作审计保留。默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/** 构造一条带默认值的 UnresolvedInterval（不校验、不落库）。 */
export function makeUnresolvedInterval(input: MakeUnresolvedIntervalInput): UnresolvedInterval {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  const { timezone, localDate } = makeLocalDateFields(input.startedAt, input.timezone);
  return {
    ...base,
    timezone,
    localDate,
    source: input.source,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status ?? 'pending',
    classifiedAt: input.classifiedAt ?? null,
    ignoredAt: input.ignoredAt ?? null,
    ignoreReason: input.ignoreReason ?? null,
  };
}
