/**
 * 合并番茄钟端到端流程（v4.3 §3.3 / §3.8 / §8.5）。
 *
 * 统计口径（红线 24–26）：**番茄归合并组，时间归成员**。一次正常完成的合并 focus，
 * 全局有效番茄 +1、该 MergeGroup +1、每个成员 Task **+0**；成员只从
 * `Session.taskSegments` 拿属于自己的那一段耗时，各段之和精确等于
 * `Session.actualDuration`。v4.1/v4.2 的"每个成员各记一个完整有效番茄、任务维度加总
 * 可以大于全局"已作废，出现即为缺陷。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { loadCurrentTaskViews } from '../queries/currentTaskViews';
import type { Event, MergeGroup, Session, Task } from '../schema';
import {
  adjustMergeGroupEstimate,
  completeMergeGroup,
  createMergeGroup,
  endMergeGroupRound,
  markMergeGroupLimitReached,
  renameMergeGroup,
} from './mergeGroupCommands';
import { createManualTask } from './taskCommands';
import {
  completeFocus,
  completeTaskFromPomodoro,
  discardFocus,
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

  it('一轮合并专注：组整体编号、番茄记在组身上、成员各记 0', async () => {
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
    // 红线 24：成员一个番茄都不记；番茄整体归这个合并组；全局按 Session 记录数 +1。
    for (const task of [slack, coffee, notes]) {
      expect(views.completedValidFocusCountByTaskId[task.id] ?? 0).toBe(0);
    }
    expect(views.mergeGroupValidFocusCountById[group.id]).toBe(1);
    expect(views.completedFocusCountToday).toBe(1);

    // 红线 25：各分段之和必须**精确等于** Session.actualDuration，未轮到的成员留显式 0。
    const stored = (await dataStore.get<Session>(STORE.sessions, started.id))!;
    expect(stored.taskSegments.map(({ taskId }) => taskId).sort()).toEqual(
      [slack.id, coffee.id, notes.id].sort(),
    );
    expect(
      stored.taskSegments.reduce((sum, segment) => sum + segment.actualDuration, 0),
    ).toBe(stored.actualDuration);
  });

  it('§3.8 关键规则 4「追加预估」：已完成的留在组里，下一轮只带未完成的', async () => {
    const [a, b, c] = [await chore('两分钟搞定'), await chore('要久一点'), await chore('还有一件')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id, c.id] })).value;

    const first = await runRound(group.id);
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });
    expect((await taskById(a.id)).status).toBe('completed');

    await adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 2 });
    const afterAdjust = await groupById(group.id);
    expect(afterAdjust.status).toBe('active');
    // 已完成的成员不移出组。
    expect(afterAdjust.taskIds).toEqual([a.id, b.id, c.id]);
    expect((await taskById(a.id)).mergeGroupId).toBe(group.id);

    const second = (await startMergeGroupFocus({ ...clock(), mergeGroupId: group.id })).value;
    // §3.3 关键规则 11：快照排除已完成的成员，不重复计有效番茄。
    expect(second.taskIds).toEqual([b.id, c.id]);
    expect(second.mergeGroupId).toBe(group.id);
    expect(second.pomodoroIndex).toBe(2);

    const before = (await loadCurrentTaskViews(clock())).completedFocusCountToday;
    await completeFocus({ ...clock(), sessionId: second.id, actualDuration: 1500 });
    const views = await loadCurrentTaskViews(clock());
    /*
     * 红线 24：跨多少轮都一样——成员的完整有效番茄数恒为 0，两轮正常完成只让
     * 这个**合并组**的有效番茄数变成 2。成员的收获是各自的分段耗时，不是番茄数。
     */
    expect(views.completedValidFocusCountByTaskId[a.id] ?? 0).toBe(0);
    expect(views.completedValidFocusCountByTaskId[b.id] ?? 0).toBe(0);
    expect(views.mergeGroupValidFocusCountById[group.id]).toBe(2);
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
    /*
     * 红线 26：`completionSource='pomodoro'` ≠ 该 Task 有有效番茄。
     * 合并成员确实是在番茄专注流程里完成的（记 'pomodoro'），但它自己一个完整有效
     * 番茄都没拿到（记 0）——这个组合合法且是预期的，下游统计不得由 'pomodoro'
     * 反推"至少有一个有效番茄"。
     */
    expect(completed.value.completionSource).toBe('pomodoro');
    const event = (await allEvents()).find(
      (candidate) => candidate.type === 'task.completed' && candidate.taskId === b.id,
    );
    expect(event!.payload).toMatchObject({
      completionSource: 'pomodoro',
      validFocusCountAtCompletion: 0,
    });
  });

  it('进行中逐个勾选成员完成：分段按勾选时刻切开，推进到下一位', async () => {
    const [a, b, c] = [await chore('A'), await chore('B'), await chore('C')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id, c.id] })).value;
    const started = (await startMergeGroupFocus({ ...clock(), mergeGroupId: group.id })).value;

    // 这是 §3.8 关键规则 11 要求的入口：没有它，时间就无法按成员切分。
    await completeTaskFromPomodoro({ ...clock(), sessionId: started.id, taskId: a.id });
    expect((await taskById(a.id)).status).toBe('completed');

    // 严格顺序：A 完成后当前成员变成 B，不能越过 B 直接勾 C。
    await expect(
      completeTaskFromPomodoro({ ...clock(), sessionId: started.id, taskId: c.id }),
    ).rejects.toThrow('只能勾选当前正在执行的成员');

    await completeFocus({ ...clock(), sessionId: started.id, actualDuration: 1500 });
    const stored = (await dataStore.get<Session>(STORE.sessions, started.id))!;

    // A 拿被勾完成之前那段，B 是终结时的当前成员吃掉剩余，C 始终没轮到记 0。
    expect(stored.taskSegments.map(({ taskId }) => taskId)).toEqual([a.id, b.id, c.id]);
    expect(stored.taskSegments.at(-1)!.actualDuration).toBe(0);
    expect(
      stored.taskSegments.reduce((sum, segment) => sum + segment.actualDuration, 0),
    ).toBe(1500);
    expect(stored.taskSegments[0]!.actualDuration).toBeGreaterThan(0);
  });

  it('作废的合并 focus 保留已发生的分段，但不给任何维度记有效番茄', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    const started = (await startMergeGroupFocus({ ...clock(), mergeGroupId: group.id })).value;
    await completeTaskFromPomodoro({ ...clock(), sessionId: started.id, taskId: a.id });

    await discardFocus({ ...clock(), sessionId: started.id, actualDuration: 600 });

    const stored = (await dataStore.get<Session>(STORE.sessions, started.id))!;
    expect(stored.status).toBe('discarded');
    expect(
      stored.taskSegments.reduce((sum, segment) => sum + segment.actualDuration, 0),
    ).toBe(600);

    const views = await loadCurrentTaskViews(clock());
    expect(views.mergeGroupValidFocusCountById[group.id]).toBe(0);
    expect(views.completedValidFocusCountByTaskId[a.id] ?? 0).toBe(0);
  });

  it('整组做完 → completed 成功终态，配 completedAt 与组自己的有效番茄数', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    const first = await runRound(group.id);
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: b.id });

    const done = await completeMergeGroup({ ...clock(), mergeGroupId: group.id });

    expect(done.value.status).toBe('completed');
    expect(done.value.completedAt).not.toBeNull();
    expect(done.value.dissolvedAt).toBeNull();
    const event = (await allEvents()).find(
      (candidate) => candidate.type === 'mergeGroup.completed' && candidate.mergeGroupId === group.id,
    );
    // 记的是**这一组**拿到的有效番茄数（跑了一轮 = 1），不是任何成员的番茄数。
    expect(event!.payload).toMatchObject({ validFocusCountAtCompletion: 1 });

    // 红线 28：completed 是终态，之后不许再增删成员、追加预估或开新一轮。
    await expect(
      adjustMergeGroupEstimate({ ...clock(), mergeGroupId: group.id, estimatedPomodoros: 2 }),
    ).rejects.toThrow('已完成');
    await expect(
      startMergeGroupFocus({ ...clock(), mergeGroupId: group.id }),
    ).rejects.toThrow('已完成');
  });

  it('还有未完成成员时不能确认整组完成', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    const first = await runRound(group.id);
    await completeTaskFromPomodoro({ ...clock(), sessionId: first.id, taskId: a.id });

    await expect(
      completeMergeGroup({ ...clock(), mergeGroupId: group.id }),
    ).rejects.toThrow('还有未完成的成员');
  });

  it('改名留痕：mergeGroup.renamed 带前后名称，不影响成员与统计', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ ...clock(), taskIds: [a.id, b.id] })).value;
    expect(group.title).toBe('杂事番茄');

    const renamed = await renameMergeGroup({
      ...clock(), mergeGroupId: group.id, title: '周一杂事清理',
    });

    expect(renamed.value.title).toBe('周一杂事清理');
    expect(renamed.value.taskIds).toEqual([a.id, b.id]);
    const event = (await allEvents()).find((candidate) => candidate.type === 'mergeGroup.renamed');
    expect(event!.payload).toMatchObject({ oldTitle: '杂事番茄', newTitle: '周一杂事清理' });

    await expect(
      renameMergeGroup({ ...clock(), mergeGroupId: group.id, title: '  ' }),
    ).rejects.toThrow('不能为空');
  });
});
