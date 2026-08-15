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
import { currentMergeMemberId } from './mergeMemberLock';
import { MERGE_GROUP_TITLE_MAX_LENGTH } from '../schema/mergeGroup';

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
  /*
   * completed 与 dissolved 都是终态（红线 28）：之后一律不许再增删成员、重排、
   * 追加预估或开新一轮。两者语义不同，报错文案也分开，免得把"做完了"说成"被拆散了"。
   */
  if (group.status === 'completed') throw new Error('合并组已完成，不能再改动');
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
 * §3.3 关键规则 11：Session.taskIds 取"终结那一刻组内本轮尚未拿 credit 的成员"，
 * 所以计时途中未来队列的增删要跟进。
 *
 * **旧设计（成员可任意同步、移空时保留旧名单）已作废**（红线 27）：现在当前成员被
 * 锁死，根本走不到"移空"这一步——调用方在改动前就必须先过 `assertMemberEditable`，
 * 当前成员的移出 / 换位一律被拒。这里只负责把合法的未来队列变化落到快照上，顺序
 * 一律以 MergeGroup.taskIds 为准（它就是推进顺序，决定分段怎么切）。
 */
async function syncActiveSessionMembers(
  transaction: ValidatedAtomicWriteTransaction,
  mergeGroupId: string,
  nextMembers: readonly string[],
  now: IsoDateTime,
): Promise<void> {
  const session = await activeSessionOf(transaction, mergeGroupId);
  if (!session) return;
  /*
   * 本轮之前就已完成的成员不进快照（它们早在那一轮拿过 credit，§3.3 关键规则 11）。
   * 判据：已经在快照里的一律留下（含本轮中途才勾完成的，它们要拿自己那段时间）；
   * 组里新来的必须是未完成的——合并资格要求新成员从未计时过，天然满足。
   */
  const participants: string[] = [];
  for (const taskId of nextMembers) {
    if (session.taskIds.includes(taskId)) {
      participants.push(taskId);
      continue;
    }
    const task = await transaction.get<Task>(STORE.tasks, taskId);
    if (task && task.status !== 'completed') participants.push(taskId);
  }
  if (participants.length < 1) return;
  if (
    participants.length === session.taskIds.length &&
    participants.every((id, index) => id === session.taskIds[index])
  ) {
    return;
  }
  await transaction.put(STORE.sessions, { ...session, taskIds: participants, updatedAt: now });
}

/**
 * 锁定校验：active 合并 focus 期间只开放**未来队列**的编辑（红线 27、§3.8 关键规则 13）。
 *
 * 被拒绝的动作：移出当前成员、给当前成员换位、把未来成员排到当前成员之前、以及
 * 整体解散（解散会连带清空当前成员的归属，等于绕过锁定）。
 * 放行的动作：未来成员的新增、移出，以及未来队列**内部**的相互排序。
 */
async function assertMemberEditable(
  transaction: ValidatedAtomicWriteTransaction,
  group: MergeGroup,
  taskIds: readonly string[],
  action: string,
): Promise<void> {
  const session = await activeSessionOf(transaction, group.id);
  if (!session) return;
  const current = await currentMergeMemberId(transaction, session);
  if (current !== null && taskIds.includes(current)) {
    throw new Error(`${action}：该任务正在本轮合并番茄里执行，请先作废当前番茄或等它到点`);
  }
}

/** 当前成员在组内的下标；没有 active 轮或全部完成时为 -1（此时不设排序下限）。 */
async function currentMemberIndex(
  transaction: ValidatedAtomicWriteTransaction,
  group: MergeGroup,
): Promise<number> {
  const session = await activeSessionOf(transaction, group.id);
  if (!session) return -1;
  const current = await currentMergeMemberId(transaction, session);
  return current === null ? -1 : group.taskIds.indexOf(current);
}

