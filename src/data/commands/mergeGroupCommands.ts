/**
 * 合并番茄钟生命周期命令（v4.1 §3.8 + §7.19）。
 *
 * 合并组是**平等的集合关系**：几件单独都不够占一个番茄的琐事凑在一起，用一段专注
 * 同时推进，每个成员各自记一个完整的有效番茄。它与 §3.1 `parentId` 的母子从属关系
 * 是两个维度，本模块不碰子任务。
 *
 * 本模块只管成员与预估的增删改与解散；"从合并卡启动专注"属 timerCommands。
 */

import { EVENT_STORE, STORE } from '../dataStore';
import type { InitializationClock } from '../initialization/currentAppDate';
import {
  makeEvent,
  makeMergeGroup,
  type IsoDateTime,
  type MergeGroup,
  type Session,
  type Task,
} from '../schema';
import {
  executeAtomicWrite,
  type ValidatedAtomicWriteTransaction,
} from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';

/** 合并组进行中的两种在用状态；`dissolved` 之外都还挂着成员。 */
const LIVE_STATUSES = new Set<MergeGroup['status']>(['active', 'limitReached']);

function eventFields(clock: InitializationClock, correlationId: string) {
  return { now: clock.now, timezone: clock.timezone, correlationId } as const;
}

async function requireLiveGroup(
  transaction: ValidatedAtomicWriteTransaction,
  mergeGroupId: string,
): Promise<MergeGroup> {
  const group = await transaction.get<MergeGroup>(STORE.mergeGroups, mergeGroupId);
  if (!group) throw new Error('合并组不存在');
  if (!LIVE_STATUSES.has(group.status)) throw new Error('合并组已解散');
  return group;
}

/**
 * §3.8 关键规则 9 的合并资格红线：只有**从未有过任何 `type='focus'` Session 记录**
 * 的 Task 才允许被合并——不论 completed 还是 discarded，也不论那条记录是独立专注还是
 * 通过另一个合并组产生的。一旦有过一条 focus 记录，该 Task **永久**不允许再被合并。
 *
 * 这里连软删除的 Session 也一起查：软删只是同步层 tombstone，不代表"这个番茄没发生过"。
 */
async function assertMergeEligible(
  transaction: ValidatedAtomicWriteTransaction,
  taskId: string,
): Promise<Task> {
  const task = await transaction.get<Task>(STORE.tasks, taskId);
  if (!task) throw new Error('要合并的 Task 不存在');
  if (task.status !== 'active') throw new Error('只有 active Task 可以参与合并');
  if (task.mergeGroupId !== null) throw new Error('该 Task 已经在另一个合并组里');
  const sessions = await transaction.getAllIncludingDeleted<Session>(STORE.sessions);
  if (sessions.some((session) => session.type === 'focus' && session.taskIds.includes(taskId))) {
    throw new Error('已经计时过的 Task 不能再被合并');
  }
  return task;
}

/** 该合并组当前正在跑的那条 focus Session（没有则 null）。 */
async function activeSessionOf(
  transaction: ValidatedAtomicWriteTransaction,
  mergeGroupId: string,
): Promise<Session | null> {
  const sessions = await transaction.getAll<Session>(STORE.sessions);
  return sessions.find(
    (session) => session.mergeGroupId === mergeGroupId && session.status === 'active',
  ) ?? null;
}

/**
 * 把成员变化同步进正在跑的那条合并 Session。
 *
 * §3.3 关键规则 11 规定 Session.taskIds 取"终结那一刻组内本轮尚未拿 credit 的成员"，
 * 所以计时途中的增删要跟进。唯一的下限是 2：一条已经在跑的合并 Session 不能退化成
 * 单任务 Session（§3.3 字段一致性约束 15），因此成员被移到只剩 2 个以下时，这条
 * Session 保留移出前的名单——用户已经在这段时间里做过这些事，不该被抹掉。
 */
async function syncActiveSessionMembers(
  transaction: ValidatedAtomicWriteTransaction,
  mergeGroupId: string,
  nextMembers: readonly string[],
  now: IsoDateTime,
): Promise<void> {
  const session = await activeSessionOf(transaction, mergeGroupId);
  if (!session) return;
  const kept = session.taskIds.filter((taskId) => nextMembers.includes(taskId));
  const added = nextMembers.filter((taskId) => !session.taskIds.includes(taskId));
  const taskIds = [...kept, ...added];
  if (taskIds.length < 2) return;
  if (taskIds.length === session.taskIds.length && taskIds.every((id, i) => id === session.taskIds[i])) {
    return;
  }
  await transaction.put(STORE.sessions, { ...session, taskIds, updatedAt: now });
}

