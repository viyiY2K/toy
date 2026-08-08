import { describe, expect, it } from 'vitest';
import { newId } from '../id';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { IndexedDbStorageAdapter } from './indexedDbAdapter';
import { migrateRecordToVersion2 } from './migrations';
import { DB_NAME, PRIMARY_KEY, STORE } from './stores';

const LEGACY_STORES = [
  'tasks',
  'dayPlans',
  'sessions',
  'events',
  'energyRecords',
  'unresolvedIntervals',
  'settings',
] as const;

/** 建一个 v1 结构的库（7 个 store、无 mergeGroups），并塞入按 v1 形状写的记录。 */
function seedVersion1Database(records: Record<string, unknown[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of LEGACY_STORES) {
        request.result.createObjectStore(name, { keyPath: PRIMARY_KEY });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([...LEGACY_STORES], 'readwrite');
      for (const [store, values] of Object.entries(records)) {
        for (const value of values) transaction.objectStore(store).put(value);
      }
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
}

describe('migrateRecordToVersion2（合并番茄钟功能批次的形状迁移）', () => {
  it('Session：taskId 标量改 taskIds 数组，并补 mergeGroupId', () => {
    const migrated = migrateRecordToVersion2(STORE.sessions, {
      id: 'a',
      type: 'focus',
      taskId: 'task-1',
      schemaVersion: 1,
    });
    expect(migrated).toEqual({
      id: 'a',
      type: 'focus',
      taskIds: ['task-1'],
      mergeGroupId: null,
      schemaVersion: 2,
    });
    expect(migrated).not.toHaveProperty('taskId');
  });

  it('Session：taskId 为 null 的 break 记录迁移成空数组，而不是 [null]', () => {
    expect(migrateRecordToVersion2(STORE.sessions, {
      id: 'b',
      type: 'shortBreak',
      taskId: null,
      schemaVersion: 1,
    })).toMatchObject({ taskIds: [], mergeGroupId: null });
  });

  it('Task：只补 mergeGroupId 并 bump schemaVersion，其余字段原样保留', () => {
    expect(migrateRecordToVersion2(STORE.tasks, {
      id: 'c',
      title: '旧任务',
      parentId: 'parent',
      schemaVersion: 1,
    })).toEqual({
      id: 'c',
      title: '旧任务',
      parentId: 'parent',
      mergeGroupId: null,
      schemaVersion: 2,
    });
  });

  it('其他可同步实体只 bump schemaVersion，不加合并字段', () => {
    expect(migrateRecordToVersion2(STORE.dayPlans, { id: 'd', appDate: '2026-06-01', schemaVersion: 1 }))
      .toEqual({ id: 'd', appDate: '2026-06-01', schemaVersion: 2 });
  });

  it('幂等：已经是 v2 形状的记录返回 undefined（不重复改写）', () => {
    expect(migrateRecordToVersion2(STORE.sessions, {
      id: 'e',
      taskIds: ['task-1'],
      mergeGroupId: null,
      schemaVersion: 2,
    })).toBeUndefined();
  });

  it('迁移不伪造 updatedAt——那不是一次业务修改', () => {
    const updatedAt = '2026-06-01T08:00:00+08:00';
    expect(migrateRecordToVersion2(STORE.tasks, { id: 'f', updatedAt, schemaVersion: 1 }))
      .toMatchObject({ updatedAt });
  });
});

describe('IndexedDB v1 → v2 升级', () => {
  it('打开旧库时就地迁移 tasks/sessions、建出 mergeGroups，且 Event 一字不改', async () => {
    const taskId = newId();
    const sessionId = newId();
    const eventId = newId();
    const legacyEvent = {
      id: eventId,
      type: 'focus.started',
      taskId,
      sessionId,
      schemaVersion: 1,
      payload: { pomodoroIndex: 1 },
    };
    await seedVersion1Database({
      tasks: [{ id: taskId, title: '旧任务', schemaVersion: 1 }],
      sessions: [{ id: sessionId, type: 'focus', taskId, schemaVersion: 1 }],
      events: [legacyEvent],
    });

    const adapter = new IndexedDbStorageAdapter();
    const [task, session, event, mergeGroups] = await Promise.all([
      adapter.get<Record<string, unknown>>(STORE.tasks, taskId),
      adapter.get<Record<string, unknown>>(STORE.sessions, sessionId),
      adapter.get<Record<string, unknown>>(STORE.events, eventId),
      adapter.getAll<unknown>(STORE.mergeGroups),
    ]);

    expect(task).toMatchObject({ mergeGroupId: null, schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(session).toMatchObject({
      taskIds: [taskId],
      mergeGroupId: null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    expect(session).not.toHaveProperty('taskId');
    // §3.4 关键规则 1/2、红线 7/8：Event append-only，迁移一律不动。
    expect(event).toEqual(legacyEvent);
    expect(mergeGroups).toEqual([]);
  });
});
