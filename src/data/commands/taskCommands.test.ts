import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { makeSession, makeTask, type DayPlan, type Event, type Session, type Task } from '../schema';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import { loadCurrentTaskViews } from '../queries/currentTaskViews';
import {
  addTaskToToday,
  adjustTaskEstimate,
  archiveCompletedTask,
  completeTaskManually,
  createManualTask,
  deleteActiveTask,
  removeTaskFromToday,
  reorderActivityTask,
  reorderTodayTask,
  uncompleteTask,
  updateTaskTitle,
} from './taskCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) => `2026-10-01T09:${String(minute).padStart(2, '0')}:00+08:00`;

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

function failTimezoneAfterReads<T extends object>(
  input: T,
  validReadCount: number,
  counter: { reads: number },
): T & { readonly timezone: string } {
  return Object.defineProperty(input, 'timezone', {
    enumerable: true,
    get: () => (++counter.reads <= validReadCount ? TIMEZONE : 'Invalid/TimeZone'),
  }) as T & { readonly timezone: string };
}

describe('S13a-1 Task / DayPlan commands', () => {
  it('creates manual list/today Tasks with first estimate round and exact Event distinction', async () => {
    const list = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '活动任务', estimatedPomodoros: 2, destination: 'list',
    });
    const today = await createManualTask({
      now: at(1), timezone: TIMEZONE, title: '今日任务', estimatedPomodoros: 3, destination: 'today',
    });

    expect(list.value.estimateRounds).toEqual([{ index: 1, pomodoros: 2, occurredAt: at(0) }]);
    expect(today.value.estimateRounds).toEqual([{ index: 1, pomodoros: 3, occurredAt: at(1) }]);
    expect((await eventsFor(list.correlationId)).map((event) => event.type)).toEqual(['task.created']);
    expect((await eventsFor(today.correlationId)).map((event) => event.type)).toEqual([
      'task.created', 'dayPlan.taskAdded',
    ]);
    expect((await eventsFor(today.correlationId)).some((event) => event.type === 'task.movedToToday')).toBe(false);
    const [dayPlan] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    expect(dayPlan!.taskIds.at(-1)).toBe(today.value.id);
    expect(list.value.sortIndex).toBeLessThan(today.value.sortIndex);
  });

  it('updates title and records two total-estimate rounds, rejecting a fourth round atomically', async () => {
    const [task] = (await dataStore.getAll<Task>(STORE.tasks)).filter(({ title }) => title === '活动任务');
    const renamed = await updateTaskTitle({ now: at(2), timezone: TIMEZONE, taskId: task!.id, title: '活动任务（改）' });
    expect(renamed.value.title).toBe('活动任务（改）');
    expect((await eventsFor(renamed.correlationId))[0]).toMatchObject({
      type: 'task.updated', payload: { field: 'title', oldValue: '活动任务', newValue: '活动任务（改）' },
    });

    const round2 = await adjustTaskEstimate({ now: at(3), timezone: TIMEZONE, taskId: task!.id, estimatedPomodoros: 5 });
    const round3 = await adjustTaskEstimate({ now: at(4), timezone: TIMEZONE, taskId: task!.id, estimatedPomodoros: 7 });
    expect(round3.value.estimateRounds.map(({ index, pomodoros }) => ({ index, pomodoros }))).toEqual([
      { index: 1, pomodoros: 2 }, { index: 2, pomodoros: 5 }, { index: 3, pomodoros: 7 },
    ]);
    expect((await eventsFor(round2.correlationId))[0]).toMatchObject({
      type: 'task.estimateAdjusted', payload: { round: 2, oldEstimate: 2, newEstimate: 5 },
    });
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(adjustTaskEstimate({ now: at(5), timezone: TIMEZONE, taskId: task!.id, estimatedPomodoros: 6 })).rejects.toThrow(/三轮/);
    expect((await dataStore.get<Task>(STORE.tasks, task!.id))?.estimatedPomodoros).toBe(7);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('moves an existing Task into today, reorders it, and moves it back with atomic event pairs', async () => {
    const [task] = (await dataStore.getAll<Task>(STORE.tasks)).filter(({ title }) => title === '活动任务（改）');
    const moved = await addTaskToToday({
      now: at(6), timezone: TIMEZONE, taskId: task!.id, source: 'drag', addedAtIndex: 1,
    });
    expect(moved.value.taskIds[1]).toBe(task!.id);
    expect((await eventsFor(moved.correlationId)).map((event) => event.type)).toEqual([
      'dayPlan.taskAdded', 'task.movedToToday',
    ]);
    expect(new Set((await eventsFor(moved.correlationId)).map((event) => event.correlationId))).toEqual(new Set([moved.correlationId]));
    const eventCountAfterMove = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(addTaskToToday({
      now: at(7), timezone: TIMEZONE, taskId: task!.id, source: 'button',
    })).rejects.toThrow(/已在今日/);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCountAfterMove);

    const reordered = await reorderTodayTask({ now: at(8), timezone: TIMEZONE, fromIndex: 1, toIndex: 0 });
    expect(reordered.value.taskIds[0]).toBe(task!.id);
    expect((await eventsFor(reordered.correlationId))[0]).toMatchObject({
      type: 'dayPlan.taskReordered', taskId: task!.id, payload: { fromIndex: 1, toIndex: 0 },
    });

    const removed = await removeTaskFromToday({ now: at(9), timezone: TIMEZONE, taskId: task!.id });
    expect(removed.value.taskIds).not.toContain(task!.id);
    expect((await eventsFor(removed.correlationId)).map((event) => event.type)).toEqual([
      'dayPlan.taskRemoved', 'task.movedToList',
    ]);
    expect((await dataStore.get<Task>(STORE.tasks, task!.id))?.title).toBe('活动任务（改）');
  });

  it('soft-deletes only an activity-list Task and preserves its tombstone plus Event', async () => {
    const [task] = (await dataStore.getAll<Task>(STORE.tasks)).filter(({ title }) => title === '活动任务（改）');
    const result = await deleteActiveTask({ now: at(10), timezone: TIMEZONE, taskId: task!.id });
    expect(result.value).toMatchObject({ status: 'deleted', deletedAt: at(10), deletedReason: 'userDeleted' });
    expect(await dataStore.get<Task>(STORE.tasks, task!.id)).toBeUndefined();
    expect(await dataStore.getIncludingDeleted<Task>(STORE.tasks, task!.id)).toEqual(result.value);
    expect((await eventsFor(result.correlationId))[0]).toMatchObject({
      type: 'task.deleted', taskId: task!.id, payload: { deletedReason: 'userDeleted' },
    });

    const [todayTask] = (await dataStore.getAll<Task>(STORE.tasks)).filter(({ title }) => title === '今日任务');
    await expect(deleteActiveTask({ now: at(11), timezone: TIMEZONE, taskId: todayTask!.id })).rejects.toThrow(/必须先移出/);
    expect(await dataStore.get<Task>(STORE.tasks, todayTask!.id)).toBeDefined();
  });
});

