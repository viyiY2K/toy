import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { makeSession, type DayPlan, type Event, type MergeGroup, type Session, type Task } from '../schema';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import { createManualTask } from './taskCommands';
import {
  addTaskToMergeGroup,
  adjustMergeGroupEstimate,
  createMergeGroup,
  dissolveMergeGroup,
  removeTaskFromMergeGroup,
  reorderMergeGroupMember,
} from './mergeGroupCommands';

const TIMEZONE = 'Asia/Shanghai';
// 单调递增的假时钟：每次调用往前走一分钟，跨小时自动进位（同一个产品日内）。
let tick = 0;
const at = () => {
  const minutes = tick++;
  const hour = 9 + Math.floor(minutes / 60);
  return `2026-10-01T${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+08:00`;
};

async function chore(title: string): Promise<Task> {
  return (await createManualTask({ now: at(), timezone: TIMEZONE, title, destination: 'today' })).value;
}

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

async function taskById(id: string): Promise<Task> {
  return (await dataStore.get<Task>(STORE.tasks, id))!;
}

/** 标准 focus 必须挂当天的 DayPlan（§3.3 关键规则 8），否则写入校验直接拒绝。 */
async function currentDayPlanId(): Promise<string> {
  return (await dataStore.getAll<DayPlan>(STORE.dayPlans))[0]!.id;
}

/** 直接落一条 focus Session，用来把某个 Task 变成"已经计时过"，验证合并资格红线。 */
async function seedFocus(task: Task, status: 'completed' | 'discarded'): Promise<Session> {
  const startedAt = at();
  const dayPlanId = await currentDayPlanId();
  return executeAtomicWrite(
    { storeNames: [STORE.sessions], now: startedAt, timezone: TIMEZONE },
    async (transaction) => {
      const session = makeSession({
        now: startedAt,
        startedAt,
        timezone: TIMEZONE,
        type: 'focus',
        status,
        taskIds: [task.id],
        endedAt: startedAt,
        plannedDuration: 1500,
        actualDuration: 1500,
        pomodoroIndex: 1,
        dayPlanId,
      });
      await transaction.put(STORE.sessions, session);
      return session;
    },
  );
}

/** 手工造一条正在跑的合并 focus，用来验证计时途中的成员同步。 */
async function seedActiveMergedFocus(group: MergeGroup): Promise<Session> {
  const startedAt = at();
  const dayPlanId = await currentDayPlanId();
  return executeAtomicWrite(
    { storeNames: [STORE.sessions], now: startedAt, timezone: TIMEZONE },
    async (transaction) => {
      const session = makeSession({
        now: startedAt,
        startedAt,
        timezone: TIMEZONE,
        type: 'focus',
        taskIds: [...group.taskIds],
        mergeGroupId: group.id,
        plannedDuration: 1500,
        pomodoroIndex: 1,
        dayPlanId,
      });
      await transaction.put(STORE.sessions, session);
      return session;
    },
  );
}

