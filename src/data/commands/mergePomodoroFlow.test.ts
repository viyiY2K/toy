/**
 * 合并番茄钟的端到端流程（v4.1 §3.3 关键规则 5/11/12、§3.8 关键规则 4/6、§8.3/§8.5）。
 * 覆盖交底文档第 3 节的核心产品规则：整体编号、各记一个番茄、到点二选一、硬上限阻断。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { loadCurrentTaskViews } from '../queries/currentTaskViews';
import type { Event, MergeGroup, Session, Task } from '../schema';
import {
  adjustMergeGroupEstimate,
  createMergeGroup,
  endMergeGroupRound,
  markMergeGroupLimitReached,
} from './mergeGroupCommands';
import { createManualTask } from './taskCommands';
import {
  completeFocus,
  completeTaskFromPomodoro,
  skipPendingBreak,
  startMergeGroupFocus,
} from './timerCommands';

const TIMEZONE = 'Asia/Shanghai';
let tick = 0;
const at = () => {
  const minutes = tick++;
  const hour = 9 + Math.floor(minutes / 60);
  return `2026-11-02T${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+08:00`;
};

const clock = () => ({ now: at(), timezone: TIMEZONE });

async function chore(title: string): Promise<Task> {
  return (await createManualTask({ ...clock(), title, destination: 'today' })).value;
}

async function taskById(id: string): Promise<Task> {
  return (await dataStore.get<Task>(STORE.tasks, id))!;
}

async function groupById(id: string): Promise<MergeGroup> {
  return (await dataStore.get<MergeGroup>(STORE.mergeGroups, id))!;
}

async function allEvents(): Promise<Event[]> {
  return dataStore.getAll<Event>(EVENT_STORE);
}

/**
 * fake-indexeddb 在同一个测试文件内不重置，上一个用例遗留的"待开始休息"会挡住
 * 下一轮 focus（assertNoOpenBreakOpportunity）。每个用例前先把悬着的休息机会收掉。
 */
async function settleOpenBreaks(): Promise<void> {
  const [sessions, events] = await Promise.all([
    dataStore.getAll<Session>(STORE.sessions),
    allEvents(),
  ]);
  const breakSources = new Set(
    sessions
      .filter((session) => session.type === 'shortBreak' || session.type === 'longBreak')
      .map((session) => session.sourceFocusSessionId),
  );
  const workEnded = new Set(
    events.flatMap((event) =>
      event.type === 'dayPlan.workEnded' && event.payload.endedAfterFocusSessionId !== null
        ? [event.payload.endedAfterFocusSessionId]
        : [],
    ),
  );
  for (const session of sessions) {
    if (
      session.type === 'focus' &&
      session.status === 'completed' &&
      !breakSources.has(session.id) &&
      !workEnded.has(session.id)
    ) {
      await skipPendingBreak({ ...clock(), sourceFocusSessionId: session.id });
    }
  }
}

/** 跑完一轮：启动 → 到点完成 → 跳过休息（好让下一轮能开）。 */
async function runRound(mergeGroupId: string): Promise<Session> {
  const started = (await startMergeGroupFocus({ ...clock(), mergeGroupId })).value;
  await completeFocus({ ...clock(), sessionId: started.id, actualDuration: 1500 });
  await skipPendingBreak({ ...clock(), sourceFocusSessionId: started.id });
  return started;
}

