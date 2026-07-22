/**
 * Event 实体 schema 与默认值工厂（S5c，v4 §3.4 + §2.5）。
 *
 * Event 是 **append-only 不可变历史记录**：写入后不修改、不软删、不物删（红线 7/8、§3.4）。
 * 故 Event 用 `EventBaseFields`（仅 id/createdAt/schemaVersion），**不挂** updatedAt/deletedAt/deviceId/syncedAt。
 * `localDate` 由 `occurredAt` 派生；统计以 `occurredAt` 为准，`occurredAt` 可早于 `createdAt`（离线补录，§3.4 规则 6）。
 *
 * S7a 已将 `type` / `payload` 收紧为 §7 的完整静态判别契约。
 * 工厂仍只 shape；运行时 payload / 顶层关联校验留 S7b，落库留 S8。
 */

import {
  makeEventBase,
  makeLocalDateFields,
  type EventBaseFields,
  type IsoDateTime,
  type LocalDateFields,
} from './common';
import type { EventPayloadMap, EventType } from '../events/contract';

/** Event 完整实体（§3.4 顶层字段 + §7 判别 payload）。默认类型即 78 分支判别联合。 */
export type Event<T extends EventType = EventType> = T extends EventType
  ? EventBaseFields &
      LocalDateFields & {
        type: T;
        occurredAt: IsoDateTime;
        payload: EventPayloadMap[T];
        taskId: string | null;
        sessionId: string | null;
        dayPlanId: string | null;
        energyRecordId: string | null;
        unresolvedIntervalId: string | null;
        settingsId: string | null;
        correlationId: string | null;
      }
  : never;

interface MakeEventBaseInput<T extends EventType> {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 记录写入存储时刻（带 UTC 偏移 ISO）；作 createdAt。 */
  now: IsoDateTime;
  /** 业务发生时刻（带 UTC 偏移 ISO）；默认=now；作 localDate 派生的业务时间。 */
  occurredAt?: IsoDateTime;
  /** 写入时设备 IANA 时区。 */
  timezone: string;
  type: T;
  taskId?: string | null;
  sessionId?: string | null;
  dayPlanId?: string | null;
  energyRecordId?: string | null;
  unresolvedIntervalId?: string | null;
  settingsId?: string | null;
  correlationId?: string | null;
}

type PayloadInput<T extends EventType> = T extends 'triage.movedToList'
  ? { payload?: EventPayloadMap[T] }
  : { payload: EventPayloadMap[T] };

/** 非空 payload 必填；仅 `triage.movedToList` 的空 payload 可省略。 */
export type MakeEventInput<T extends EventType = EventType> = T extends EventType
  ? MakeEventBaseInput<T> & PayloadInput<T>
  : never;

/** 构造一条带默认值的 Event（append-only；不校验、不落库）。 */
export function makeEvent<T extends EventType>(input: MakeEventInput<T>): Event<T> {
  const base = makeEventBase({ id: input.id, now: input.now });
  const occurredAt = input.occurredAt ?? input.now;
  const { timezone, localDate } = makeLocalDateFields(occurredAt, input.timezone);
  return {
    ...base,
    timezone,
    localDate,
    type: input.type,
    occurredAt,
    payload: (input.payload ?? {}) as EventPayloadMap[T],
    taskId: input.taskId ?? null,
    sessionId: input.sessionId ?? null,
    dayPlanId: input.dayPlanId ?? null,
    energyRecordId: input.energyRecordId ?? null,
    unresolvedIntervalId: input.unresolvedIntervalId ?? null,
    settingsId: input.settingsId ?? null,
    correlationId: input.correlationId ?? null,
  } as Event<T>;
}
