import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { makeTask, type DayPlan, type Event, type Task } from '../schema';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import { loadCurrentTaskViews } from '../queries/currentTaskViews';
import {
  addTaskToToday,
  adjustTaskEstimate,
  archiveCompletedTask,
  completeTaskManually,
  createManualTask,
  createSubtask,
  deleteActiveTask,
  moveTopLevelTaskToSubtask,
  promoteSubtaskToTopLevel,
  reorderSubtask,
  restoreArchivedTask,
  uncompleteTask,
  updateTaskActualWorkNote,
  updateTaskNote,
  updateTaskTitle,
} from './taskCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (step: number) => new Date(Date.UTC(2026, 10, 1, 1, step)).toISOString();

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

describe('Phase 3 S1a task hierarchy, notes, and archived restore commands', () => {
  it('creates a child with a sibling-scoped sort index and the exact correlated Event pair', async () => {
    const parent = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: 'S1a 父任务', destination: 'list',
    });
    const first = await createSubtask({
      now: at(1), timezone: TIMEZONE, parentId: parent.value.id,
      title: 'S1a 子任务一', estimatedPomodoros: 2,
    });
    const second = await createSubtask({
      now: at(2), timezone: TIMEZONE, parentId: parent.value.id,
      title: 'S1a 子任务二', estimatedPomodoros: 3,
    });

    expect(first.value).toMatchObject({ parentId: parent.value.id, sortIndex: 1000 });
    expect(second.value).toMatchObject({ parentId: parent.value.id, sortIndex: 2000 });
    expect((await eventsFor(first.correlationId)).map((event) => event.type)).toEqual([
      'task.created',
      'subtask.added',
    ]);
    expect(await eventsFor(first.correlationId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'task.created',
        taskId: first.value.id,
        payload: expect.objectContaining({ parentId: parent.value.id, source: 'manual' }),
      }),
      expect.objectContaining({
        type: 'subtask.added',
        taskId: first.value.id,
        payload: {
          parentId: parent.value.id,
          title: 'S1a 子任务一',
          estimatedPomodoros: 2,
          source: 'listPage',
        },
      }),
    ]));

    await expect(createSubtask({
      now: at(3), timezone: TIMEZONE, parentId: first.value.id, title: '非法第三层',
    })).rejects.toThrow(/顶层/);
  });

  it('reorders only one sibling domain without changing top-level or another parent order', async () => {
    const parentA = await createManualTask({
      now: at(4), timezone: TIMEZONE, title: 'S1a 排序父 A', destination: 'list',
    });
    const parentB = await createManualTask({
      now: at(5), timezone: TIMEZONE, title: 'S1a 排序父 B', destination: 'list',
    });
    const a1 = await createSubtask({
      now: at(6), timezone: TIMEZONE, parentId: parentA.value.id, title: 'A1',
    });
    const a2 = await createSubtask({
      now: at(7), timezone: TIMEZONE, parentId: parentA.value.id, title: 'A2',
    });
    const b1 = await createSubtask({
      now: at(8), timezone: TIMEZONE, parentId: parentB.value.id, title: 'B1',
    });
    const before = await loadCurrentTaskViews({ now: at(9), timezone: TIMEZONE });
    const topLevelIds = before.activeTasks.map(({ id }) => id);
    const bOrder = before.subtasksByParentId[parentB.value.id]!.map(({ id }) => id);

    const reordered = await reorderSubtask({
      now: at(10), timezone: TIMEZONE, parentId: parentA.value.id, fromIndex: 1, toIndex: 0,
    });
    expect(reordered.value.id).toBe(a2.value.id);
    expect((await eventsFor(reordered.correlationId))[0]).toMatchObject({
      type: 'subtask.reordered',
      taskId: a2.value.id,
      payload: { parentId: parentA.value.id, fromIndex: 1, toIndex: 0 },
    });
    const after = await loadCurrentTaskViews({ now: at(11), timezone: TIMEZONE });
    expect(after.subtasksByParentId[parentA.value.id]!.map(({ id }) => id)).toEqual([
      a2.value.id,
      a1.value.id,
    ]);
    expect(after.subtasksByParentId[parentB.value.id]!.map(({ id }) => id)).toEqual(bOrder);
    expect(after.activeTasks.map(({ id }) => id)).toEqual(topLevelIds);
    expect(b1.value.sortIndex).toBe(1000);
  });

  it('moves a top-level today Task under a parent in one transaction and can promote it back', async () => {
    const parent = await createManualTask({
      now: at(12), timezone: TIMEZONE, title: 'S1a 层级父', destination: 'list',
    });
    const child = await createManualTask({
      now: at(13), timezone: TIMEZONE, title: 'S1a 今日转子', destination: 'today',
    });
    const before = await loadCurrentTaskViews({ now: at(14), timezone: TIMEZONE });
    expect(before.dayPlan.taskIds).toContain(child.value.id);

    const moved = await moveTopLevelTaskToSubtask({
      now: at(15), timezone: TIMEZONE, taskId: child.value.id,
      parentId: parent.value.id, toIndex: 0,
    });
    expect(moved.value).toMatchObject({ parentId: parent.value.id, sortIndex: 1000 });
    expect((await eventsFor(moved.correlationId)).map((event) => event.type)).toEqual([
      'dayPlan.taskRemoved',
      'task.movedToList',
      'task.reparented',
    ]);
    expect((await eventsFor(moved.correlationId))[2]).toMatchObject({
      payload: { fromParentId: null, toParentId: parent.value.id, toIndex: 0 },
    });
    const [dayPlanAfterMove] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    expect(dayPlanAfterMove!.taskIds).not.toContain(child.value.id);

    const promoted = await promoteSubtaskToTopLevel({
      now: at(16), timezone: TIMEZONE, taskId: child.value.id,
    });
    expect(promoted.value.parentId).toBeNull();
    expect((await eventsFor(promoted.correlationId))[0]).toMatchObject({
      type: 'subtask.unparented',
      payload: { previousParentId: parent.value.id },
    });
    const views = await loadCurrentTaskViews({ now: at(17), timezone: TIMEZONE });
    expect(views.activeTasks.map(({ id }) => id)).toContain(child.value.id);
    expect(views.dayPlan.taskIds).not.toContain(child.value.id);
  });

  it('rejects making a Task with children into a child without partial writes', async () => {
    const source = await createManualTask({
      now: at(18), timezone: TIMEZONE, title: 'S1a 已有子项', destination: 'list',
    });
    await createSubtask({
      now: at(19), timezone: TIMEZONE, parentId: source.value.id, title: 'S1a 已有子项的子项',
    });
    const target = await createManualTask({
      now: at(20), timezone: TIMEZONE, title: 'S1a 目标父', destination: 'list',
    });
    const before = await dataStore.get<Task>(STORE.tasks, source.value.id);
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(moveTopLevelTaskToSubtask({
      now: at(21), timezone: TIMEZONE, taskId: source.value.id,
      parentId: target.value.id, toIndex: 0,
    })).rejects.toThrow(/已有子任务/);
    expect(await dataStore.get<Task>(STORE.tasks, source.value.id)).toEqual(before);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('keeps top-level and child sort domains independent and never adds a child to DayPlan', async () => {
    const parent = await createManualTask({
      now: at(43), timezone: TIMEZONE, title: 'S1a 排序域父', destination: 'list',
    });
    const child = await createSubtask({
      now: at(44), timezone: TIMEZONE, parentId: parent.value.id, title: 'S1a 高序子',
    });
    await executeAtomicWrite(
      { storeNames: [STORE.tasks, EVENT_STORE], now: at(45), timezone: TIMEZONE },
      async (transaction) => {
        await transaction.put(STORE.tasks, {
          ...child.value,
          sortIndex: 9_999_000,
          updatedAt: at(45),
        });
      },
    );
    const before = await loadCurrentTaskViews({ now: at(46), timezone: TIMEZONE });
    const topLevelMax = before.activeTasks.reduce(
      (maximum, task) => Math.max(maximum, task.sortIndex),
      0,
    );
    const created = await createManualTask({
      now: at(47), timezone: TIMEZONE, title: 'S1a 顶层不受子序影响', destination: 'list',
    });
    expect(created.value.sortIndex).toBe(topLevelMax + 1000);
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(addTaskToToday({
      now: at(48), timezone: TIMEZONE, taskId: child.value.id, source: 'button',
    })).rejects.toThrow(/顶层/);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });

  it('reuses generic Task lifecycle commands for children without cascading to siblings or parent', async () => {
    const parent = await createManualTask({
      now: at(49), timezone: TIMEZONE, title: 'S1a 生命周期父', destination: 'list',
    });
    const child = await createSubtask({
      now: at(50), timezone: TIMEZONE, parentId: parent.value.id, title: 'S1a 生命周期子',
    });
    const sibling = await createSubtask({
      now: at(51), timezone: TIMEZONE, parentId: parent.value.id, title: 'S1a 生命周期兄弟',
    });
    await updateTaskTitle({
      now: at(52), timezone: TIMEZONE, taskId: child.value.id, title: 'S1a 生命周期子（改）',
    });
    await adjustTaskEstimate({
      now: at(53), timezone: TIMEZONE, taskId: child.value.id, estimatedPomodoros: 2,
    });
    await completeTaskManually({ now: at(54), timezone: TIMEZONE, taskId: child.value.id });
    await uncompleteTask({ now: at(55), timezone: TIMEZONE, taskId: child.value.id });
    await completeTaskManually({ now: at(56), timezone: TIMEZONE, taskId: child.value.id });
    const archived = await archiveCompletedTask({
      now: at(57), timezone: TIMEZONE, taskId: child.value.id,
    });
    expect(archived.value).toMatchObject({
      parentId: parent.value.id,
      status: 'archived',
      outcome: 'completed',
    });
    expect(await dataStore.get<Task>(STORE.tasks, parent.value.id)).toMatchObject({ status: 'active' });
    expect(await dataStore.get<Task>(STORE.tasks, sibling.value.id)).toMatchObject({ status: 'active' });

    const deletedChild = await createSubtask({
      now: at(58), timezone: TIMEZONE, parentId: parent.value.id, title: 'S1a 待删子',
    });
    await deleteActiveTask({ now: at(59), timezone: TIMEZONE, taskId: deletedChild.value.id });
    expect(await dataStore.get<Task>(STORE.tasks, deletedChild.value.id)).toBeUndefined();
    expect(await dataStore.getIncludingDeleted<Task>(STORE.tasks, deletedChild.value.id))
      .toMatchObject({ status: 'deleted', parentId: parent.value.id });
    expect(await dataStore.get<Task>(STORE.tasks, sibling.value.id)).toMatchObject({ status: 'active' });
  });

  it('edits active notes and completed/archived actual-work notes with exact task.updated mirrors', async () => {
    const task = await createManualTask({
      now: at(22), timezone: TIMEZONE, title: 'S1a 备注', destination: 'list',
    });
    const noted = await updateTaskNote({
      now: at(23), timezone: TIMEZONE, taskId: task.value.id, note: '执行中的完整备注',
    });
    expect(noted.value.note).toBe('执行中的完整备注');
    expect((await eventsFor(noted.correlationId))[0]).toMatchObject({
      type: 'task.updated',
      payload: { field: 'note', oldValue: null, newValue: '执行中的完整备注' },
    });

    await completeTaskManually({ now: at(24), timezone: TIMEZONE, taskId: task.value.id });
    await expect(updateTaskNote({
      now: at(25), timezone: TIMEZONE, taskId: task.value.id, note: '不允许',
    })).rejects.toThrow(/active\/splitNeeded/);
    const actual = await updateTaskActualWorkNote({
      now: at(26), timezone: TIMEZONE, taskId: task.value.id, actualWorkNote: '实际完成内容',
    });
    expect(actual.value.actualWorkNote).toBe('实际完成内容');
    expect((await eventsFor(actual.correlationId))[0]).toMatchObject({
      payload: { field: 'actualWorkNote', oldValue: null, newValue: '实际完成内容' },
    });
    await archiveCompletedTask({ now: at(27), timezone: TIMEZONE, taskId: task.value.id });
    await expect(updateTaskActualWorkNote({
      now: at(28), timezone: TIMEZONE, taskId: task.value.id, actualWorkNote: '归档后补充',
    })).resolves.toMatchObject({ value: { actualWorkNote: '归档后补充' } });
  });

  it('restores completed and split archives to the confirmed semantic states and preserves old Events', async () => {
    const completed = await createManualTask({
      now: at(29), timezone: TIMEZONE, title: 'S1a 完成恢复', destination: 'list',
    });
    await completeTaskManually({ now: at(30), timezone: TIMEZONE, taskId: completed.value.id });
    await archiveCompletedTask({ now: at(31), timezone: TIMEZONE, taskId: completed.value.id });
    const oldEvents = (await dataStore.getAll<Event>(EVENT_STORE)).filter(
      ({ taskId }) => taskId === completed.value.id,
    );
    const restoredCompleted = await restoreArchivedTask({
      now: at(32), timezone: TIMEZONE, taskId: completed.value.id,
    });
    expect(restoredCompleted.value).toMatchObject({
      status: 'completed', outcome: null, archivedAt: null,
      completedAt: at(30), completionSource: 'manual',
    });
    expect((await eventsFor(restoredCompleted.correlationId))[0]).toMatchObject({
      type: 'task.restored', payload: { restoredFrom: 'archived' },
    });
    for (const event of oldEvents) {
      expect(await dataStore.get<Event>(EVENT_STORE, event.id)).toEqual(event);
    }

    const splitArchive = makeTask({
      now: at(33),
      title: 'S1a 拆分恢复',
      status: 'archived',
      outcome: 'split',
      archivedAt: at(34),
      sortIndex: 99_000,
    });
    await executeAtomicWrite(
      { storeNames: [STORE.tasks, EVENT_STORE], now: at(34), timezone: TIMEZONE },
      (transaction) => transaction.put(STORE.tasks, splitArchive),
    );
    const restoredSplit = await restoreArchivedTask({
      now: at(35), timezone: TIMEZONE, taskId: splitArchive.id,
    });
    expect(restoredSplit.value).toMatchObject({
      status: 'active', outcome: null, archivedAt: null,
      completedAt: null, completionSource: null,
    });
    await expect(restoreArchivedTask({
      now: at(36), timezone: TIMEZONE, taskId: splitArchive.id,
    })).rejects.toThrow(/archived/);
  });

  it('rolls back Task and Event writes when later Event validation fails', async () => {
    const parent = await createManualTask({
      now: at(37), timezone: TIMEZONE, title: 'S1a 回滚父', destination: 'list',
    });
    let eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const createFault = { reads: 0 };
    await expect(createSubtask(failTimezoneAfterReads({
      now: at(38), parentId: parent.value.id, title: 'S1a 回滚子',
    }, 2, createFault))).rejects.toThrow();
    expect(createFault.reads).toBe(3);
    expect((await dataStore.getAll<Task>(STORE.tasks)).some(({ title }) => title === 'S1a 回滚子'))
      .toBe(false);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const completed = await createManualTask({
      now: at(39), timezone: TIMEZONE, title: 'S1a 恢复回滚', destination: 'list',
    });
    await completeTaskManually({ now: at(40), timezone: TIMEZONE, taskId: completed.value.id });
    await archiveCompletedTask({ now: at(41), timezone: TIMEZONE, taskId: completed.value.id });
    const archivedBefore = await dataStore.get<Task>(STORE.tasks, completed.value.id);
    eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const restoreFault = { reads: 0 };
    await expect(restoreArchivedTask(failTimezoneAfterReads({
      now: at(42), taskId: completed.value.id,
    }, 1, restoreFault))).rejects.toThrow();
    expect(restoreFault.reads).toBe(2);
    expect(await dataStore.get<Task>(STORE.tasks, completed.value.id)).toEqual(archivedBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const moveParent = await createManualTask({
      now: at(60), timezone: TIMEZONE, title: 'S1a 转层回滚父', destination: 'list',
    });
    const moveChild = await createManualTask({
      now: at(61), timezone: TIMEZONE, title: 'S1a 转层回滚任务', destination: 'today',
    });
    const moveBefore = await dataStore.get<Task>(STORE.tasks, moveChild.value.id);
    const [moveDayPlanBefore] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const moveFault = { reads: 0 };
    await expect(moveTopLevelTaskToSubtask(failTimezoneAfterReads({
      now: at(62), taskId: moveChild.value.id, parentId: moveParent.value.id, toIndex: 0,
    }, 5, moveFault))).rejects.toThrow();
    expect(moveFault.reads).toBeGreaterThanOrEqual(6);
    expect(await dataStore.get<Task>(STORE.tasks, moveChild.value.id)).toEqual(moveBefore);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, moveDayPlanBefore!.id))
      .toEqual(moveDayPlanBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });
});
