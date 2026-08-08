/**
 * MergeGroup 实体 schema 与默认值工厂（合并番茄钟功能批次，v4.1 §3.8）。
 *
 * MergeGroup 表示"合并番茄钟"：把几个耗时不足一个番茄的零碎任务并到一起，
 * 用**一段**专注时间同时推进，每个成员各自记一个完整的有效番茄。
 *
 * 这是**平等的集合关系**，不是 §3.1 `parentId` 的母子从属关系；一个 Task 可以
 * 同时是某母任务的子任务、又是某合并组的成员，两个维度互不影响（§3.1 关键规则 12）。
 *
 * 边界（与其余 schema 工厂一致）：本工厂只 **shape**（套默认值），
 * **不做字段一致性校验**（taskIds 长度、status×dissolvedAt×dissolvedReason、
 * estimatedPomodoros 1–7、estimateRounds 轮次上限一律留 validation 层）、
 * **不落库 / 不发 Event**（留 commands 层）。
 */

import { makeSyncableBase, type IsoDateTime, type SyncableBaseFields } from './common';
import type { EstimateRound } from './task';

/** 合并组状态（§3.8 status 枚举）。 */
export type MergeGroupStatus = 'active' | 'limitReached' | 'dissolved';

/** 解散原因（§3.8 dissolvedReason 枚举）；仅 status='dissolved' 时非 null。 */
export type MergeGroupDissolvedReason = 'membersBelowMinimum' | 'manualDissolved';

/** MergeGroup 完整实体（§3.8）。同步预留字段见 `SyncableBaseFields`（§2.3）。 */
export interface MergeGroup extends SyncableBaseFields {
  /**
   * 组内成员 Task id，有序（数组顺序即合并卡片内展示顺序）。
   * 是**持续的成员名单**，不因成员完成而自动移除——已完成的任务仍保留在这里，
   * 只是不再计入后续 focus Session 的 credit（§3.3 关键规则 11、§3.8 关键规则 4）。
   */
  taskIds: string[];
  estimatedPomodoros: number;
  estimateRounds: EstimateRound[];
  status: MergeGroupStatus;
  dissolvedAt: IsoDateTime | null;
  dissolvedReason: MergeGroupDissolvedReason | null;
}

/** `makeMergeGroup` 入参。`now` / `taskIds` 必填；其余按 v4.1 §3.8 默认值。 */
export interface MakeMergeGroupInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now，且作 estimateRounds 首轮 occurredAt。 */
  now: IsoDateTime;
  /** 创建时的初始成员，有序；长度 ≥ 2 由 validation 强制。 */
  taskIds: string[];
  /** 默认 1（§3.8 字段表：创建时固定为 1）；范围 1–7 校验留 validation。 */
  estimatedPomodoros?: number;
  /**
   * 默认 `[{ index:1, pomodoros:estimatedPomodoros, occurredAt:now }]`
   * （§3.8 字段表"创建时写入第一轮"，写法参照 §3.1 关键规则 11）。
   */
  estimateRounds?: EstimateRound[];
  status?: MergeGroupStatus;
  dissolvedAt?: IsoDateTime | null;
  dissolvedReason?: MergeGroupDissolvedReason | null;
  /** 软删除时间戳覆盖（§2.4）；默认 null。业务上的"已解散"用 status 表达，不写此字段（§3.8 关键规则 7）。 */
  deletedAt?: IsoDateTime | null;
}

/**
 * 构造一条带默认值的 MergeGroup（不校验、不落库）。
 * 新建必须由本工厂集中保证 `estimateRounds` 首轮 index=1 不变量（§3.8 字段表）。
 */
export function makeMergeGroup(input: MakeMergeGroupInput): MergeGroup {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  const estimatedPomodoros = input.estimatedPomodoros ?? 1;
  return {
    ...base,
    taskIds: [...input.taskIds],
    estimatedPomodoros,
    estimateRounds:
      input.estimateRounds ?? [{ index: 1, pomodoros: estimatedPomodoros, occurredAt: input.now }],
    status: input.status ?? 'active',
    dissolvedAt: input.dissolvedAt ?? null,
    dissolvedReason: input.dissolvedReason ?? null,
  };
}
