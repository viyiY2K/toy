import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { DayPlan, Event, Settings, Task } from '../schema';
import { loadCurrentTaskViews } from '../queries/currentTaskViews';
import {
  BatchTaskPreflightError,
  batchAddTasksToToday,
  batchArchiveCompletedTasks,
  batchMoveTasksToList,
} from './batchTaskCommands';
import { captureTriageTask } from './awarenessCommands';
import {
  completeTaskManually,
  createManualTask,
  createSubtask,
} from './taskCommands';
import { discardFocus, startFocus } from './timerCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (step: number) => new Date(Date.UTC(2026, 11, 9, 1, step)).toISOString();

async function writeState() {
  return {
    tasks: await dataStore.getAllIncludingDeleted<Task>(STORE.tasks),
    dayPlans: await dataStore.getAllIncludingDeleted<DayPlan>(STORE.dayPlans),
    settings: await dataStore.getAllIncludingDeleted<Settings>(STORE.settings),
    events: await dataStore.getAll<Event>(EVENT_STORE),
  };
}

async function expectPreflightZeroWrite(action: () => Promise<unknown>): Promise<void> {
  const before = await writeState();
  await expect(action()).rejects.toBeInstanceOf(BatchTaskPreflightError);
  expect(await writeState()).toEqual(before);
}

function eventTypesFor(correlationId: string, events: readonly Event[]): string[] {
  return events
    .filter((event) => event.correlationId === correlationId)
    .map(({ type }) => type);
}

