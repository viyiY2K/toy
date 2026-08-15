/**
 * MergeGroup 实体 schema 与默认值工厂（合并番茄钟功能批次，v4.1 §3.8）。
 *
 * MergeGroup 表示"合并番茄钟"：把几个耗时不足一个番茄的零碎任务并到一起，
 * 用**一段**专注时间依次推进。有效番茄与整段时长归 MergeGroup；成员 Task 不取得
 * 番茄，只从 Session.taskSegments 取得自己的分段耗时（v4.3 §3.3 / §8.5）。
 *
 * 这是**平等的集合关系**，不是任务层级；v4.3 已废除 `parentId` 子任务机制。
 *
 * 边界（与其余 schema 工厂一致）：本工厂只 **shape**（套默认值），
 * **不做字段一致性校验**（taskIds 长度、status×dissolvedAt×dissolvedReason、
 * estimatedPomodoros 1–7、estimateRounds 轮次上限一律留 validation 层）、
 * **不落库 / 不发 Event**（留 commands 层）。
 */

import { makeSyncableBase, type IsoDateTime, type SyncableBaseFields } from './common';
import type { EstimateRound } from './task';

/**
 * 合并组状态（§3.8 status 枚举）。
 *
 * `completed` 与 `dissolved` 都是终态，但**语义不同、不得混用**（红线 28）：
 * `completed` 是用户明确确认"这一组做完了"的**成功**终态；`dissolved` 只表示中途
 * 拆散 / 取消合并（不论是主动整体解散还是成员不足自动解散），不代表做完。
 */
export type MergeGroupStatus = 'active' | 'limitReached' | 'completed' | 'dissolved';

/** 解散原因（§3.8 dissolvedReason 枚举）；仅 status='dissolved' 时非 null。 */
export type MergeGroupDissolvedReason = 'membersBelowMinimum' | 'manualDissolved';

/** 创建合并组时的系统默认名（§3.8 title 字段：调用方未提供时不允许留空）。 */
export const DEFAULT_MERGE_GROUP_TITLE = '杂事番茄';

/** MergeGroup.title 长度上限（§3.8 一致性约束 8，与 §3.1 Task.title 一致）。 */
export const MERGE_GROUP_TITLE_MAX_LENGTH = 200;

/** MergeGroup 完整实体（§3.8）。同步预留字段见 `SyncableBaseFields`（§2.3）。 */
export interface MergeGroup extends SyncableBaseFields {
  /**
   * 合并组名称（§3.8，v4.3）。新口径下合并组本身是番茄与专注时长的归属单位，会作为
   * 独立条目出现在统计与历史列表里，因此必须有名字，否则多个合并组无法区分。
   */
  title: string;
  /**
   * 组内成员 Task id，有序（数组顺序即合并卡片内展示顺序）。
   * 是**持续的成员名单**，不因成员完成而自动移除——已完成的任务仍保留在这里，
   * 只是不再计入后续 focus Session 的 credit（§3.3 关键规则 11、§3.8 关键规则 4）。
   */
  taskIds: string[];
  estimatedPomodoros: number;
  estimateRounds: EstimateRound[];
  status: MergeGroupStatus;
  /** 用户确认这一组完成的时刻（§3.8，v4.3）；仅 status='completed' 时非 null。 */
  completedAt: IsoDateTime | null;
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
  /** 默认 `DEFAULT_MERGE_GROUP_TITLE`；非空与长度上限校验留 validation（§3.8 一致性约束 8）。 */
  title?: string;
  /** 默认 1（§3.8 字段表：创建时固定为 1）；范围 1–7 校验留 validation。 */
  estimatedPomodoros?: number;
  /**
   * 默认 `[{ index:1, pomodoros:estimatedPomodoros, occurredAt:now }]`
   * （§3.8 字段表"创建时写入第一轮"，写法参照 §3.1 关键规则 11）。
   */
  estimateRounds?: EstimateRound[];
  status?: MergeGroupStatus;
  completedAt?: IsoDateTime | null;
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
    title: input.title ?? DEFAULT_MERGE_GROUP_TITLE,
    taskIds: [...input.taskIds],
    estimatedPomodoros,
    estimateRounds:
      input.estimateRounds ?? [{ index: 1, pomodoros: estimatedPomodoros, occurredAt: input.now }],
    status: input.status ?? 'active',
    completedAt: input.completedAt ?? null,
    dissolvedAt: input.dissolvedAt ?? null,
    dissolvedReason: input.dissolvedReason ?? null,
  };
}
