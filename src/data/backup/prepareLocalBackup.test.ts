import { describe, expect, it } from 'vitest';
import { STORE_NAMES, type StoreName } from '../dataStore';
import {
  DEFAULT_MERGE_GROUP_TITLE,
  makeEvent,
  makeMergeGroup,
  makeSession,
  makeSettings,
  makeTask,
} from '../schema';
import { countBackupRecords, type LocalBackupFile } from './localBackup';
import { prepareLocalBackup } from './prepareLocalBackup';

const now = '2026-10-20T10:00:00+09:00';
const timezone = 'Asia/Tokyo';
const end = '2026-10-20T10:25:00+09:00';

function file(extra: Partial<Record<StoreName, unknown[]>> = {}, schemaVersion = '3'): LocalBackupFile {
  const records = {
    ...Object.fromEntries(STORE_NAMES.map((store) => [store, []])),
    settings: [makeSettings({ now })],
    ...extra,
  } as Record<StoreName, unknown[]>;
  return {
    kind: 'toy.localBackup', format: 'json', schemaVersion,
    exportedAt: now, totalRecords: countBackupRecords(records), records,
  };
}

function prepare(backup: LocalBackupFile) {
  return prepareLocalBackup(JSON.stringify(backup));
}

describe('backup preflight and migration', () => {
  it('preserves historical events when task titles/state and timer settings have changed', async () => {
    const task = makeTask({
      now, title: '后来改名且删除', status: 'deleted', deletedAt: end, deletedReason: 'userDeleted',
    });
    const session = makeSession({
      now, startedAt: now, endedAt: end, timezone, type: 'focus', status: 'completed',
      taskIds: [task.id], plannedDuration: 1500, actualDuration: 1490, pomodoroIndex: 1,
      deletedAt: end,
    });
    const created = makeEvent({
      now, timezone, type: 'task.created', taskId: task.id,
      payload: { title: '原来名字', parentId: null, estimatedPomodoros: 1, source: 'manual' },
    });
    const started = makeEvent({
      now, timezone, type: 'focus.started', taskId: task.id, sessionId: session.id,
      payload: { pomodoroIndex: 1, plannedDuration: 1500, taskEstimateAtStart: 1 },
    });
    const snapshot = file({
      tasks: [task], sessions: [session], events: [created, started],
      settings: [makeSettings({ now, focusMinutes: 50 })],
    });
    expect(await prepare(snapshot)).toEqual(snapshot);
  });

  it('accepts one active session so recovery can handle an interrupted exported timer', async () => {
    const task = makeTask({ now, title: '进行中' });
    const session = makeSession({
      now, startedAt: now, timezone, type: 'focus', taskIds: [task.id],
      plannedDuration: 1500, pomodoroIndex: 1,
    });
    expect((await prepare(file({ tasks: [task], sessions: [session] }))).records.sessions).toEqual([session]);
    await expect(prepare(file({
      tasks: [task], sessions: [session, { ...session, id: makeTask({ now, title: 'id' }).id }],
    }))).rejects.toThrow(/多个正在计时/);
  });

  it('migrates all v1 entities while preserving the exact old Event objects', async () => {
    const task = makeTask({ now, title: '旧任务' });
    const session = makeSession({
      now, startedAt: now, endedAt: end, timezone, type: 'focus', status: 'completed',
      taskIds: [task.id], plannedDuration: 1500, actualDuration: 1500, pomodoroIndex: 1,
    });
    const event = makeEvent({
      now, timezone, type: 'focus.started', taskId: task.id, sessionId: session.id,
      payload: { pomodoroIndex: 1, plannedDuration: 1500, taskEstimateAtStart: 1 },
    });
    const legacy = JSON.parse(JSON.stringify(file({ tasks: [task], sessions: [session], events: [event] }, '1')));
    delete legacy.records.mergeGroups;
    for (const records of Object.values(legacy.records)) {
      for (const value of records as Record<string, unknown>[]) {
        value.schemaVersion = 1;
        delete value.mergeGroupId;
      }
    }
    const oldSession = legacy.records.sessions[0];
    oldSession.taskId = task.id;
    delete oldSession.taskIds;
    delete oldSession.taskSegments;
    const prepared = await prepare(legacy);
    expect(prepared.schemaVersion).toBe('1');
    expect(prepared.records.tasks).toEqual([task]);
    expect(prepared.records.sessions).toEqual([session]);
    expect(prepared.records.events).toEqual(legacy.records.events);
    expect(prepared.records.mergeGroups).toEqual([]);
  });

  it('migrates v2 merge groups and permits historical completed sessions without invented segments', async () => {
    const tasks = [makeTask({ now, title: '一' }), makeTask({ now, title: '二' })];
    const group = makeMergeGroup({
      now, taskIds: tasks.map((task) => task.id),
      status: 'dissolved', dissolvedAt: end, dissolvedReason: 'manualDissolved',
    });
    const session = makeSession({
      now, startedAt: now, endedAt: end, timezone, type: 'focus', status: 'completed',
      taskIds: tasks.map((task) => task.id), mergeGroupId: group.id,
      plannedDuration: 1500, actualDuration: 1500, pomodoroIndex: 1,
    });
    const event = makeEvent({
      now, timezone, type: 'mergeGroup.created', mergeGroupId: group.id,
      payload: { title: DEFAULT_MERGE_GROUP_TITLE, taskIds: tasks.map((task) => task.id), estimatedPomodoros: 1 },
    });
    const legacy = JSON.parse(JSON.stringify(file({ tasks, sessions: [session], mergeGroups: [group], events: [event] }, '2')));
    for (const records of Object.values(legacy.records)) {
      for (const value of records as Record<string, unknown>[]) value.schemaVersion = 2;
    }
    delete legacy.records.sessions[0].taskSegments;
    delete legacy.records.mergeGroups[0].title;
    delete legacy.records.mergeGroups[0].completedAt;
    delete legacy.records.events[0].payload.title;
    const prepared = await prepare(legacy);
    expect(prepared.records.mergeGroups).toEqual([group]);
    expect(prepared.records.sessions).toEqual([session]);
    expect(prepared.records.events).toEqual(legacy.records.events);
    // The next current-version export retains old immutable Event schema versions.
    expect((await prepare({ ...prepared, schemaVersion: '3' })).records).toEqual(prepared.records);
  });

  it('rejects invalid fields, enums, duplicate active Settings and dangling entity references', async () => {
    const task = makeTask({ now, title: '任务' });
    await expect(prepare(file({ tasks: [{ ...task, status: 'unknown' }] }))).rejects.toThrow(/校验失败/);
    await expect(prepare(file({ tasks: [{ id: task.id, schemaVersion: 3 }] }))).rejects.toThrow(/校验失败/);
    await expect(prepare(file({ settings: [makeSettings({ now }), makeSettings({ now })] })))
      .rejects.toThrow(/恰好有一条/);
    await expect(prepare(file({ tasks: [{ ...task, parentId: makeTask({ now, title: 'missing' }).id }] })))
      .rejects.toThrow(/父 Task 不存在/);
  });

  it('retains the old v3 group-completion event without inventing missing snapshots', async () => {
    const tasks = [makeTask({ now, title: '一' }), makeTask({ now, title: '二' })];
    const group = makeMergeGroup({
      now, taskIds: tasks.map((task) => task.id), status: 'completed', completedAt: end,
    });
    const event = {
      ...makeEvent({
        now: end, timezone, type: 'mergeGroup.completed', mergeGroupId: group.id,
        payload: {
          completedAt: end, validFocusCountAtCompletion: 1,
          finalTaskIds: tasks.map((task) => task.id), incompleteTaskIds: [],
        },
      }),
      payload: { completedAt: end, validFocusCountAtCompletion: 1 },
    };
    const backup = file({ tasks, mergeGroups: [group], events: [event] });
    expect(await prepare(backup)).toEqual(backup);
    // A partly missing modern payload is corruption, not the complete legacy shape.
    await expect(prepare(file({
      tasks, mergeGroups: [group],
      events: [{ ...event, payload: { ...event.payload, finalTaskIds: tasks.map((task) => task.id) } }],
    }))).rejects.toThrow(/缺少必填字段/);
  });

  it('rejects invalid Event types/payloads and missing references, including old Events', async () => {
    const task = makeTask({ now, title: '任务' });
    const event = makeEvent({
      now, timezone, type: 'task.created', taskId: task.id,
      payload: { title: task.title, parentId: null, estimatedPomodoros: 1, source: 'manual' },
    });
    await expect(prepare(file({ tasks: [task], events: [{ ...event, type: 'unknown' }] })))
      .rejects.toThrow(/事件类型/);
    await expect(prepare(file({ tasks: [task], events: [{ ...event, schemaVersion: 1, payload: {} }] })))
      .rejects.toThrow(/缺少必填字段/);
    await expect(prepare(file({ events: [event] }))).rejects.toThrow(/引用不存在/);
  });

  it('rejects mismatched entity versions without repairing them through a migration', async () => {
    await expect(prepare(file({ settings: [makeSettings({ now })] }, '2'))).rejects.toThrow(/版本与文件不一致/);
  });

  it('does not accept a newer event contract disguised as an old Event', async () => {
    const tasks = [makeTask({ now, title: '一' }), makeTask({ now, title: '二' })];
    const group = makeMergeGroup({ now, taskIds: tasks.map((task) => task.id) });
    const event = makeEvent({
      now, timezone, type: 'mergeGroup.renamed', mergeGroupId: group.id,
      payload: { oldTitle: '旧名', newTitle: group.title },
    });
    for (const schemaVersion of [1, 2]) {
      await expect(prepare(file({ tasks, mergeGroups: [group], events: [{ ...event, schemaVersion }] })))
        .rejects.toThrow(/不属于其数据版本/);
    }
  });

  it('rejects a payload reference to the wrong existing Event type', async () => {
    const task = makeTask({ now, title: '任务' });
    const session = makeSession({
      now, startedAt: now, endedAt: end, timezone, type: 'focus', status: 'discarded',
      taskIds: [task.id], plannedDuration: 1500, actualDuration: 100, pomodoroIndex: 1,
    });
    const wrongSource = makeEvent({
      now, timezone, type: 'task.created', taskId: task.id,
      payload: { title: task.title, parentId: null, estimatedPomodoros: 1, source: 'manual' },
    });
    const discarded = makeEvent({
      now: end, timezone, type: 'focus.discarded', taskId: task.id, sessionId: session.id,
      payload: {
        pomodoroIndex: 1, actualDuration: 100, reason: 'userInitiated',
        triggeredByInterruptEventId: wrongSource.id,
      },
    });
    await expect(prepare(file({ tasks: [task], sessions: [session], events: [wrongSource, discarded] })))
      .rejects.toThrow(/引用类型或计时记录不一致/);
  });

  it('rejects a focus Event that references an existing break Session', async () => {
    const task = makeTask({ now, title: '任务' });
    const focus = makeSession({
      now, startedAt: now, endedAt: end, timezone, type: 'focus', status: 'completed',
      taskIds: [task.id], plannedDuration: 1500, actualDuration: 1500, pomodoroIndex: 1,
    });
    const rest = makeSession({
      now: end, startedAt: end, endedAt: end, timezone, type: 'shortBreak', status: 'skipped',
      sourceFocusSessionId: focus.id, plannedDuration: 300, actualDuration: 0, skipKind: 'explicitSkip',
    });
    const event = makeEvent({
      now: end, timezone, type: 'focus.completed', taskId: task.id, sessionId: rest.id,
      payload: { pomodoroIndex: 1, plannedDuration: 1500, actualDuration: 1500 },
    });
    await expect(prepare(file({ tasks: [task], sessions: [focus, rest], events: [event] })))
      .rejects.toThrow(/sessionId 必须与事务内关联实体一致/);
  });

  it('rejects a malformed source shown Event even when a selection references it first', async () => {
    const task = makeTask({ now, title: '任务' });
    const settings = makeSettings({ now });
    const restKey = settings.restSuggestions.find((item) => item.appliesTo.includes('shortBreak'))!.key;
    const focus = makeSession({
      now, startedAt: now, endedAt: end, timezone, type: 'focus', status: 'completed',
      taskIds: [task.id], plannedDuration: 1500, actualDuration: 1500, pomodoroIndex: 1,
    });
    const rest = makeSession({
      now: end, startedAt: end, timezone, type: 'shortBreak',
      sourceFocusSessionId: focus.id, plannedDuration: 300, actualRest: restKey,
    });
    const shown = makeEvent({
      now: end, timezone, type: 'restItem.shown', sessionId: rest.id, settingsId: settings.id,
      payload: { breakType: 'shortBreak', shownKeys: [restKey], eligibleCount: 1 },
    });
    const selected = makeEvent({
      now: end, timezone, type: 'restItem.selected', sessionId: rest.id, settingsId: settings.id,
      payload: { breakType: 'shortBreak', selectedKey: restKey, selectedIndex: 0, sourceShownEventId: shown.id },
    });
    const snapshot = file({ tasks: [task], settings: [settings], sessions: [focus, rest], events: [selected, shown] });
    expect(await prepare(snapshot)).toEqual(snapshot);
    await expect(prepare({
      ...snapshot,
      records: {
        ...snapshot.records,
        events: [selected, { ...shown, payload: { breakType: 'shortBreak', eligibleCount: 1 } }],
      },
    })).rejects.toThrow(/payload.shownKeys 缺少必填字段/);
  });
});