/** 清空一批 Task 的合并归属；解散与移出共用。 */
async function clearMembership(
  transaction: ValidatedAtomicWriteTransaction,
  taskIds: readonly string[],
  now: IsoDateTime,
): Promise<void> {
  for (const taskId of taskIds) {
    const task = await transaction.get<Task>(STORE.tasks, taskId);
    if (!task || task.mergeGroupId === null) continue;
    await transaction.put(STORE.tasks, { ...task, mergeGroupId: null, updatedAt: now });
  }
}

const MERGE_STORES = [STORE.tasks, STORE.sessions, STORE.mergeGroups, EVENT_STORE] as const;

/**
 * 新建合并组：把 ≥ 2 个都还没计时过的任务并到一起（§7.19 mergeGroup.created）。
 * MergeGroup 必须先于 Task 落库——Task.mergeGroupId 的校验要求合并组的 taskIds 回指本 Task。
 */
export async function createMergeGroup(
  input: InitializationClock & { taskIds: readonly string[] },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', operation: 'create' },
    },
    async (transaction) => {
      if (input.taskIds.length < 2) throw new Error('合并组至少需要 2 个任务');
      if (new Set(input.taskIds).size !== input.taskIds.length) {
        throw new Error('合并成员不得重复');
      }
      for (const taskId of input.taskIds) await assertMergeEligible(transaction, taskId);

      const group = makeMergeGroup({ now: input.now, taskIds: [...input.taskIds] });
      await transaction.put(STORE.mergeGroups, group);
      for (const taskId of group.taskIds) {
        const task = await transaction.get<Task>(STORE.tasks, taskId);
        await transaction.put(STORE.tasks, { ...task!, mergeGroupId: group.id, updatedAt: input.now });
      }
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.created',
          mergeGroupId: group.id,
          payload: { taskIds: [...group.taskIds], estimatedPomodoros: group.estimatedPomodoros },
        }),
      );
      return { value: group, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 往已有合并组追加一个成员（§7.19 mergeGroup.taskAdded）。
 * 可以发生在计时开始前，也可以发生在专注进行中（`source='duringActiveSession'`），
 * 但仅限从未开始过计时的任务。
 */
export async function addTaskToMergeGroup(
  input: InitializationClock & {
    mergeGroupId: string;
    taskId: string;
    source: 'drag' | 'duringActiveSession';
  },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', entityId: input.mergeGroupId, operation: 'update' },
    },
    async (transaction) => {
      const group = await requireLiveGroup(transaction, input.mergeGroupId);
      const task = await assertMergeEligible(transaction, input.taskId);

      const taskIds = [...group.taskIds, task.id];
      const updated: MergeGroup = { ...group, taskIds, updatedAt: input.now };
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.put(STORE.tasks, { ...task, mergeGroupId: group.id, updatedAt: input.now });
      await syncActiveSessionMembers(transaction, group.id, taskIds, input.now);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.taskAdded',
          mergeGroupId: group.id,
          taskId: task.id,
          payload: { addedAtIndex: taskIds.length - 1, source: input.source },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 单个成员退出合并组（§7.19 mergeGroup.taskRemoved）。
 * 移出后剩余成员 ≤ 1 时按 §3.8 关键规则 2 自动解散，两条事件共享 correlationId。
 */
export async function removeTaskFromMergeGroup(
  input: InitializationClock & {
    mergeGroupId: string;
    taskId: string;
    reason: 'manualUnmerge' | 'sessionEndedIncomplete';
  },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', entityId: input.mergeGroupId, operation: 'update' },
    },
    async (transaction) => {
      const group = await requireLiveGroup(transaction, input.mergeGroupId);
      const removedAtIndex = group.taskIds.indexOf(input.taskId);
      if (removedAtIndex < 0) throw new Error('该 Task 不在此合并组中');

      const remaining = group.taskIds.filter((taskId) => taskId !== input.taskId);
      const dissolving = remaining.length <= 1;
      const updated: MergeGroup = dissolving
        ? {
            ...group,
            taskIds: remaining,
            status: 'dissolved',
            dissolvedAt: input.now,
            dissolvedReason: 'membersBelowMinimum',
            updatedAt: input.now,
          }
        : { ...group, taskIds: remaining, updatedAt: input.now };
      await transaction.put(STORE.mergeGroups, updated);
      await clearMembership(transaction, dissolving ? group.taskIds : [input.taskId], input.now);
      await syncActiveSessionMembers(transaction, group.id, remaining, input.now);

      const common = eventFields(input, transaction.correlationId);
      await transaction.appendEvent(
        makeEvent({
          ...common,
          type: 'mergeGroup.taskRemoved',
          mergeGroupId: group.id,
          taskId: input.taskId,
          payload: { removedAtIndex, reason: input.reason },
        }),
      );
      if (dissolving) {
        await transaction.appendEvent(
          makeEvent({
            ...common,
            type: 'mergeGroup.dissolved',
            mergeGroupId: group.id,
            payload: { finalTaskIds: remaining, dissolvedReason: 'membersBelowMinimum' },
          }),
        );
      }
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 调整成员在合并卡片内的先后顺序（§7.19 mergeGroup.reordered）。
 * 只重排 taskIds，不改成员归属，不触发 taskAdded / taskRemoved。
 */
export async function reorderMergeGroupMember(
  input: InitializationClock & { mergeGroupId: string; fromIndex: number; toIndex: number },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', entityId: input.mergeGroupId, operation: 'update' },
    },
    async (transaction) => {
      const group = await requireLiveGroup(transaction, input.mergeGroupId);
      const upper = group.taskIds.length - 1;
      for (const [label, index] of [['fromIndex', input.fromIndex], ['toIndex', input.toIndex]] as const) {
        if (!Number.isInteger(index) || index < 0 || index > upper) {
          throw new Error(`${label} 必须是 0–${upper} 的整数`);
        }
      }
      if (input.fromIndex === input.toIndex) throw new Error('排序起止位置必须不同');

      const taskIds = [...group.taskIds];
      const [taskId] = taskIds.splice(input.fromIndex, 1);
      taskIds.splice(input.toIndex, 0, taskId!);
      const updated: MergeGroup = { ...group, taskIds, updatedAt: input.now };
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.reordered',
          mergeGroupId: group.id,
          taskId: taskId!,
          payload: { fromIndex: input.fromIndex, toIndex: input.toIndex },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 追加预估番茄（§7.19 mergeGroup.estimateAdjusted）。
 * 数值上限与轮次上限完全照搬 §3.1 Task 规则：1–7 封顶、最多三轮。
 * `status='limitReached'` 时**强阻断**（§3.8 关键规则 6、字段一致性约束 7）：
 * 必须先移出剩余未完成成员或整体解散才能解开，关掉提示不解除阻塞。
 */
export async function adjustMergeGroupEstimate(
  input: InitializationClock & { mergeGroupId: string; estimatedPomodoros: number },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', entityId: input.mergeGroupId, operation: 'update' },
    },
    async (transaction) => {
      const group = await requireLiveGroup(transaction, input.mergeGroupId);
      if (group.status === 'limitReached') {
        throw new Error('合并组已达上限，必须先移出剩余成员或整体解散');
      }
      const round = group.estimateRounds.length + 1;
      if (round !== 2 && round !== 3) throw new Error('合并组预估最多三轮');
      if (
        !Number.isInteger(input.estimatedPomodoros) ||
        input.estimatedPomodoros < 1 ||
        input.estimatedPomodoros > 7
      ) {
        throw new Error('合并组总预估必须是 1–7 的整数');
      }
      if (input.estimatedPomodoros === group.estimatedPomodoros) {
        throw new Error('追加预估必须改变总预估番茄数');
      }

      const updated: MergeGroup = {
        ...group,
        estimatedPomodoros: input.estimatedPomodoros,
        estimateRounds: [
          ...group.estimateRounds,
          { index: round, pomodoros: input.estimatedPomodoros, occurredAt: input.now },
        ],
        updatedAt: input.now,
      };
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.estimateAdjusted',
          mergeGroupId: group.id,
          payload: {
            round,
            oldEstimate: group.estimatedPomodoros,
            newEstimate: input.estimatedPomodoros,
          },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 用户主动整体解散（§7.19 mergeGroup.dissolved，`dissolvedReason='manualDissolved'`）。
 * 只清空成员的合并归属，**不改变任务在今日待办 / 活动清单的归属，也不删除任务**
 * （§3.8 关键规则 5）；已解散的合并组历史记录保留，不写 deletedAt（关键规则 7）。
 */
export async function dissolveMergeGroup(
  input: InitializationClock & { mergeGroupId: string },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', entityId: input.mergeGroupId, operation: 'update' },
    },
    async (transaction) => {
      const group = await requireLiveGroup(transaction, input.mergeGroupId);
      const updated: MergeGroup = {
        ...group,
        status: 'dissolved',
        dissolvedAt: input.now,
        dissolvedReason: 'manualDissolved',
        updatedAt: input.now,
      };
      await transaction.put(STORE.mergeGroups, updated);
      await clearMembership(transaction, group.taskIds, input.now);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.dissolved',
          mergeGroupId: group.id,
          payload: { finalTaskIds: [...group.taskIds], dissolvedReason: 'manualDissolved' },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}
