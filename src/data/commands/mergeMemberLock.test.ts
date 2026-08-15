/**
 * 活动 focus Session 对执行对象的锁定（v4.3 §3.3 关键规则 14、红线 27）。
 *
 * 产品**没有暂停态**：focus 只有 active / completed / discarded，中途终止一律作废。
 * 因此"正在跑的任务"必须由数据层锁住——不能一边保持 Session active，一边把当前
 * 任务删掉或改预估。这些拒绝必须落在 command 层，不能只靠 UI 隐藏按钮。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dataStore, STORE } from '../dataStore';
import type { Session, Task } from '../schema';
import {
  adjustTaskEstimate,
  archiveCompletedTask,
  completeTaskManually,
  createManualTask,
  deleteActiveTask,
  splitTask,
  uncompleteTask,
} from './taskCommands';
import { createMergeGroup } from './mergeGroupCommands';
import {
  completeFocus,
  completeTaskFromPomodoro,
  discardFocus,
  skipPendingBreak,
  startFocus,
  startMergeGroupFocus,
} from './timerCommands';

const TIMEZONE = 'Asia/Shanghai';
let tick = 0;
const at = () => {
  const minutes = tick++;
  const hour = 9 + Math.floor(minutes / 60);
  return `2026-11-03T${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+08:00`;
};
const clock = () => ({ now: at(), timezone: TIMEZONE });

/** 建一个活动清单里的任务（不进今日待办，好让软删除这条路走得通）。 */
async function activityTask(title: string): Promise<Task> {
  return (await createManualTask({ ...clock(), title, destination: 'list' })).value;
}

/**
 * fake-indexeddb 在同一个测试文件内不重置。上一个用例遗留的 active Session 会让
 * 下一轮 startFocus 直接撞上 assertNoActiveSession，遗留的"待开始休息"同样会挡路，
 * 所以每个用例前先把两者都收掉——先作废还开着的，再跳过悬着的休息机会。
 */
async function resetTimerState(): Promise<void> {
  for (const session of await dataStore.getAll<Session>(STORE.sessions)) {
    if (session.status === 'active') {
      await discardFocus({ ...clock(), sessionId: session.id, actualDuration: 60 })
        .catch(() => undefined);
    }
  }
  for (const session of await dataStore.getAll<Session>(STORE.sessions)) {
    if (session.type === 'focus' && session.status === 'completed') {
      await skipPendingBreak({ ...clock(), sourceFocusSessionId: session.id }).catch(() => undefined);
    }
  }
}

describe('活动 focus 锁定当前执行对象（§3.3 关键规则 14）', () => {
  beforeEach(resetTimerState);

  it('计时中不能删除当前任务，也不能从计划页改预估', async () => {
    const task = await activityTask('正在做的事');
    await startFocus({ ...clock(), taskId: task.id });

    await expect(deleteActiveTask({ ...clock(), taskId: task.id }))
      .rejects.toThrow('正在计时中');
    await expect(adjustTaskEstimate({ ...clock(), taskId: task.id, estimatedPomodoros: 3 }))
      .rejects.toThrow('正在计时中');
  });

  it('作废当前番茄后立刻解锁，任务恢复普通可编辑状态', async () => {
    const task = await activityTask('半路放弃');
    const session = (await startFocus({ ...clock(), taskId: task.id })).value;

    await discardFocus({ ...clock(), sessionId: session.id, actualDuration: 300 });

    // 产品没有暂停：中途终止就是作废，作废之后这个任务就是普通任务了。
    const adjusted = await adjustTaskEstimate({
      ...clock(), taskId: task.id, estimatedPomodoros: 2,
    });
    expect(adjusted.value.estimatedPomodoros).toBe(2);
    await expect(deleteActiveTask({ ...clock(), taskId: task.id })).resolves.toBeDefined();
  });

  it('正常到点 completed 之后也解锁（重新预估走正式流程，不再被守卫挡住）', async () => {
    const task = await activityTask('做完一轮');
    const session = (await startFocus({ ...clock(), taskId: task.id })).value;

    await completeFocus({ ...clock(), sessionId: session.id, actualDuration: 1500 });

    const adjusted = await adjustTaskEstimate({
      ...clock(), taskId: task.id, estimatedPomodoros: 2,
    });
    expect(adjusted.value.estimatedPomodoros).toBe(2);
  });

  it('锁只锁当前那一个任务，不误伤别的任务', async () => {
    const [running, bystander] = [await activityTask('在跑'), await activityTask('没在跑')];
    await startFocus({ ...clock(), taskId: running.id });

    const adjusted = await adjustTaskEstimate({
      ...clock(), taskId: bystander.id, estimatedPomodoros: 4,
    });
    expect(adjusted.value.estimatedPomodoros).toBe(4);
  });

  it('计时中不能从清单手动完成当前任务', async () => {
    const task = await activityTask('正在做的事');
    await startFocus({ ...clock(), taskId: task.id });
    await expect(completeTaskManually({ ...clock(), taskId: task.id }))
      .rejects.toThrow('正在计时中');
  });

  it('合并专注中不能从清单手动完成当前或未来成员，也不能取消已完成成员', async () => {
    const [a, b, c] = [
      await activityTask('当前成员'),
      await activityTask('未来一'),
      await activityTask('未来二'),
    ];
    const group = (await createMergeGroup({
      ...clock(), taskIds: [a.id, b.id, c.id],
    })).value;
    const session = (await startMergeGroupFocus({
      ...clock(), mergeGroupId: group.id,
    })).value;

    await expect(completeTaskManually({ ...clock(), taskId: a.id }))
      .rejects.toThrow('正在计时中');
    await expect(completeTaskManually({ ...clock(), taskId: b.id }))
      .rejects.toThrow('合并专注进行中不能从清单手动完成成员');

    await completeTaskFromPomodoro({ ...clock(), sessionId: session.id, taskId: a.id });
    await expect(uncompleteTask({ ...clock(), taskId: a.id }))
      .rejects.toThrow('仍在本轮合并专注快照中');
    await expect(archiveCompletedTask({ ...clock(), taskId: a.id }))
      .rejects.toThrow('仍在本轮合并专注快照中');
    const next = await completeTaskFromPomodoro({
      ...clock(), sessionId: session.id, taskId: b.id,
    });
    expect(next.value.id).toBe(b.id);
  });

  it('计时中不能拆分当前任务；合并组成员无论是否当前成员都不能拆分', async () => {
    const running = await activityTask('正在拆的独立任务');
    await startFocus({ ...clock(), taskId: running.id });
    await expect(splitTask({
      ...clock(), taskId: running.id, newTitle: '不该留下的后继', estimatedPomodoros: 1,
    })).rejects.toThrow('正在计时中');

    const [a, b] = [await activityTask('合并拆A'), await activityTask('合并拆B')];
    await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] });
    await expect(splitTask({
      ...clock(), taskId: a.id, newTitle: '不该拆的成员', estimatedPomodoros: 1,
    })).rejects.toThrow('合并组成员不能拆分');
    await expect(splitTask({
      ...clock(), taskId: b.id, newTitle: '不该拆的未来成员', estimatedPomodoros: 1,
    })).rejects.toThrow('合并组成员不能拆分');
  });
});