describe('mergeGroupCommands（v4.1 §3.8 / §7.19）', () => {
  it('createMergeGroup：写组 + 回填成员 mergeGroupId + 一条 mergeGroup.created', async () => {
    const [slack, coffee] = [await chore('回复 Slack 消息'), await chore('订咖啡豆')];
    const created = await createMergeGroup({
      now: at(), timezone: TIMEZONE, taskIds: [slack.id, coffee.id],
    });

    expect(created.value.taskIds).toEqual([slack.id, coffee.id]);
    expect(created.value.status).toBe('active');
    expect(created.value.estimatedPomodoros).toBe(1);
    expect(created.value.estimateRounds).toHaveLength(1);
    expect((await taskById(slack.id)).mergeGroupId).toBe(created.value.id);
    expect((await taskById(coffee.id)).mergeGroupId).toBe(created.value.id);

    const events = await eventsFor(created.correlationId);
    expect(events.map((event) => event.type)).toEqual(['mergeGroup.created']);
    expect(events[0]!.mergeGroupId).toBe(created.value.id);
    expect(events[0]!.taskId).toBeNull();
  });

  it('合并资格红线：计时过的任务永久不能再被合并，completed 与 discarded 一视同仁', async () => {
    const [used, discarded, fresh] = [await chore('跑过番茄'), await chore('作废过'), await chore('全新')];
    await seedFocus(used, 'completed');
    await seedFocus(discarded, 'discarded');

    await expect(
      createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [used.id, fresh.id] }),
    ).rejects.toThrow('已经计时过');
    await expect(
      createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [discarded.id, fresh.id] }),
    ).rejects.toThrow('已经计时过');
    // 被拒绝的写入整体回滚：不留下半个组，也不动被牵连的 Task。
    const groups = await dataStore.getAll<MergeGroup>(STORE.mergeGroups);
    expect(groups.some((group) => group.taskIds.includes(fresh.id))).toBe(false);
    expect((await taskById(fresh.id)).mergeGroupId).toBeNull();
  });

  it('createMergeGroup 拒绝少于 2 个成员、重复成员，以及已在别的组里的成员', async () => {
    const [a, b, c] = [await chore('A'), await chore('B'), await chore('C')];
    await expect(
      createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id] }),
    ).rejects.toThrow('至少需要 2 个任务');
    await expect(
      createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, a.id] }),
    ).rejects.toThrow('不得重复');

    await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] });
    await expect(
      createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, c.id] }),
    ).rejects.toThrow('已经在另一个合并组');
  });

  it('addTaskToMergeGroup：计时途中加入的新任务同步进正在跑的那条 Session', async () => {
    const [a, b, late] = [await chore('A'), await chore('B'), await chore('中途补的')];
    const group = (await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] })).value;
    const session = await seedActiveMergedFocus(group);

    const added = await addTaskToMergeGroup({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, taskId: late.id, source: 'duringActiveSession',
    });

    expect(added.value.taskIds).toEqual([a.id, b.id, late.id]);
    expect((await dataStore.get<Session>(STORE.sessions, session.id))!.taskIds).toEqual([a.id, b.id, late.id]);
    const [event] = await eventsFor(added.correlationId);
    expect(event!.type).toBe('mergeGroup.taskAdded');
    expect(event!.payload).toMatchObject({ addedAtIndex: 2, source: 'duringActiveSession' });
  });

  it('removeTaskFromMergeGroup：剩余 ≥ 2 时只移出，组保持 active', async () => {
    const [a, b, c] = [await chore('A'), await chore('B'), await chore('C')];
    const group = (await createMergeGroup({
      now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id, c.id],
    })).value;

    const removed = await removeTaskFromMergeGroup({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, taskId: b.id, reason: 'manualUnmerge',
    });

    expect(removed.value.status).toBe('active');
    expect(removed.value.taskIds).toEqual([a.id, c.id]);
    expect((await taskById(b.id)).mergeGroupId).toBeNull();
    expect((await taskById(a.id)).mergeGroupId).toBe(group.id);
    expect((await eventsFor(removed.correlationId)).map((event) => event.type)).toEqual([
      'mergeGroup.taskRemoved',
    ]);
  });

  it('§3.8 关键规则 2：移出后剩 1 个自动解散，两条事件共享 correlationId', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] })).value;

    const removed = await removeTaskFromMergeGroup({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, taskId: a.id, reason: 'sessionEndedIncomplete',
    });

    expect(removed.value.status).toBe('dissolved');
    expect(removed.value.dissolvedReason).toBe('membersBelowMinimum');
    expect(removed.value.dissolvedAt).not.toBeNull();
    // 最后一个成员的归属也一并清空。
    expect((await taskById(a.id)).mergeGroupId).toBeNull();
    expect((await taskById(b.id)).mergeGroupId).toBeNull();
    // 解散不是软删除，历史记录保留（§3.8 关键规则 7）。
    expect(removed.value.deletedAt).toBeNull();
    expect((await eventsFor(removed.correlationId)).map((event) => event.type)).toEqual([
      'mergeGroup.taskRemoved', 'mergeGroup.dissolved',
    ]);
  });

  it('reorderMergeGroupMember：只重排 taskIds，不动成员归属', async () => {
    const [a, b, c] = [await chore('A'), await chore('B'), await chore('C')];
    const group = (await createMergeGroup({
      now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id, c.id],
    })).value;

    const reordered = await reorderMergeGroupMember({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, fromIndex: 2, toIndex: 0,
    });

    expect(reordered.value.taskIds).toEqual([c.id, a.id, b.id]);
    for (const task of [a, b, c]) expect((await taskById(task.id)).mergeGroupId).toBe(group.id);
    const [event] = await eventsFor(reordered.correlationId);
    expect(event!.type).toBe('mergeGroup.reordered');
    expect(event!.taskId).toBe(c.id);
    expect(event!.payload).toMatchObject({ fromIndex: 2, toIndex: 0 });
    await expect(
      reorderMergeGroupMember({ now: at(), timezone: TIMEZONE, mergeGroupId: group.id, fromIndex: 1, toIndex: 1 }),
    ).rejects.toThrow('起止位置必须不同');
  });

  it('adjustMergeGroupEstimate：第 2/3 轮可追加，超三轮与超 7 个都被拒', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] })).value;

    const second = await adjustMergeGroupEstimate({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, estimatedPomodoros: 2,
    });
    expect(second.value.estimatedPomodoros).toBe(2);
    expect(second.value.estimateRounds.map((round) => round.index)).toEqual([1, 2]);
    expect((await eventsFor(second.correlationId))[0]!.payload).toMatchObject({
      round: 2, oldEstimate: 1, newEstimate: 2,
    });

    await expect(
      adjustMergeGroupEstimate({ now: at(), timezone: TIMEZONE, mergeGroupId: group.id, estimatedPomodoros: 8 }),
    ).rejects.toThrow('1–7');

    await adjustMergeGroupEstimate({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, estimatedPomodoros: 3,
    });
    await expect(
      adjustMergeGroupEstimate({ now: at(), timezone: TIMEZONE, mergeGroupId: group.id, estimatedPomodoros: 4 }),
    ).rejects.toThrow('最多三轮');
  });

  it('§3.8 关键规则 6：limitReached 强阻断追加预估，解散后一切写入都被拒', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] })).value;
    await executeAtomicWrite(
      { storeNames: [STORE.mergeGroups], now: at(), timezone: TIMEZONE },
      async (transaction) => {
        const current = await transaction.get<MergeGroup>(STORE.mergeGroups, group.id);
        await transaction.put(STORE.mergeGroups, { ...current!, status: 'limitReached' });
      },
    );

    await expect(
      adjustMergeGroupEstimate({ now: at(), timezone: TIMEZONE, mergeGroupId: group.id, estimatedPomodoros: 2 }),
    ).rejects.toThrow('已达上限');
    // 阻塞的解法之一：整组解散。
    const dissolved = await dissolveMergeGroup({ now: at(), timezone: TIMEZONE, mergeGroupId: group.id });
    expect(dissolved.value.dissolvedReason).toBe('manualDissolved');
    await expect(
      addTaskToMergeGroup({
        now: at(), timezone: TIMEZONE, mergeGroupId: group.id, taskId: (await chore('D')).id, source: 'drag',
      }),
    ).rejects.toThrow('已解散');
  });

  it('dissolveMergeGroup：清空全部归属，但不动任务本身与今日待办归属', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] })).value;
    const dayPlanBefore = (await dataStore.getAll<{ taskIds: string[] }>(STORE.dayPlans))[0]!.taskIds;

    const dissolved = await dissolveMergeGroup({ now: at(), timezone: TIMEZONE, mergeGroupId: group.id });

    expect(dissolved.value.status).toBe('dissolved');
    expect((await taskById(a.id)).mergeGroupId).toBeNull();
    expect((await taskById(b.id)).mergeGroupId).toBeNull();
    expect((await taskById(a.id)).status).toBe('active');
    expect((await dataStore.getAll<{ taskIds: string[] }>(STORE.dayPlans))[0]!.taskIds).toEqual(dayPlanBefore);
    const [event] = await eventsFor(dissolved.correlationId);
    expect(event!.payload).toMatchObject({
      finalTaskIds: [a.id, b.id], dissolvedReason: 'manualDissolved',
    });
  });

  it('正在跑的合并 Session 不会因为成员被移到只剩 1 个而退化成单任务 Session', async () => {
    const [a, b] = [await chore('A'), await chore('B')];
    const group = (await createMergeGroup({ now: at(), timezone: TIMEZONE, taskIds: [a.id, b.id] })).value;
    const session = await seedActiveMergedFocus(group);

    await removeTaskFromMergeGroup({
      now: at(), timezone: TIMEZONE, mergeGroupId: group.id, taskId: a.id, reason: 'manualUnmerge',
    });

    const stored = (await dataStore.get<Session>(STORE.sessions, session.id))!;
    expect(stored.taskIds).toEqual([a.id, b.id]);
    expect(stored.mergeGroupId).toBe(group.id);
  });
});
