/**
 * 合并番茄的成员分段切分（v4.3 §3.3 关键规则 13）。
 *
 * 分段是"某成员在这次合并番茄里花了多少时间"的唯一事实源，在 Session 终结时一次性
 * 算出、此后固定。事实来源是"用户在专注进行中逐个勾选组内成员完成"这一真实操作，
 * 因此本模块只依赖三样东西：本轮参与成员（Session.taskIds 快照，顺序即推进顺序）、
 * 每个成员被勾完成的时刻、以及本 Session 的起止与 actualDuration。
 *
 * 本模块是纯函数，不碰存储、不发 Event——放在这里是为了让"怎么切时间"这件事能被
 * 单独测试，而不必每次都跑一整条端到端计时流程。
 */

import type { IsoDateTime, TaskSegment } from '../schema';

export interface SegmentInput {
  /** 本轮参与成员，顺序即推进顺序（= Session.taskIds 终结快照）。 */
  taskIds: readonly string[];
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  /** Session 实际时长（秒）。各分段之和必须精确等于它（§3.3 一致性约束 16）。 */
  actualDuration: number;
  /** taskId → 该成员在本轮里被勾完成的时刻；没勾完成的不出现在表里。 */
  completedAt: ReadonlyMap<string, IsoDateTime>;
}

/**
 * 按 `actualDuration` 等比切分墙钟时长，保证各段之和**精确等于** `total`。
 *
 * 不直接用墙钟差值当分段时长：Session 的 `actualDuration` 与 `endedAt − startedAt`
 * 因倒计时漂移、后台节流可以不等（§3.3 关键规则 10），直接用差值会让分段之和对不上
 * Session 总时长，进而让"任务维度加总 = 全局"的对账等式失效。
 *
 * 取整余数一律并入**最后一个正数分段**，不做平均分摊（§3.3 关键规则 13）。
 */
function distribute(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  // 墙钟总长为 0（瞬间作废等）时无从按比例分，整段归第一位，其余记 0。
  if (sum <= 0) return weights.map((_, index) => (index === 0 ? total : 0));

  const shares = weights.map((weight) => Math.floor((weight * total) / sum));
  const remainder = total - shares.reduce((acc, share) => acc + share, 0);
  if (remainder !== 0) {
    const lastPositive = weights.reduce(
      (found, weight, index) => (weight > 0 ? index : found),
      0,
    );
    shares[lastPositive] = shares[lastPositive]! + remainder;
  }
  return shares;
}

/**
 * 算出一条合并 focus 终结时的成员分段。
 *
 * 切分规则：第一位成员从 Session.startedAt 起算；每当当前成员被勾完成，它的分段就地
 * 结束，下一位立刻从同一时刻接上；Session 终结时仍未完成的成员里，只有**当前正在做
 * 的那一个**吃掉剩余时间，再往后**尚未轮到**的成员一律记 0——它们既没做也没等到，
 * 不能把等待时间算给它们。中途加入的成员同理：加入时刻不是它的计时起点，只有真正
 * 轮到它才开始。
 *
 * 输出顺序即真实执行顺序：先按勾完成的时刻排已完成的，再按队列顺序排剩下的。
 */
export function computeTaskSegments(input: SegmentInput): TaskSegment[] {
  if (input.taskIds.length === 0) return [];

  const sessionStart = Date.parse(input.startedAt);
  const sessionEnd = Date.parse(input.endedAt);

  /*
   * 已完成的按勾完成时刻排序（这才是真实推进顺序——用户可能在进行中重排过未来队列）；
   * 未完成的保持队列顺序，队首就是终结那一刻的当前成员。
   */
  const done: Array<{ taskId: string; at: number }> = [];
  const pending: string[] = [];
  for (const taskId of input.taskIds) {
    const at = input.completedAt.get(taskId);
    if (at === undefined) pending.push(taskId);
    else done.push({ taskId, at: Date.parse(at) });
  }
  done.sort((left, right) => left.at - right.at || left.taskId.localeCompare(right.taskId));
  const ordered = [...done.map(({ taskId }) => taskId), ...pending];

  /*
   * 逐段推边界。cursor 是上一段的结束时刻，也就是下一段的开始时刻。
   * 勾完成时刻一律夹在 [cursor, sessionEnd] 内：既不能早于上一位的结束（否则分段
   * 会倒挂），也不能晚于 Session 终结（时钟回拨、离线补录都可能产生越界值）。
   */
  let cursor = sessionStart;
  let remainingTaken = false;
  const bounds = ordered.map((taskId) => {
    const startedAt = cursor;
    let endedAt: number;
    const completion = done.find((entry) => entry.taskId === taskId);
    if (completion !== undefined) {
      endedAt = Math.min(Math.max(completion.at, cursor), sessionEnd);
    } else if (!remainingTaken) {
      // 终结那一刻的当前成员，吃掉剩余时间。
      endedAt = sessionEnd;
      remainingTaken = true;
    } else {
      // 尚未轮到，本轮实际投入为 0。
      endedAt = cursor;
    }
    cursor = endedAt;
    return { taskId, startedAt, endedAt };
  });

  const durations = distribute(
    bounds.map(({ startedAt, endedAt }) => Math.max(0, Math.round((endedAt - startedAt) / 1000))),
    input.actualDuration,
  );

  return bounds.map((bound, index) => ({
    taskId: bound.taskId,
    startedAt: new Date(bound.startedAt).toISOString(),
    endedAt: new Date(bound.endedAt).toISOString(),
    actualDuration: durations[index]!,
  }));
}
