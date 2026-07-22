/**
 * Task 实体 schema 与默认值工厂（S5b，v4 §3.1）。
 *
 * Task 是核心待办实体；子任务也是 Task（经 `parentId` 关联，层级上限 2 层）。
 * 番茄数 / 专注时长等统计**不存在 Task 上**，一律从 Session/Event 派生（§3.1 关键规则 1）。
 *
 * 注意：Task **不带** `timezone` / `localDate`（§3.1 字段表无此两行），故只 & `SyncableBaseFields`，不 & `LocalDateFields`。
 *
 * 边界（与 S5a 一致）：本工厂只 **shape**（套默认值），
 * **不做字段一致性校验**（estimatedPomodoros 1–7、title 非空、status×completedAt×completionSource×outcome、
 * splitFromTaskId×splitIndex 等一律留 S6）、**不落库 / 不发 Event**（留 S8）。
 */

import { makeSyncableBase, type IsoDateTime, type SyncableBaseFields } from './common';

/** 任务状态（§3.1 status 枚举）。 */
export type TaskStatus = 'active' | 'completed' | 'splitNeeded' | 'archived' | 'deleted';

/** 归档结果（§3.1 outcome）；null = 未归档。 */
export type TaskOutcome = 'completed' | 'split';

/** 完成方式（§3.1 completionSource）；null = 未完成。 */
export type TaskCompletionSource = 'pomodoro' | 'manual';

/** 删除原因（§3.1 deletedReason）；null = 未指定。 */
export type TaskDeletedReason = 'userDeleted' | 'triageDismissed' | 'dataCleanup';

/**
 * 每轮预估记录（§3.1 estimateRounds 数组元素）。
 * `pomodoros` 是该轮预估后的**总预估番茄数**（非增量）；范围/轮次约束（1–7、index≤3）留 S6 校验。
 */
export interface EstimateRound {
  index: 1 | 2 | 3;
  pomodoros: number;
  occurredAt: IsoDateTime;
}

/**
 * Task 附加元数据（§3.1 metadata 对象结构）。永远不为 null（可为空对象），内部字段均可选。
 * `source` 按 v4 §3.1 字段表保持 `string`（其枚举在 §7 task.created 统一定义，收紧留 S7）。
 */
export interface TaskMetadata {
  triageStatus?: 'pending' | null;
  color?: string;
  tags?: string[];
  templateKey?: string;
  source?: string;
}

/** Task 完整实体（§3.1）。同步预留字段见 `SyncableBaseFields`（§2.3）。 */
export interface Task extends SyncableBaseFields {
  parentId: string | null;
  title: string;
  status: TaskStatus;
  outcome: TaskOutcome | null;
  completionSource: TaskCompletionSource | null;
  estimatedPomodoros: number;
  estimateRounds: EstimateRound[];
  actualWorkNote: string | null;
  note: string | null;
  sortIndex: number;
  completedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
  deletedReason: TaskDeletedReason | null;
  metadata: TaskMetadata;
  lineageId: string;
  splitFromTaskId: string | null;
  splitIndex: number;
}

/** `makeTask` 入参。`title` / `now` 必填；其余按 v4 默认值。 */
export interface MakeTaskInput {
  /** 不传则由单一入口 `newId()` 生成。 */
  id?: string;
  /** 写入时刻（带 UTC 偏移 ISO）；createdAt=updatedAt=now，且作 estimateRounds 首轮 occurredAt。 */
  now: IsoDateTime;
  title: string;
  parentId?: string | null;
  status?: TaskStatus;
  outcome?: TaskOutcome | null;
  completionSource?: TaskCompletionSource | null;
  /** 默认 1（§3.1 默认值）；范围 1–7 校验留 S6。 */
  estimatedPomodoros?: number;
  /**
   * 默认 `[{ index:1, pomodoros:estimatedPomodoros, occurredAt:now }]`（§3.1 关键规则 9/11：
   * 新建任务必须完整记录第一轮 index=1）。调用方可传覆盖（迁移/特殊场景）。
   */
  estimateRounds?: EstimateRound[];
  actualWorkNote?: string | null;
  note?: string | null;
  /** 默认 1000；"列表最大 sortIndex + 1000"的真实定位属 S10/S13 调用方。 */
  sortIndex?: number;
  completedAt?: IsoDateTime | null;
  archivedAt?: IsoDateTime | null;
  deletedReason?: TaskDeletedReason | null;
  metadata?: TaskMetadata;
  /** 默认等于自身 id（§3.1：新建时 lineageId = task.id）。 */
  lineageId?: string;
  splitFromTaskId?: string | null;
  splitIndex?: number;
  /** 软删除时间戳覆盖（§2.4）；默认 null。 */
  deletedAt?: IsoDateTime | null;
}

/**
 * 构造一条带默认值的 Task（不校验、不落库）。
 * 默认新建必须由本工厂集中保证 `estimateRounds` 首轮 index=1 不变量（§3.1 规则 9/11）。
 */
export function makeTask(input: MakeTaskInput): Task {
  const base = makeSyncableBase({ id: input.id, now: input.now, deletedAt: input.deletedAt });
  const estimatedPomodoros = input.estimatedPomodoros ?? 1;
  return {
    ...base,
    parentId: input.parentId ?? null,
    title: input.title,
    status: input.status ?? 'active',
    outcome: input.outcome ?? null,
    completionSource: input.completionSource ?? null,
    estimatedPomodoros,
    estimateRounds:
      input.estimateRounds ?? [{ index: 1, pomodoros: estimatedPomodoros, occurredAt: input.now }],
    actualWorkNote: input.actualWorkNote ?? null,
    note: input.note ?? null,
    sortIndex: input.sortIndex ?? 1000,
    completedAt: input.completedAt ?? null,
    archivedAt: input.archivedAt ?? null,
    deletedReason: input.deletedReason ?? null,
    metadata: input.metadata ?? {},
    lineageId: input.lineageId ?? base.id,
    splitFromTaskId: input.splitFromTaskId ?? null,
    splitIndex: input.splitIndex ?? 0,
  };
}