describe('合并番茄钟端到端流程', () => {
  beforeEach(settleOpenBreaks);

  it('一轮合并专注：组整体编号、每个成员各记一个有效番茄、全局只算一次', async () => {
    const [slack, coffee, notes] = [await chore('回复 Slack'), await chore('订咖啡豆'), await chore('归档笔记')];
    const group = (await createMergeGroup({
      ...clock(), taskIds: [slack.id, coffee.id, notes.id],
    })).value;

    const started = (await startMergeGroupFocus({ ...clock(), mergeGroupId: group.id })).value;
    expect(started.taskIds).toEqual([slack.id, coffee.id, notes.id]);
    expect(started.mergeGroupId).toBe(group.id);
    // §3.3 关键规则 5：pomodoroIndex 记的是"这个组第几轮"，不是各成员各自的序号。
    expect(started.pomodoroIndex).toBe(1);

    const startedEvents = (await allEvents()).filter((event) => event.type === 'focus.started');
    expect(startedEvents).toHaveLength(3);
    expect(new Set(startedEvents.map((event) => event.sessionId))).toEqual(new Set([started.id]));
    expect(new Set(startedEvents.map((event) => event.mergeGroupId))).toEqual(new Set([group.id]));
    expect(new Set(startedEvents.map((event) => event.taskId))).toEqual(
      new Set([slack.id, coffee.id, notes.id]),
    );

    await completeFocus({ ...clock(), sessionId: started.id, actualDuration: 1500 });
    const completedEvents = (await allEvents()).filter((event) => event.type === 'focus.completed');
    expect(completedEvents).toHaveLength(3);

    const views = await loadCurrentTaskViews(clock());
    // §8.5.1：任务维度每个成员各 +1；§8.3.1：全局按 Session 记录数只 +1。
    for (const task of [slack, coffee, notes]) {
      expect(views.completedValidFocusCountByTaskId[task.id]).toBe(1);
    }
    expect(views.completedFocusCountToday).toBe(1);
  });

  it('§3.8 关键规则 4「追加预估」：已完成的留在组里，下一轮只带未完成的', async () => {
    const [a, b] = [await chore('两分钟搞定'), await chore('要久一点')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;

    const first = await runRound(group.id);
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });
    expect((await taskById(a.id)).status).toBe('completed');

    await adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 2 });
    const afterAdjust = await groupById(group.id);
    expect(afterAdjust.status).toBe('active');
    // 已完成的成员不移出组。
    expect(afterAdjust.taskIds).toEqual([a.id, b.id]);
    expect((await taskById(a.id)).mergeGroupId).toBe(group.id);

    const second = (await startMergeGroupFocus({ ...clock(), mergeGroupId: group.id })).value;
    // §3.3 关键规则 11：快照排除已完成的成员，不重复计有效番茄。
    expect(second.taskIds).toEqual([b.id]);
    expect(second.mergeGroupId).toBe(group.id);
    expect(second.pomodoroIndex).toBe(2);

    const before = (await loadCurrentTaskViews(clock())).completedFocusCountToday;
    await completeFocus({ ...clock(), sessionId: second.id, actualDuration: 1500 });
    const views = await loadCurrentTaskViews(clock());
    // a 只在第 1 轮拿 credit，b 两轮都拿；全局按 Session 记录数只 +1。
    expect(views.completedValidFocusCountByTaskId[a.id]).toBe(1);
    expect(views.completedValidFocusCountByTaskId[b.id]).toBe(2);
    expect(views.completedFocusCountToday).toBe(before + 1);
  });

  it('§3.8 关键规则 4「结束」：未完成的退出组独立显示，已完成的留在组里', async () => {
    const [a, b, c] = [await chore('A'), await chore('B'), await chore('C')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id, c.id] })).value;
    const first = await runRound(group.id);
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: b.id });

    const ended = await endMergeGroupRound({ ...clock(), mergeGroupId: group.id });

    expect(ended.value.status).toBe('active');
    expect(ended.value.taskIds).toEqual([a.id, b.id]);
    // 未完成的 c 退出组、回到独立任务，且仍是 active（没有被顺手改状态）。
    expect((await taskById(c.id)).mergeGroupId).toBeNull();
    expect((await taskById(c.id)).status).toBe('active');
    expect((await taskById(a.id)).mergeGroupId).toBe(group.id);
    const removed = (await allEvents()).filter((event) => event.type === 'mergeGroup.taskRemoved');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.payload).toMatchObject({ reason: 'sessionEndedIncomplete' });
  });

  it('「结束」后剩余成员 ≤ 1 时自动解散（关键规则 2）', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    const first = await runRound(group.id);
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });

    const ended = await endMergeGroupRound({ ...clock(), mergeGroupId: group.id });

    expect(ended.value.status).toBe('dissolved');
    expect(ended.value.dissolvedReason).toBe('membersBelowMinimum');
    expect((await taskById(a.id)).mergeGroupId).toBeNull();
    expect((await taskById(b.id)).mergeGroupId).toBeNull();
  });

  it('§3.8 关键规则 6：三轮用满仍有未完成成员 → limitReached 强阻断，且提示不解除阻塞', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    await runRound(group.id);
    await adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 2 });
    await runRound(group.id);
    await adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 3 });
    await runRound(group.id);

    const marked = await markMergeGroupLimitReached({ ...clock(), mergeGroupId: group.id });
    expect(marked.value.status).toBe('limitReached');
    const prompts = (await allEvents()).filter(
      (event) => event.type === 'prompt.shown' && event.mergeGroupId === group.id,
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.payload).toMatchObject({ promptType: 'mergeGroupLimitReached' });

    // 强阻断：既不能追加预估，也不能开启新一轮。
    await expect(
      adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 4 }),
    ).rejects.toThrow('已达上限');
    await expect(
      startMergeGroupFocus({ ...clock(), mergeGroupId: group.id }),
    ).rejects.toThrow('已达上限');

    // 解开阻塞只有两条路：移出剩余未完成成员，或整组解散。这里走「结束」移出。
    const ended = await endMergeGroupRound({ ...clock(), mergeGroupId: group.id });
    expect(ended.value.status).toBe('dissolved');
  });

  it('markMergeGroupLimitReached 在未到上限或已全部完成时是 no-op', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    const first = await runRound(group.id);

    const notCapped = await markMergeGroupLimitReached({ ...clock(), mergeGroupId: group.id });
    expect(notCapped.value.status).toBe('active');

    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: b.id });
    await adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 2 });
    await adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 3 });

    // 三轮用满，但组内已经没有未完成成员 → 不该阻断、不该弹提示。
    const allDone = await markMergeGroupLimitReached({ ...clock(), mergeGroupId: group.id });
    expect(allDone.value.status).toBe('active');
    expect(
      (await allEvents()).some(
        (event) => event.type === 'prompt.shown' && event.mergeGroupId === group.id,
      ),
    ).toBe(false);
  });

  it('合并 focus 的完成确认必须点名 taskId，且只认本次关联的任务', async () => {
    const [a, b, outsider] = [await chore('A'), await chore('B'), await chore('组外任务')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    const first = await runRound(group.id);

    await expect(
      completeTaskFromPomodoro({ ...clock(), sessionId: first.id }),
    ).rejects.toThrow('必须指明 taskId');
    await expect(
      completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: outsider.id }),
    ).rejects.toThrow('不在本次 focus 的关联任务中');

    const completed = await completeTaskFromPomodoro({
      ...clock(), sessionId: first.id, taskId: b.id,
    });
    expect(completed.value.completionSource).toBe('pomodoro');
    // §7.x task.completed：validFocusCountAtCompletion 写当时累计的有效标准 focus 数。
    const event = (await allEvents()).find(
      (candidate) => candidate.type === 'task.completed' && candidate.taskId === b.id,
    );
    expect(event!.payload).toMatchObject({ validFocusCountAtCompletion: 1 });
  });
});