describe('Phase 2 S3a Task lifecycle commands', () => {
  it('manually completes active/splitNeeded Tasks with a real completed standard-focus snapshot and no fake Session', async () => {
    const task = await createManualTask({
      now: at(20), timezone: TIMEZONE, title: '手动完成快照', destination: 'list',
    });
    const [currentDayPlan] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    const focus = (minute: number, status: 'completed' | 'discarded'): Session => makeSession({
      now: at(minute),
      startedAt: at(minute - 1),
      endedAt: at(minute),
      timezone: TIMEZONE,
      type: 'focus',
      status,
      taskId: task.value.id,
      plannedDuration: 1500,
      actualDuration: 60,
      pomodoroIndex: minute - 19,
      dayPlanId: currentDayPlan!.id,
    });
    const completed1 = focus(21, 'completed');
    const completed2 = focus(22, 'completed');
    const discarded = focus(23, 'discarded');
    const deletedCompleted = focus(24, 'completed');
    await executeAtomicWrite(
      {
        storeNames: [STORE.sessions, EVENT_STORE],
        now: at(25),
        timezone: TIMEZONE,
      },
      async (transaction) => {
        for (const session of [completed1, completed2, discarded, deletedCompleted]) {
          await transaction.put(STORE.sessions, session);
        }
        await transaction.softDelete(STORE.sessions, deletedCompleted.id, at(25));
      },
    );

    const sessionCount = (await dataStore.getAllIncludingDeleted<Session>(STORE.sessions)).length;
    const completed = await completeTaskManually({
      now: at(26), timezone: TIMEZONE, taskId: task.value.id,
    });
    expect(completed.value).toMatchObject({
      status: 'completed', completedAt: at(26), completionSource: 'manual',
    });
    expect(await dataStore.getAllIncludingDeleted<Session>(STORE.sessions)).toHaveLength(sessionCount);
    expect((await eventsFor(completed.correlationId))[0]).toMatchObject({
      type: 'task.completed',
      taskId: task.value.id,
      sessionId: null,
      payload: {
        completionSource: 'manual',
        completedAt: at(26),
        validFocusCountAtCompletion: 2,
      },
    });

    const zero = await createManualTask({
      now: at(27), timezone: TIMEZONE, title: '零番茄手动完成', destination: 'list',
    });
    const zeroCompleted = await completeTaskManually({
      now: at(28), timezone: TIMEZONE, taskId: zero.value.id,
    });
    expect((await eventsFor(zeroCompleted.correlationId))[0]).toMatchObject({
      payload: { validFocusCountAtCompletion: 0 },
    });

    const splitNeeded = makeTask({
      now: at(28), title: '待拆分也可手动完成', status: 'splitNeeded', sortIndex: 99_000,
    });
    await executeAtomicWrite(
      { storeNames: [STORE.tasks, EVENT_STORE], now: at(28), timezone: TIMEZONE },
      (transaction) => transaction.put(STORE.tasks, splitNeeded),
    );
    expect((await completeTaskManually({
      now: at(29), timezone: TIMEZONE, taskId: splitNeeded.id,
    })).value).toMatchObject({ status: 'completed', completionSource: 'manual' });

    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(completeTaskManually({
      now: at(30), timezone: TIMEZONE, taskId: task.value.id,
    })).rejects.toThrow(/active\/splitNeeded/);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('uncompletes only current completed Tasks while preserving the original completion Event', async () => {
    const task = await createManualTask({
      now: at(30), timezone: TIMEZONE, title: '撤销完成', destination: 'list',
    });
    const completion = await completeTaskManually({
      now: at(31), timezone: TIMEZONE, taskId: task.value.id,
    });
    const originalEvent = (await eventsFor(completion.correlationId))[0]!;
    const result = await uncompleteTask({
      now: at(32), timezone: TIMEZONE, taskId: task.value.id,
    });
    expect(result.value).toMatchObject({
      status: 'active', completedAt: null, completionSource: null,
    });
    expect((await eventsFor(result.correlationId))[0]).toMatchObject({
      type: 'task.uncompleted',
      payload: { previousCompletedAt: at(31), previousCompletionSource: 'manual' },
    });
    expect(await dataStore.get<Event>(EVENT_STORE, originalEvent.id)).toEqual(originalEvent);

    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(uncompleteTask({
      now: at(33), timezone: TIMEZONE, taskId: task.value.id,
    })).rejects.toThrow(/completed/);
    expect(await dataStore.get<Task>(STORE.tasks, task.value.id)).toEqual(result.value);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('rolls back every lifecycle command when its Event path fails after entity writes', async () => {
    const manual = await createManualTask({
      now: at(33), timezone: TIMEZONE, title: '手动完成回滚', destination: 'list',
    });
    const manualBefore = await dataStore.get<Task>(STORE.tasks, manual.value.id);
    let eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const manualFault = { reads: 0 };
    await expect(completeTaskManually(failTimezoneAfterReads({
      now: at(34), taskId: manual.value.id,
    }, 1, manualFault))).rejects.toThrow();
    expect(manualFault.reads).toBe(2);
    expect(await dataStore.get<Task>(STORE.tasks, manual.value.id)).toEqual(manualBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const completed = await createManualTask({
      now: at(35), timezone: TIMEZONE, title: '取消完成回滚', destination: 'list',
    });
    await completeTaskManually({ now: at(36), timezone: TIMEZONE, taskId: completed.value.id });
    const completedBefore = await dataStore.get<Task>(STORE.tasks, completed.value.id);
    eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const uncompleteFault = { reads: 0 };
    await expect(uncompleteTask(failTimezoneAfterReads({
      now: at(37), taskId: completed.value.id,
    }, 1, uncompleteFault))).rejects.toThrow();
    expect(uncompleteFault.reads).toBe(2);
    expect(await dataStore.get<Task>(STORE.tasks, completed.value.id)).toEqual(completedBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const archived = await createManualTask({
      now: at(38), timezone: TIMEZONE, title: '完成归档回滚', destination: 'today',
    });
    await completeTaskManually({ now: at(39), timezone: TIMEZONE, taskId: archived.value.id });
    const archivedBefore = await dataStore.get<Task>(STORE.tasks, archived.value.id);
    const [dayPlanBeforeArchive] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const archiveFault = { reads: 0 };
    // Reads 1–4 initialize/options; 5 builds task.archived; 6 fails dayPlan.taskRemoved.
    await expect(archiveCompletedTask(failTimezoneAfterReads({
      now: at(40), taskId: archived.value.id,
    }, 5, archiveFault))).rejects.toThrow();
    expect(archiveFault.reads).toBe(6);
    expect(await dataStore.get<Task>(STORE.tasks, archived.value.id)).toEqual(archivedBefore);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, dayPlanBeforeArchive!.id))
      .toEqual(dayPlanBeforeArchive);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const reorderFirst = await createManualTask({
      now: at(41), timezone: TIMEZONE, title: '排序回滚甲', destination: 'list',
    });
    const reorderSecond = await createManualTask({
      now: at(42), timezone: TIMEZONE, title: '排序回滚乙', destination: 'list',
    });
    const reorderViews = await loadCurrentTaskViews({ now: at(43), timezone: TIMEZONE });
    const fromIndex = reorderViews.activeTasks.findIndex(({ id }) => id === reorderSecond.value.id);
    const toIndex = reorderViews.activeTasks.findIndex(({ id }) => id === reorderFirst.value.id);
    const taskOrderBefore = (await dataStore.getAll<Task>(STORE.tasks))
      .map(({ id, sortIndex, updatedAt }) => ({ id, sortIndex, updatedAt }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const dayPlanBeforeReorder = reorderViews.dayPlan;
    eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const reorderFault = { reads: 0 };
    await expect(reorderActivityTask(failTimezoneAfterReads({
      now: at(44), fromIndex, toIndex,
    }, 4, reorderFault))).rejects.toThrow();
    expect(reorderFault.reads).toBe(5);
    expect((await dataStore.getAll<Task>(STORE.tasks))
      .map(({ id, sortIndex, updatedAt }) => ({ id, sortIndex, updatedAt }))
      .sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual(taskOrderBefore);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, dayPlanBeforeReorder.id))
      .toEqual(dayPlanBeforeReorder);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('archives a completed today Task atomically, preserves completion facts, and removes DayPlan membership with correlated Events', async () => {
    const task = await createManualTask({
      now: at(34), timezone: TIMEZONE, title: '今日完成归档', destination: 'today',
    });
    await completeTaskManually({ now: at(35), timezone: TIMEZONE, taskId: task.value.id });
    const result = await archiveCompletedTask({
      now: at(36), timezone: TIMEZONE, taskId: task.value.id,
    });
    expect(result.value).toMatchObject({
      status: 'archived',
      outcome: 'completed',
      archivedAt: at(36),
      completedAt: at(35),
      completionSource: 'manual',
    });
    const events = await eventsFor(result.correlationId);
    expect(events.map((event) => event.type)).toEqual(['task.archived', 'dayPlan.taskRemoved']);
    expect(events[1]).toMatchObject({
      taskId: task.value.id,
      payload: { reason: 'taskArchived' },
    });
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(1);
    const [dayPlan] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    expect(dayPlan!.taskIds).not.toContain(task.value.id);
    expect(await dataStore.get<Task>(STORE.tasks, task.value.id)).toEqual(result.value);
    expect((await loadCurrentTaskViews({ now: at(37), timezone: TIMEZONE })).completedTasks)
      .not.toContainEqual(result.value);

    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(uncompleteTask({
      now: at(38), timezone: TIMEZONE, taskId: task.value.id,
    })).rejects.toThrow(/completed/);
    await expect(archiveCompletedTask({
      now: at(39), timezone: TIMEZONE, taskId: task.value.id,
    })).rejects.toThrow(/completed/);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('reorders only the activity list through Task.sortIndex and leaves current DayPlan order untouched', async () => {
    const first = await createManualTask({
      now: at(40), timezone: TIMEZONE, title: '活动排序甲', destination: 'list',
    });
    await createManualTask({
      now: at(41), timezone: TIMEZONE, title: '活动排序乙', destination: 'list',
    });
    const last = await createManualTask({
      now: at(42), timezone: TIMEZONE, title: '活动排序丙', destination: 'list',
    });
    const before = await loadCurrentTaskViews({ now: at(43), timezone: TIMEZONE });
    const fromIndex = before.activeTasks.findIndex(({ id }) => id === last.value.id);
    const toIndex = before.activeTasks.findIndex(({ id }) => id === first.value.id);
    const dayPlanTaskIds = [...before.dayPlan.taskIds];
    const result = await reorderActivityTask({
      now: at(44), timezone: TIMEZONE, fromIndex, toIndex,
    });
    expect((await eventsFor(result.correlationId))[0]).toMatchObject({
      type: 'task.reordered',
      taskId: last.value.id,
      dayPlanId: null,
      payload: { fromIndex, toIndex },
    });
    const after = await loadCurrentTaskViews({ now: at(45), timezone: TIMEZONE });
    expect(after.activeTasks.findIndex(({ id }) => id === last.value.id)).toBe(toIndex);
    expect(after.activeTasks.findIndex(({ id }) => id === first.value.id)).toBe(toIndex + 1);
    expect(after.dayPlan.taskIds).toEqual(dayPlanTaskIds);

    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(reorderActivityTask({
      now: at(46), timezone: TIMEZONE, fromIndex: toIndex, toIndex,
    })).rejects.toThrow(/必须不同/);
    expect((await loadCurrentTaskViews({ now: at(47), timezone: TIMEZONE })).dayPlan.taskIds)
      .toEqual(dayPlanTaskIds);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });
});