/** 清空一批 Task 的合并归属；解散与移出共用。 */
async function clearMembership(
  transaction: ValidatedAtomicWriteTransaction,
  taskIds: readonly string[],
  now: IsoDateTime,
): Promise<void> {
  for (const taskId of taskIds) {
    const task = await transaction.getIncludingDeleted<Task>(STORE.tasks, taskId);
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
  input: InitializationClock & { taskIds: readonly string[]; title?: string },
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

      const group = makeMergeGroup({
        now: input.now,
        taskIds: [...input.taskIds],
        title: input.title,
      });
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
          payload: {
            title: group.title,
            taskIds: [...group.taskIds],
            estimatedPomodoros: group.estimatedPomodoros,
          },
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
 * 移出一批成员的共用实现（§7.19 mergeGroup.taskRemoved）。
 *
 * 逐个发 `taskRemoved`（组整体解散那条路径由 `mergeGroup.dissolved` 统一记录，不逐个发，
 * 见 §7.19 说明）；移完后剩余 ≤ 1 时按 §3.8 关键规则 2 自动解散，全部事件共享
 * 同一个 correlationId。`removedAtIndex` 取**移出那一刻**该成员在 taskIds 中的下标，
 * 所以要一边移一边算，不能先算完再批量移。
 */
async function removeMembers(
  transaction: ValidatedAtomicWriteTransaction,
  clock: InitializationClock,
  group: MergeGroup,
  taskIds: readonly string[],
  reason: 'manualUnmerge' | 'sessionEndedIncomplete',
): Promise<MergeGroup> {
  const common = eventFields(clock, transaction.correlationId);
  let remaining = [...group.taskIds];
  const removals: Array<{ taskId: string; removedAtIndex: number }> = [];
  for (const taskId of taskIds) {
    const removedAtIndex = remaining.indexOf(taskId);
    if (removedAtIndex < 0) throw new Error('该 Task 不在此合并组中');
    remaining = remaining.filter((candidate) => candidate !== taskId);
    removals.push({ taskId, removedAtIndex });
  }

  /*
   * 成员掉到 ≤ 1 时按 §3.8 关键规则 2 自动解散——但**本轮 Session 还在跑时要推迟**。
   *
   * 用户已明确拍板：成员数量不足不打断正在进行的 Session，只阻止下一轮的开始。立刻
   * 解散会连带清空当前成员的 mergeGroupId，等于用"移出最后一个未来成员"绕过当前
   * 成员锁定；也会造出"组已 dissolved、但 Task.mergeGroupId 还挂着"的中间态。
   * 因此这里保持 active，把解散推到 Session 终结后的结算（见 settleMergeGroupRound）。
   */
  const hasActiveRound = (await activeSessionOf(transaction, group.id)) !== null;
  const dissolving = remaining.length <= 1 && !hasActiveRound;
  const updated: MergeGroup = dissolving
    ? {
        ...group,
        taskIds: remaining,
        status: 'dissolved',
        dissolvedAt: clock.now,
        dissolvedReason: 'membersBelowMinimum',
        updatedAt: clock.now,
      }
    : { ...group, taskIds: remaining, updatedAt: clock.now };
  if (dissolving) {
    await clearMembership(transaction, group.taskIds, clock.now);
    await transaction.put(STORE.mergeGroups, updated);
  } else {
    await transaction.put(STORE.mergeGroups, updated);
    await clearMembership(transaction, taskIds, clock.now);
  }
  await syncActiveSessionMembers(transaction, group.id, remaining, clock.now);

  for (const { taskId, removedAtIndex } of removals) {
    await transaction.appendEvent(
      makeEvent({
        ...common,
        type: 'mergeGroup.taskRemoved',
        mergeGroupId: group.id,
        taskId,
        payload: { removedAtIndex, reason },
      }),
    );
  }
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
  return updated;
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
      // 红线 27：当前成员移不得；未来成员随便移。
      await assertMemberEditable(transaction, group, [input.taskId], '无法移出该成员');
      const updated = await removeMembers(transaction, input, group, [input.taskId], input.reason);
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
      /*
       * 红线 27：active 轮期间当前成员不能换位，未来成员也不能被排到它之前——顺序就是
       * 推进顺序，动了它就等于换掉正在执行的对象。未来队列内部怎么排都行。
       */
      const currentIndex = await currentMemberIndex(transaction, group);
      if (currentIndex >= 0) {
        await assertMemberEditable(
          transaction,
          group,
          [group.taskIds[input.fromIndex]!],
          '无法给该成员换位',
        );
        if (input.toIndex <= currentIndex) {
          throw new Error('无法排到当前正在执行的成员之前');
        }
      }

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

/** 组内此刻仍未完成的成员（已完成的留在组里，只是不再计入后续轮次）。 */
async function unfinishedMembers(
  transaction: ValidatedAtomicWriteTransaction,
  group: MergeGroup,
): Promise<string[]> {
  const unfinished: string[] = [];
  for (const taskId of group.taskIds) {
    const task = await transaction.get<Task>(STORE.tasks, taskId);
    if (task && task.status !== 'completed') unfinished.push(taskId);
  }
  return unfinished;
}

/**
 * 番茄到点、用户选「结束」（§3.8 关键规则 4 的第一个分叉）。
 *
 * 组内**未完成**的成员逐个退出组、`mergeGroupId` 清空、保持 `status='active'`，
 * 作为独立任务回到今日待办 / 活动清单；**已完成**的成员不受影响，继续留在组里作为
 * 这个合并组的历史成员。移出后剩余成员 ≤ 1 时按关键规则 2 自动解散。
 *
 * 组内全部成员都已完成时没有可移出的人，本命令是 no-op（不产生事件）。
 */
export async function endMergeGroupRound(
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
      const unfinished = await unfinishedMembers(transaction, group);
      if (unfinished.length === 0) {
        return { value: group, correlationId: transaction.correlationId };
      }
      const updated = await removeMembers(
        transaction,
        input,
        group,
        unfinished,
        'sessionEndedIncomplete',
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 本轮结束后的成员数结算（承接 `removeMembers` 里被推迟的自动解散）。
 *
 * 用户已明确拍板：成员数量不足**不打断**正在进行的 Session，只阻止下一轮开始。所以
 * "移出最后一个未来成员"当场只更新名单、不解散；等本轮 focus 终结（completed 或
 * discarded）后由本命令收口——此时组里若仍不足 2 个成员，按 `membersBelowMinimum`
 * 解散，当前 Task 回到独立任务。
 *
 * 组内已经没有未完成成员时不在此处理：那要么走 `completeMergeGroup`（用户确认整组
 * 做完），要么保持 active 等用户再往里加任务。本命令在条件不满足时是 no-op。
 */
export async function settleMergeGroupRound(
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
      const unfinished = await unfinishedMembers(transaction, group);
      if (
        group.taskIds.length > 1 ||
        unfinished.length === 0 ||
        (await activeSessionOf(transaction, group.id)) !== null
      ) {
        return { value: group, correlationId: transaction.correlationId };
      }

      const updated: MergeGroup = {
        ...group,
        taskIds: [],
        status: 'dissolved',
        dissolvedAt: input.now,
        dissolvedReason: 'membersBelowMinimum',
        updatedAt: input.now,
      };
      await clearMembership(transaction, group.taskIds, input.now);
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.dissolved',
          mergeGroupId: group.id,
          payload: { finalTaskIds: [], dissolvedReason: 'membersBelowMinimum' },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 转入硬上限阻塞态并提示（§3.8 关键规则 6、§7.15 `promptType='mergeGroupLimitReached'`）。
 *
 * 触发条件：三轮预估用满，或该组已完成的 focus 轮次达到 7 次，且组内仍有未完成成员。
 * 转入后**强阻断**——不允许追加预估、不允许开启新一轮，必须移出剩余未完成成员或整体
 * 解散才能解开；用户关掉提示**不解除阻塞**（与 §3.1 `taskSplitSuggestion` 同为强阻断
 * 语义）。由计时页在收尾选择前调用；条件不满足时是 no-op，不产生事件。
 */
export async function markMergeGroupLimitReached(
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
      const unfinished = await unfinishedMembers(transaction, group);
      const sessions = await transaction.getAllIncludingDeleted<Session>(STORE.sessions);
      const completedRounds = sessions.filter(
        (session) => session.mergeGroupId === group.id && session.status === 'completed',
      ).length;
      const capped = group.estimateRounds.length >= 3 || completedRounds >= 7;
      if (group.status === 'limitReached' || unfinished.length === 0 || !capped) {
        return { value: group, correlationId: transaction.correlationId };
      }

      const updated: MergeGroup = { ...group, status: 'limitReached', updatedAt: input.now };
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'prompt.shown',
          mergeGroupId: group.id,
          payload: { promptType: 'mergeGroupLimitReached', promptContext: null },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 给合并组改名（§7.19 mergeGroup.renamed）。
 *
 * 新口径下合并组本身是番茄与专注时长的归属单位，会作为独立条目出现在统计与历史列表，
 * 因此需要一个用户可读、可自定义的名字来区分不同的组。改名不影响成员归属、预估、
 * 状态与任何统计数值；已终结（completed / dissolved）的组仍可改名——那只是给历史
 * 记录换个标签，不是修改业务事实。
 */
export async function renameMergeGroup(
  input: InitializationClock & { mergeGroupId: string; title: string },
): Promise<TaskCommandResult<MergeGroup>> {
  return executeAtomicWrite(
    {
      storeNames: MERGE_STORES,
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: { entityType: 'MergeGroup', entityId: input.mergeGroupId, operation: 'update' },
    },
    async (transaction) => {
      const group = await transaction.get<MergeGroup>(STORE.mergeGroups, input.mergeGroupId);
      if (!group) throw new Error('合并组不存在');
      const title = input.title.trim();
      if (title === '') throw new Error('合并组名称不能为空');
      if (title.length > MERGE_GROUP_TITLE_MAX_LENGTH) {
        throw new Error(`合并组名称不能超过 ${MERGE_GROUP_TITLE_MAX_LENGTH} 字`);
      }
      if (title === group.title) throw new Error('新名称必须与旧名称不同');

      const updated: MergeGroup = { ...group, title, updatedAt: input.now };
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.renamed',
          mergeGroupId: group.id,
          payload: { oldTitle: group.title, newTitle: title },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/**
 * 用户确认"这一组杂事做完了"（§7.19 mergeGroup.completed，§3.8 成功终态）。
 *
 * 与 `dissolved` 是两回事（红线 28）：`completed` 是**成功**终态，配 `completedAt`；
 * `dissolved` 只表示中途拆散 / 取消合并。两者都是终态，之后一律不许再增删成员、
 * 重排、追加预估或开新一轮（由 `requireLiveGroup` 统一挡掉）。
 *
 * 必须点名触发确认的刚收尾合并 focus Session，并把它写进 Event 顶层 `sessionId`。
 * `validFocusCountAtCompletion` 记这一组完成时累计拿到的有效番茄数——注意它是**组**
 * 的番茄数（每条正常完成的合并 Session 记 1 个），不是任何成员的番茄数（成员恒为 0）。
 * 这样 MergeGroup 的预估准确率就能复用独立 Task 那套算法，不必另写一份。
 * 完成允许仍有未完成成员；事件保存 final/incomplete 两份当时快照。为让逐笔 validator
 * 只看到合法状态，事务内先清空全部 Task 的当前归属指针，再写 Group 终态与 Event；
 * 绝不改变 Task 自身状态，也不追加 task.* Event。
 */
export async function completeMergeGroup(
  input: InitializationClock & { mergeGroupId: string; sessionId: string },
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
      if ((await activeSessionOf(transaction, group.id)) !== null) {
        throw new Error('本轮合并专注还在进行中，无法确认完成');
      }
      const triggeringSession = await transaction.get<Session>(STORE.sessions, input.sessionId);
      if (
        !triggeringSession ||
        triggeringSession.type !== 'focus' ||
        triggeringSession.status !== 'completed' ||
        triggeringSession.mergeGroupId !== group.id
      ) {
        throw new Error('完成确认必须关联本组合并 focus 的刚收尾 Session');
      }
      const unfinished = await unfinishedMembers(transaction, group);
      const sessions = await transaction.getAll<Session>(STORE.sessions);
      const validFocusCountAtCompletion = sessions.filter(
        (session) =>
          session.type === 'focus' &&
          session.status === 'completed' &&
          session.mergeGroupId === group.id,
      ).length;

      const updated: MergeGroup = {
        ...group,
        status: 'completed',
        completedAt: input.now,
        updatedAt: input.now,
      };
      /*
       * 终态前先清空全部“当前所属”指针，再写 Group 终态，确保两边的逐笔 validator
       * 都只看到合法状态；外部仍只会看到整个事务一次提交，不存在可观察的中间态。
       */
      await clearMembership(transaction, group.taskIds, input.now);
      await transaction.put(STORE.mergeGroups, updated);
      await transaction.appendEvent(
        makeEvent({
          ...eventFields(input, transaction.correlationId),
          type: 'mergeGroup.completed',
          mergeGroupId: group.id,
          sessionId: triggeringSession.id,
          payload: {
            completedAt: input.now,
            validFocusCountAtCompletion,
            finalTaskIds: [...group.taskIds],
            incompleteTaskIds: unfinished,
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
      /*
       * 红线 27：不允许用"整体解散"绕过当前成员锁定——解散会清空全部成员的归属，
       * 当前成员也在其中。本轮跑完（正常到点或作废）才能解散。
       */
      await assertMemberEditable(transaction, group, group.taskIds, '无法解散合并组');
      const updated: MergeGroup = {
        ...group,
        status: 'dissolved',
        dissolvedAt: input.now,
        dissolvedReason: 'manualDissolved',
        updatedAt: input.now,
      };
      await clearMembership(transaction, group.taskIds, input.now);
      await transaction.put(STORE.mergeGroups, updated);
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
