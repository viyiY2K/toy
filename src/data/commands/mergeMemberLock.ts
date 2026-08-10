/**
 * 活动 focus Session 对其执行对象的锁定（v4.3 §3.3 关键规则 14、§3.8 关键规则 13/15）。
 *
 * 这条约束必须落在数据层的每一条 write path 上，**不能只靠 UI 隐藏按钮**——所以把
 * "谁被锁住了"的判定集中在这里，由 taskCommands / mergeGroupCommands / timerCommands
 * 共同复用，避免每个入口各写一份、漏掉一个就出现绕过口子。
 */

import { STORE } from '../dataStore';
import type { Session, Task } from '../schema';

/** 本模块只需要事务的读能力；这样 command 层传什么事务对象进来都能用。 */
interface ReadableTransaction {
  get<T>(store: string, id: string): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
}

/** 当前正在跑的那条标准 focus（没有则 null）。产品同一时刻只允许一条 active Session。 */
export async function activeFocusSession(
  transaction: ReadableTransaction,
): Promise<Session | null> {
  const sessions = await transaction.getAll<Session>(STORE.sessions);
  return sessions.find((session) => session.type === 'focus' && session.status === 'active') ?? null;
}

/**
 * 本轮的**当前成员**：按推进顺序第一个尚未完成的参与成员。
 *
 * 不能用字面上的 `taskIds[0]` —— 本轮中途被勾完成的成员仍然留在快照里（它们要拿自己
 * 那段时间），队首很可能已经是个完成态的历史成员了。
 */
export async function currentMergeMemberId(
  transaction: ReadableTransaction,
  session: Session,
): Promise<string | null> {
  for (const taskId of session.taskIds) {
    const task = await transaction.get<Task>(STORE.tasks, taskId);
    if (task && task.status !== 'completed') return taskId;
  }
  return null;
}

/**
 * 该 Task 此刻是否被一条 active focus 锁住。
 *
 * 独立专注锁它引用的那个 Task；合并专注只锁**当前成员**——当前成员之后、尚未轮到的
 * 未来成员不受锁定，可以自由增删和在未来队列内部排序（§3.3 关键规则 14）。
 */
export async function lockedTaskId(transaction: ReadableTransaction): Promise<string | null> {
  const session = await activeFocusSession(transaction);
  if (!session) return null;
  if (session.mergeGroupId === null) return session.taskIds[0] ?? null;
  return currentMergeMemberId(transaction, session);
}

/**
 * 锁定期间拒绝改变执行对象的普通写入（删除、预估调整、移出组、换位、整体解散……）。
 *
 * 解除锁定只有两条路（§3.3 关键规则 14）：当前 focus 被作废为 discarded，或正常到点
 * 成为 completed 后走正式的收尾 / 重新预估流程。产品没有暂停态，中途终止一律作废。
 */
export async function assertTaskNotLocked(
  transaction: ReadableTransaction,
  taskId: string,
  action: string,
): Promise<void> {
  if ((await lockedTaskId(transaction)) === taskId) {
    throw new Error(`${action}：该任务正在计时中，请先作废当前番茄或等它到点`);
  }
}
