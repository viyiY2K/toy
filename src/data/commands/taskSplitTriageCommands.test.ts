import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { DayPlan, Event, Session, Task } from '../schema';
import { loadCurrentTaskViews } from '../queries/currentTaskViews';
import {
  captureTriageTask,
  dismissTriageTask,
  moveTriageTaskToList,
  moveTriageTaskToToday,
} from './awarenessCommands';
import {
  completeTaskManually,
  createManualTask,
  createSubtask,
  deleteActiveTask,
  restoreArchivedTask,
  splitTask,
} from './taskCommands';
import { discardFocus, startFocus } from './timerCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (step: number) => new Date(Date.UTC(2026, 11, 8, 1, step)).toISOString();

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

async function writeState() {
  return {
    tasks: await dataStore.getAllIncludingDeleted<Task>(STORE.tasks),
    dayPlans: await dataStore.getAll<DayPlan>(STORE.dayPlans),
    events: await dataStore.getAll<Event>(EVENT_STORE),
  };
}

async function expectRejectedWithoutWrites(action: () => Promise<unknown>): Promise<void> {
  const before = await writeState();
  await expect(action()).rejects.toThrow();
  expect(await writeState()).toEqual(before);
}

describe('Phase 3 S1b task split commands', () => {
  it('archives a today Task, creates one split child, and writes the exact correlated facts', async () => {
    const source = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: 'S1b 今日拆分源', estimatedPomodoros: 3,
      destination: 'today',
    });
    const result = await splitTask({
      now: at(1), timezone: TIMEZONE, taskId: source.value.id,
      newTitle: 'S1b 拆分后的下一步', estimatedPomodoros: 2,
    });

    expect(result.value.archivedTask).toMatchObject({
      id: source.value.id,
      status: 'archived',
      outcome: 'split',
      archivedAt: at(1),
      completedAt: null,
      completionSource: null,
    });
    expect(result.value.newTask).toMatchObject({
      status: 'active',
      parentId: null,
      lineageId: source.value.lineageId,
      splitFromTaskId: source.value.id,
      splitIndex: 1,
      metadata: { source: 'splitChild' },
      sortIndex: source.value.sortIndex,
    });
    const events = await eventsFor(result.correlationId);
    expect(events.map(({ type }) => type)).toEqual([
      'task.split',
      'task.archived',
      'task.created',
      'dayPlan.taskRemoved',
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'task.split',
        taskId: source.value.id,
        payload: { lineageId: source.value.lineageId, newTaskId: result.value.newTask.id },
      }),
      expect.objectContaining({
        type: 'task.created',
        taskId: result.value.newTask.id,
        payload: expect.objectContaining({ source: 'splitChild', parentId: null }),
      }),
      expect.objectContaining({
        type: 'dayPlan.taskRemoved',
        taskId: source.value.id,
        payload: { reason: 'taskArchived' },
      }),
    ]));
    expect(new Set(events.map(({ correlationId }) => correlationId))).toEqual(
      new Set([result.correlationId]),
    );
    const views = await loadCurrentTaskViews({ now: at(2), timezone: TIMEZONE });
    expect(views.dayPlan.taskIds).not.toContain(source.value.id);
    expect(views.dayPlan.taskIds).not.toContain(result.value.newTask.id);
    expect(views.activeTasks.map(({ id }) => id)).toContain(result.value.newTask.id);
    expect(views.archivedTasks.map(({ id }) => id)).toContain(source.value.id);
  });

  it('inherits parentId across a split chain, increments splitIndex, and never emits subtask.added', async () => {
    const parent = await createManualTask({
      now: at(3), timezone: TIMEZONE, title: 'S1b 拆分母任务', destination: 'list',
    });
    const child = await createSubtask({
      now: at(4), timezone: TIMEZONE, parentId: parent.value.id, title: 'S1b 子任务拆分源',
    });
    const first = await splitTask({
      now: at(5), timezone: TIMEZONE, taskId: child.value.id,
      newTitle: 'S1b 子任务拆分一', estimatedPomodoros: 1,
    });
    const second = await splitTask({
      now: at(6), timezone: TIMEZONE, taskId: first.value.newTask.id,
      newTitle: 'S1b 子任务拆分二', estimatedPomodoros: 2,
    });

    expect(first.value.newTask).toMatchObject({
      parentId: parent.value.id,
      lineageId: child.value.lineageId,
      splitIndex: 1,
    });
    expect(second.value.newTask).toMatchObject({
      parentId: parent.value.id,
      lineageId: child.value.lineageId,
      splitFromTaskId: first.value.newTask.id,
      splitIndex: 2,
    });
    expect((await eventsFor(first.correlationId)).map(({ type }) => type)).toEqual([
      'task.split', 'task.archived', 'task.created',
    ]);
    expect((await eventsFor(second.correlationId)).some(({ type }) => type === 'subtask.added'))
      .toBe(false);
  });

  it('never reuses a splitIndex retained only by a soft-deleted lineage successor', async () => {
    const source = await createManualTask({
      now: at(7), timezone: TIMEZONE, title: 'S1b 保留血缘源', destination: 'list',
    });
    const first = await splitTask({
      now: at(8), timezone: TIMEZONE, taskId: source.value.id,
      newTitle: 'S1b 血缘一', estimatedPomodoros: 1,
    });
    await restoreArchivedTask({ now: at(9), timezone: TIMEZONE, taskId: source.value.id });
    const second = await splitTask({
      now: at(10), timezone: TIMEZONE, taskId: first.value.newTask.id,
      newTitle: 'S1b 血缘二', estimatedPomodoros: 1,
    });
    expect(second.value.newTask.splitIndex).toBe(2);
    await deleteActiveTask({
      now: at(11), timezone: TIMEZONE, taskId: second.value.newTask.id,
    });
    expect(await dataStore.get<Task>(STORE.tasks, second.value.newTask.id)).toBeUndefined();
    expect((await dataStore.getIncludingDeleted<Task>(STORE.tasks, second.value.newTask.id))?.splitIndex)
      .toBe(2);

    const third = await splitTask({
      now: at(12), timezone: TIMEZONE, taskId: source.value.id,
      newTitle: 'S1b 血缘三', estimatedPomodoros: 1,
    });
    expect(third.value.newTask).toMatchObject({
      lineageId: source.value.lineageId,
      splitFromTaskId: source.value.id,
      splitIndex: 3,
    });
  });

  it('rejects non-active sources and rolls back all split entities and Events on the last Event fault', async () => {
    const completed = await createManualTask({
      now: at(7), timezone: TIMEZONE, title: 'S1b 不可拆完成任务', destination: 'list',
    });
    await completeTaskManually({ now: at(8), timezone: TIMEZONE, taskId: completed.value.id });
    await expect(splitTask({
      now: at(9), timezone: TIMEZONE, taskId: completed.value.id,
      newTitle: '非法拆分', estimatedPomodoros: 1,
    })).rejects.toThrow(/active\/splitNeeded/);

    const source = await createManualTask({
      now: at(10), timezone: TIMEZONE, title: 'S1b 拆分回滚源', destination: 'today',
    });
    const sourceBefore = await dataStore.get<Task>(STORE.tasks, source.value.id);
    const [dayPlanBefore] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    const taskIdsBefore = (await dataStore.getAllIncludingDeleted<Task>(STORE.tasks))
      .map(({ id }) => id)
      .sort();
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const fault = { reads: 0 };
    await expect(splitTask(failTimezoneAfterReads({
      now: at(11), taskId: source.value.id,
      newTitle: 'S1b 不应留下的新任务', estimatedPomodoros: 1,
    }, 6, fault))).rejects.toThrow();
    expect(fault.reads).toBeGreaterThanOrEqual(7);
    expect(await dataStore.get<Task>(STORE.tasks, source.value.id)).toEqual(sourceBefore);
    expect((await dataStore.getAllIncludingDeleted<Task>(STORE.tasks)).map(({ id }) => id).sort())
      .toEqual(taskIdsBefore);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, dayPlanBefore!.id)).toEqual(dayPlanBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });
});