describe('Phase 3 S1c safe batch Task commands', () => {
  it('batch-adds eligible top-level Tasks to today in stable input order', async () => {
    const first = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: 'S1c 加今日一', destination: 'list',
    });
    const second = await createManualTask({
      now: at(1), timezone: TIMEZONE, title: 'S1c 加今日二', destination: 'list',
    });
    const third = await createManualTask({
      now: at(2), timezone: TIMEZONE, title: 'S1c 加今日三', destination: 'list',
    });
    const before = (await loadCurrentTaskViews({ now: at(3), timezone: TIMEZONE })).dayPlan.taskIds;

    const result = await batchAddTasksToToday({
      now: at(4), timezone: TIMEZONE,
      taskIds: [third.value.id, first.value.id, second.value.id],
    });

    expect(result.failed).toEqual([]);
    expect(result.notAttempted).toEqual([]);
    expect(result.succeeded.map(({ taskId }) => taskId)).toEqual([
      third.value.id, first.value.id, second.value.id,
    ]);
    const views = await loadCurrentTaskViews({ now: at(5), timezone: TIMEZONE });
    expect(views.dayPlan.taskIds).toEqual([
      ...before, third.value.id, first.value.id, second.value.id,
    ]);
    const events = await dataStore.getAll<Event>(EVENT_STORE);
    for (const success of result.succeeded) {
      expect(eventTypesFor(success.correlationId, events)).toEqual([
        'dayPlan.taskAdded', 'task.movedToToday',
      ]);
    }
  });

  it('rejects duplicate, missing, child, pending, and already-today add inputs before any write', async () => {
    const parent = await createManualTask({
      now: at(10), timezone: TIMEZONE, title: 'S1c 加今日父', destination: 'list',
    });
    const child = await createSubtask({
      now: at(11), timezone: TIMEZONE, parentId: parent.value.id, title: 'S1c 加今日子',
    });
    const today = await createManualTask({
      now: at(12), timezone: TIMEZONE, title: 'S1c 已在今日', destination: 'today',
    });
    const focus = await startFocus({
      now: at(13), timezone: TIMEZONE, taskId: today.value.id,
    });
    const pending = await captureTriageTask({
      now: at(14), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1c 待分流',
    });
    await discardFocus({
      now: at(15), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 1,
    });

    await expectPreflightZeroWrite(() => batchAddTasksToToday({
      now: at(16), timezone: TIMEZONE,
      taskIds: [
        parent.value.id,
        parent.value.id,
        child.value.id,
        pending.value.id,
        today.value.id,
        'missing-task',
      ],
    }));
  });

  it('batch-moves eligible today Tasks back to a deterministic top-level activity order', async () => {
    const first = await createManualTask({
      now: at(20), timezone: TIMEZONE, title: 'S1c 移清单一', destination: 'today',
    });
    const second = await createManualTask({
      now: at(21), timezone: TIMEZONE, title: 'S1c 移清单二', destination: 'today',
    });
    const result = await batchMoveTasksToList({
      now: at(22), timezone: TIMEZONE, taskIds: [second.value.id, first.value.id],
    });

    expect(result.succeeded.map(({ taskId }) => taskId)).toEqual([
      second.value.id, first.value.id,
    ]);
    expect(result.failed).toEqual([]);
    expect(result.notAttempted).toEqual([]);
    const views = await loadCurrentTaskViews({ now: at(23), timezone: TIMEZONE });
    expect(views.dayPlan.taskIds).not.toContain(first.value.id);
    expect(views.dayPlan.taskIds).not.toContain(second.value.id);
    const moved = views.activeTasks.filter(({ id }) => id === first.value.id || id === second.value.id);
    expect(moved.map(({ id }) => id)).toEqual(
      [first.value, second.value]
        .sort((left, right) => left.sortIndex - right.sortIndex || left.id.localeCompare(right.id))
        .map(({ id }) => id),
    );
    const events = await dataStore.getAll<Event>(EVENT_STORE);
    for (const success of result.succeeded) {
      expect(eventTypesFor(success.correlationId, events)).toEqual([
        'dayPlan.taskRemoved', 'task.movedToList',
      ]);
    }
  });

  it('preflights every move-to-list and completed-only archive input with zero writes', async () => {
    const today = await createManualTask({
      now: at(30), timezone: TIMEZONE, title: 'S1c 合法移清单', destination: 'today',
    });
    const list = await createManualTask({
      now: at(31), timezone: TIMEZONE, title: 'S1c 不在今日', destination: 'list',
    });
    await expectPreflightZeroWrite(() => batchMoveTasksToList({
      now: at(32), timezone: TIMEZONE, taskIds: [today.value.id, list.value.id],
    }));

    await completeTaskManually({ now: at(33), timezone: TIMEZONE, taskId: list.value.id });
    await expectPreflightZeroWrite(() => batchArchiveCompletedTasks({
      now: at(34), timezone: TIMEZONE, taskIds: [list.value.id, today.value.id],
    }));
  });

  it('batch-archives only completed Tasks with one existing single-Task transaction per item', async () => {
    const first = await createManualTask({
      now: at(40), timezone: TIMEZONE, title: 'S1c 归档一', destination: 'today',
    });
    const second = await createManualTask({
      now: at(41), timezone: TIMEZONE, title: 'S1c 归档二', destination: 'list',
    });
    await completeTaskManually({ now: at(42), timezone: TIMEZONE, taskId: first.value.id });
    await completeTaskManually({ now: at(43), timezone: TIMEZONE, taskId: second.value.id });

    const result = await batchArchiveCompletedTasks({
      now: at(44), timezone: TIMEZONE, taskIds: [second.value.id, first.value.id],
    });

    expect(result.succeeded.map(({ taskId }) => taskId)).toEqual([
      second.value.id, first.value.id,
    ]);
    const archived = await dataStore.getAll<Task>(STORE.tasks);
    expect(archived.filter(({ id }) => id === first.value.id || id === second.value.id))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.value.id, status: 'archived', outcome: 'completed' }),
        expect.objectContaining({ id: second.value.id, status: 'archived', outcome: 'completed' }),
      ]));
    const events = await dataStore.getAll<Event>(EVENT_STORE);
    expect(eventTypesFor(result.succeeded[0]!.correlationId, events)).toEqual(['task.archived']);
    expect(eventTypesFor(result.succeeded[1]!.correlationId, events)).toEqual([
      'task.archived', 'dayPlan.taskRemoved',
    ]);
  });

  it('stops after a runtime failure and returns ordered succeeded, failed, and notAttempted details', async () => {
    const first = await createManualTask({
      now: at(50), timezone: TIMEZONE, title: 'S1c 部分成功一', destination: 'list',
    });
    const second = await createManualTask({
      now: at(51), timezone: TIMEZONE, title: 'S1c 运行失败二', destination: 'list',
    });
    const third = await createManualTask({
      now: at(52), timezone: TIMEZONE, title: 'S1c 未尝试三', destination: 'list',
    });
    let timezoneReads = 0;
    const clock = Object.defineProperty({
      now: at(53), taskIds: [first.value.id, second.value.id, third.value.id],
    }, 'timezone', {
      enumerable: true,
      get: () => (++timezoneReads <= 2 ? TIMEZONE : 'Invalid/TimeZone'),
    }) as { now: string; timezone: string; taskIds: string[] };

    const result = await batchAddTasksToToday(clock);

    expect(result.succeeded).toHaveLength(1);
    expect(result.succeeded[0]?.taskId).toBe(first.value.id);
    expect(result.failed).toEqual([
      expect.objectContaining({ taskId: second.value.id, message: expect.any(String) }),
    ]);
    expect(result.notAttempted).toEqual([third.value.id]);
    const views = await loadCurrentTaskViews({ now: at(54), timezone: TIMEZONE });
    expect(views.dayPlan.taskIds).toContain(first.value.id);
    expect(views.dayPlan.taskIds).not.toContain(second.value.id);
    expect(views.dayPlan.taskIds).not.toContain(third.value.id);
  });
});
