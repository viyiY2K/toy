/**
 * Session 实体 schema 与默认值工厂（S5c，v4 §3.3 + §2.5）。
 *
 * Session 表示一次执行单元：专注（focus / extraFocus）或休息（shortBreak / longBreak / extraRest）。
 * **5 种 type 共用同一套字段**；对某 type 不适用的字段存 `null`，**不省略**（红线 13、§3.3 关键规则 1）。
 * `localDate` 由 `startedAt` 派生（§2.5）。
 *
 * 边界（与 S5a/S5b 一致）：本工厂只 **shape**（套默认值 + 派生 localDate），
 * **不做字段一致性校验**（type×status×字段适用性、actualDuration 范围、sourceFocusSessionId 引用、
 * skipKind×status 等一律留 S6）、**不落库 / 不发 Event**（留 S8）。
 */

import {
  makeLocalDateFields,
  makeSyncableBase,
  type IsoDateTime,
  type LocalDateFields,
  type SyncableBaseFields,
} from './common';

/** 会话类型（§3.3 type 枚举）。 */
export type SessionType = 'focus' | 'shortBreak' | 'longBreak' | 'extraFocus' | 'extraRest';

/**
 * 会话状态（§3.3 status 枚举，两组的并集）。
 * focus/extraFocus 取 active|completed|discarded；shortBreak/longBreak/extraRest 取 active|completed|skipped。
 * 按 type 分流的子集约束（含 extra* 恒为 completed）留 S6。
 */
export type SessionStatus = 'active' | 'completed' | 'discarded' | 'skipped';

/** 休息未完成原因（§3.3 skipKind 枚举；仅 shortBreak/longBreak 在 skipped 时适用）。 */
export type SkipKind = 'explicitSkip' | 'noResponse' | 'appClosed' | 'missed';

/** Session 完整实体（§3.3）。同步预留见 `SyncableBaseFields`，时区/自然日见 `LocalDateFields`。 */
export interface Session extends SyncableBaseFields, LocalDateFields {
  type: SessionType;
  status: SessionStatus;
  taskId: string | null;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  plannedDuration: number | null;
  actualDuration: number | null;
  pomodoroIndex: number | null;
  skipKind: SkipKind | null;
  originIntervalId: string | null;
  sourceFocusSessionId: string | null;
  suggestedRest: string | null;
  actualRest: string | null;
  dayPlanId: string | null;
}

/** `makeSession` 入参。`now / startedAt / timezone / type` 必填；其余按 v4 默认值（不适用字段默认 null）。 */
export interface MakeSessionInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now。 */
  now: IsoDateTime;
  /** 会话开始时刻（带 UTC 偏移 ISO）；作 localDate 派生的业务时间。 */
  startedAt: IsoDateTime;
  /** 写入时设备 IANA 时区。 */
  timezone: string;
  type: SessionType;
  /** 默认 'active'（§3.3 默认值）；extra* 恒为 'completed' 由调用方传入，校验留 S6。 */
  status?: SessionStatus;
  taskId?: string | null;
  endedAt?: IsoDateTime | null;
  plannedDuration?: number | null;
  actualDuration?: number | null;
  pomodoroIndex?: number | null;
  skipKind?: SkipKind | null;
  originIntervalId?: string | null;
  sourceFocusSessionId?: string | null;
  suggestedRest?: string | null;
  actualRest?: string | null;
  dayPlanId?: string | null;
  /** 软删除时间戳覆盖（§2.4）；默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/**
 * 构造一条带默认值的 Session（不校验、不落库）。
 * 单一通用工厂：所有 type 字段集完全相同，不适用字段默认 null（红线 13）。
 */
export function makeSession(input: MakeSessionInput): Session {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  const { timezone, localDate } = makeLocalDateFields(input.startedAt, input.timezone);
  return {
    ...base,
    timezone,
    localDate,
    type: input.type,
    status: input.status ?? 'active',
    taskId: input.taskId ?? null,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    plannedDuration: input.plannedDuration ?? null,
    actualDuration: input.actualDuration ?? null,
    pomodoroIndex: input.pomodoroIndex ?? null,
    skipKind: input.skipKind ?? null,
    originIntervalId: input.originIntervalId ?? null,
    sourceFocusSessionId: input.sourceFocusSessionId ?? null,
    suggestedRest: input.suggestedRest ?? null,
    actualRest: input.actualRest ?? null,
    dayPlanId: input.dayPlanId ?? null,
  };
}