describe('Phase 3 S1b triage commands', () => {
  it('captures a pending Task only during active focus without mutating the focus', async () => {
    const focusTask = await createManualTask({
      now: at(20), timezone: TIMEZONE, title: 'S1b 捕获时专注任务', destination: 'today',
    });
    const focus = await startFocus({
      now: at(21), timezone: TIMEZONE, taskId: focusTask.value.id,
    });
    const focusBefore = await dataStore.get<Session>(STORE.sessions, focus.value.id);
    const captured = await captureTriageTask({
      now: at(22), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 待分流事项',
    });
    expect(captured.value).toMatchObject({
      parentId: null,
      status: 'active',
      estimatedPomodoros: 1,
      metadata: { source: 'triageCapture', triageStatus: 'pending' },
    });
    const events = await eventsFor(captured.correlationId);
    expect(events.map(({ type }) => type)).toEqual(['task.created', 'triage.captured']);
    expect(events[0]).toMatchObject({
      taskId: captured.value.id,
      sessionId: null,
      dayPlanId: null,
      payload: expect.objectContaining({ source: 'triageCapture' }),
    });
    expect(events[1]).toMatchObject({
      taskId: captured.value.id,
      sessionId: focus.value.id,
      dayPlanId: focus.value.dayPlanId,
      payload: { title: 'S1b 待分流事项' },
    });
    expect(await dataStore.get<Session>(STORE.sessions, focus.value.id)).toEqual(focusBefore);
    expect((await loadCurrentTaskViews({ now: at(23), timezone: TIMEZONE }))
      .pendingTriageTasks.map(({ id }) => id)).toContain(captured.value.id);
    await discardFocus({
      now: at(24), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 3,
    });
    await expect(captureTriageTask({
      now: at(25), timezone: TIMEZONE, sessionId: focus.value.id, title: '不可捕获',
    })).rejects.toThrow(/active focus/);
  });

  it('moves pending Tasks to the activity list or today with exact state/Event transitions', async () => {
    const focusTask = await createManualTask({
      now: at(26), timezone: TIMEZONE, title: 'S1b 分流专注任务', destination: 'today',
    });
    const focus = await startFocus({ now: at(27), timezone: TIMEZONE, taskId: focusTask.value.id });
    const toList = await captureTriageTask({
      now: at(28), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 移活动',
    });
    const toToday = await captureTriageTask({
      now: at(29), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 移今日',
    });
    await discardFocus({
      now: at(30), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 3,
    });

    const listed = await moveTriageTaskToList({
      now: at(31), timezone: TIMEZONE, taskId: toList.value.id,
    });
    expect(listed.value.metadata.triageStatus).toBeNull();
    expect((await eventsFor(listed.correlationId)).map(({ type }) => type))
      .toEqual(['triage.movedToList']);
    const today = await moveTriageTaskToToday({
      now: at(32), timezone: TIMEZONE, taskId: toToday.value.id,
    });
    expect(today.value.task.metadata.triageStatus).toBeNull();
    expect(today.value.dayPlan.taskIds.at(-1)).toBe(toToday.value.id);
    expect((await eventsFor(today.correlationId)).map(({ type }) => type)).toEqual([
      'triage.movedToToday', 'dayPlan.taskAdded',
    ]);

    const views = await loadCurrentTaskViews({ now: at(33), timezone: TIMEZONE });
    expect(views.pendingTriageTasks.map(({ id }) => id)).toEqual(
      expect.not.arrayContaining([toList.value.id, toToday.value.id]),
    );
    expect(views.activeTasks.map(({ id }) => id)).toContain(toList.value.id);
    expect(views.todayTasks.map(({ id }) => id)).toContain(toToday.value.id);
  });

  it('dismisses pending Tasks by soft delete with the required correlated Event pair', async () => {
    const focusTask = await createManualTask({
      now: at(34), timezone: TIMEZONE, title: 'S1b 放弃专注任务', destination: 'list',
    });
    const focus = await startFocus({ now: at(35), timezone: TIMEZONE, taskId: focusTask.value.id });
    const captured = await captureTriageTask({
      now: at(36), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 待放弃',
    });
    await discardFocus({
      now: at(37), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 2,
    });
    const dismissed = await dismissTriageTask({
      now: at(38), timezone: TIMEZONE, taskId: captured.value.id, dismissReason: '临时打扰',
    });
    expect(dismissed.value).toMatchObject({
      status: 'deleted',
      deletedAt: at(38),
      deletedReason: 'triageDismissed',
    });
    expect(await dataStore.get<Task>(STORE.tasks, captured.value.id)).toBeUndefined();
    expect(await dataStore.getIncludingDeleted<Task>(STORE.tasks, captured.value.id))
      .toEqual(dismissed.value);
    const events = await eventsFor(dismissed.correlationId);
    expect(events.map(({ type }) => type)).toEqual(['triage.dismissed', 'task.deleted']);
    expect(events[0]).toMatchObject({ payload: { dismissReason: '临时打扰' } });
    expect(events[1]).toMatchObject({ payload: { deletedReason: 'triageDismissed' } });
  });

  it('rejects non-pending and repeated triage dispositions without any Task, DayPlan, or Event write', async () => {
    const ordinary = await createManualTask({
      now: at(47), timezone: TIMEZONE, title: 'S1b 普通非分流任务', destination: 'list',
    });
    await expectRejectedWithoutWrites(() => moveTriageTaskToList({
      now: at(48), timezone: TIMEZONE, taskId: ordinary.value.id,
    }));
    await expectRejectedWithoutWrites(() => moveTriageTaskToToday({
      now: at(49), timezone: TIMEZONE, taskId: ordinary.value.id,
    }));
    await expectRejectedWithoutWrites(() => dismissTriageTask({
      now: at(50), timezone: TIMEZONE, taskId: ordinary.value.id,
    }));

    const focusTask = await createManualTask({
      now: at(51), timezone: TIMEZONE, title: 'S1b 重复分流专注', destination: 'today',
    });
    const focus = await startFocus({ now: at(52), timezone: TIMEZONE, taskId: focusTask.value.id });
    const toList = await captureTriageTask({
      now: at(53), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 重复移活动',
    });
    const toToday = await captureTriageTask({
      now: at(54), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 重复移今日',
    });
    const toDismiss = await captureTriageTask({
      now: at(55), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 重复放弃',
    });
    await discardFocus({
      now: at(56), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 1,
    });

    await moveTriageTaskToList({ now: at(57), timezone: TIMEZONE, taskId: toList.value.id });
    await expectRejectedWithoutWrites(() => moveTriageTaskToList({
      now: at(58), timezone: TIMEZONE, taskId: toList.value.id,
    }));
    await moveTriageTaskToToday({ now: at(59), timezone: TIMEZONE, taskId: toToday.value.id });
    await expectRejectedWithoutWrites(() => moveTriageTaskToToday({
      now: at(60), timezone: TIMEZONE, taskId: toToday.value.id,
    }));
    await dismissTriageTask({ now: at(61), timezone: TIMEZONE, taskId: toDismiss.value.id });
    await expectRejectedWithoutWrites(() => dismissTriageTask({
      now: at(62), timezone: TIMEZONE, taskId: toDismiss.value.id,
    }));
  });

  it('rolls back capture, move-to-today, and dismiss when a later Event fails', async () => {
    const focusTask = await createManualTask({
      now: at(39), timezone: TIMEZONE, title: 'S1b 分流回滚专注', destination: 'today',
    });
    const focus = await startFocus({ now: at(40), timezone: TIMEZONE, taskId: focusTask.value.id });
    let eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const captureFault = { reads: 0 };
    await expect(captureTriageTask(failTimezoneAfterReads({
      now: at(41), sessionId: focus.value.id, title: 'S1b 捕获回滚',
    }, 2, captureFault))).rejects.toThrow();
    expect(captureFault.reads).toBeGreaterThanOrEqual(3);
    expect((await dataStore.getAll<Task>(STORE.tasks)).some(({ title }) => title === 'S1b 捕获回滚'))
      .toBe(false);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const captured = await captureTriageTask({
      now: at(42), timezone: TIMEZONE, sessionId: focus.value.id, title: 'S1b 移动回滚',
    });
    await discardFocus({
      now: at(43), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 1,
    });
    const taskBefore = await dataStore.get<Task>(STORE.tasks, captured.value.id);
    const [dayPlanBefore] = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    const listFault = { reads: 0 };
    await expect(moveTriageTaskToList(failTimezoneAfterReads({
      now: at(44), taskId: captured.value.id,
    }, 1, listFault))).rejects.toThrow();
    expect(listFault.reads).toBeGreaterThanOrEqual(2);
    expect(await dataStore.get<Task>(STORE.tasks, captured.value.id)).toEqual(taskBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const moveFault = { reads: 0 };
    await expect(moveTriageTaskToToday(failTimezoneAfterReads({
      now: at(45), taskId: captured.value.id,
    }, 4, moveFault))).rejects.toThrow();
    expect(moveFault.reads).toBeGreaterThanOrEqual(5);
    expect(await dataStore.get<Task>(STORE.tasks, captured.value.id)).toEqual(taskBefore);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, dayPlanBefore!.id)).toEqual(dayPlanBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);

    const dismissFault = { reads: 0 };
    await expect(dismissTriageTask(failTimezoneAfterReads({
      now: at(46), taskId: captured.value.id, dismissReason: null,
    }, 2, dismissFault))).rejects.toThrow();
    expect(dismissFault.reads).toBeGreaterThanOrEqual(3);
    expect(await dataStore.get<Task>(STORE.tasks, captured.value.id)).toEqual(taskBefore);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });
});
