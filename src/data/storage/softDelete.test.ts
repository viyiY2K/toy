import { describe, expect, it } from 'vitest';
import {
  internalDataStore as dataStore,
  EVENT_STORE,
  STORE,
  SYNCABLE_STORE_NAMES,
} from '../dataStore';
import { newId } from '../id';
import { makeTask, type Task } from '../schema';

const CREATED = '2026-07-19T16:00:00+08:00';
const DELETED = '2026-07-19T16:30:00+08:00';

describe('S9 软删除与默认过滤', () => {
  it('六个可同步 store 默认只返回 deletedAt=null，显式入口仍可读取 tombstone', async () => {
    for (const store of SYNCABLE_STORE_NAMES) {
      const active = { id: newId(), store, marker: 'active', updatedAt: CREATED, deletedAt: null };
      const deleted = { id: newId(), store, marker: 'deleted', updatedAt: DELETED, deletedAt: DELETED };
      await dataStore.put(store, active);
      await dataStore.put(store, deleted);

      expect(await dataStore.get(store, active.id)).toEqual(active);
      expect(await dataStore.get(store, deleted.id)).toBeUndefined();
      expect(await dataStore.getIncludingDeleted(store, deleted.id)).toEqual(deleted);

      const visible = await dataStore.getAll<typeof active>(store);
      expect(visible.some((record) => record.id === active.id)).toBe(true);
      expect(visible.some((record) => record.id === deleted.id)).toBe(false);
      const all = await dataStore.getAllIncludingDeleted<typeof active>(store);
      expect(all.some((record) => record.id === deleted.id)).toBe(true);
    }
  });

  it('Event 没有 deletedAt，普通 get/getAll 始终可读且不存在 including-deleted API 类型入口', async () => {
    const event = { id: newId(), marker: 'append-only-event' };
    await dataStore.appendEvent(event);
    expect(await dataStore.get(EVENT_STORE, event.id)).toEqual(event);
    expect((await dataStore.getAll<typeof event>(EVENT_STORE)).some(({ id }) => id === event.id)).toBe(true);

    if (false) {
      // @ts-expect-error Event 不是可同步实体，不存在“包含已删”读取语义。
      await dataStore.getIncludingDeleted(EVENT_STORE, event.id);
    }
  });

  it('事务内软删保留 tombstone，默认读取立即不可见，显式读取可见', async () => {
    const id = newId();
    const record = { id, marker: 'before-delete', updatedAt: CREATED, deletedAt: null };
    await dataStore.put(STORE.energyRecords, record);

    await dataStore.runAtomic([STORE.energyRecords], async (transaction) => {
      const tombstone = await transaction.softDelete(STORE.energyRecords, id, DELETED);
      expect(tombstone).toEqual({ ...record, updatedAt: DELETED, deletedAt: DELETED });
      expect(await transaction.get(STORE.energyRecords, id)).toBeUndefined();
      expect(await transaction.getIncludingDeleted(STORE.energyRecords, id)).toEqual(tombstone);
      expect(await transaction.getAll(STORE.energyRecords)).not.toContainEqual(tombstone);
      expect(await transaction.getAllIncludingDeleted(STORE.energyRecords)).toContainEqual(tombstone);
    });

    expect(await dataStore.get(STORE.energyRecords, id)).toBeUndefined();
    expect(await dataStore.getIncludingDeleted(STORE.energyRecords, id)).toEqual({
      ...record,
      updatedAt: DELETED,
      deletedAt: DELETED,
    });
  });

  it('Task 软删同步写 status/deletedReason，并清空与 deleted 状态冲突的完成/归档字段', async () => {
    const completed = makeTask({
      now: CREATED,
      title: 'completed before deletion',
      status: 'completed',
      completedAt: CREATED,
      completionSource: 'manual',
    });
    await dataStore.put(STORE.tasks, completed);

    await dataStore.runAtomic([STORE.tasks], async (transaction) => {
      const tombstone = await transaction.softDelete(STORE.tasks, completed.id, DELETED, {
        deletedReason: 'userDeleted',
      });
      expect(tombstone.status).toBe('deleted');
      expect(tombstone.deletedAt).toBe(DELETED);
      expect(tombstone.updatedAt).toBe(DELETED);
      expect(tombstone.deletedReason).toBe('userDeleted');
      expect(tombstone.completedAt).toBeNull();
      expect(tombstone.completionSource).toBeNull();
      expect(tombstone.archivedAt).toBeNull();
      expect(tombstone.outcome).toBeNull();
    });

    expect(await dataStore.get<Task>(STORE.tasks, completed.id)).toBeUndefined();
    expect((await dataStore.getIncludingDeleted<Task>(STORE.tasks, completed.id))?.status).toBe(
      'deleted',
    );
  });

  it('重复软删被拒绝，已有 tombstone 保持不变', async () => {
    const originalDeletedAt = '2026-07-19T16:20:00+08:00';
    const record = {
      id: newId(),
      marker: 'already-deleted',
      updatedAt: originalDeletedAt,
      deletedAt: originalDeletedAt,
    };
    await dataStore.put(STORE.sessions, record);

    await expect(
      dataStore.runAtomic([STORE.sessions], (transaction) =>
        transaction.softDelete(STORE.sessions, record.id, DELETED),
      ),
    ).rejects.toThrow(/已经软删除/);
    expect(await dataStore.getIncludingDeleted(STORE.sessions, record.id)).toEqual(record);
  });

  it('软删与 Event 同事务失败时回滚，实体继续作为有效记录可见', async () => {
    const task = makeTask({ now: CREATED, title: 'rollback deletion' });
    const eventId = newId();
    await dataStore.put(STORE.tasks, task);

    await expect(
      dataStore.runAtomic([STORE.tasks, EVENT_STORE], async (transaction) => {
        await transaction.softDelete(STORE.tasks, task.id, DELETED);
        await transaction.appendEvent({
          id: eventId,
          correlationId: newId(),
        });
      }),
    ).rejects.toThrow(/correlationId/);

    expect(await dataStore.get<Task>(STORE.tasks, task.id)).toEqual(task);
    expect(await dataStore.getIncludingDeleted<Task>(STORE.tasks, task.id)).toEqual(task);
    expect(await dataStore.get(EVENT_STORE, eventId)).toBeUndefined();
  });

  it('运行时绕过类型也不能对 Event 调用事务软删', async () => {
    await dataStore.runAtomic([EVENT_STORE], async (transaction) => {
      const softDeleteAny = transaction.softDelete as unknown as (
        store: string,
        id: string,
        deletedAt: string,
      ) => Promise<unknown>;
      await expect(softDeleteAny(EVENT_STORE, newId(), DELETED)).rejects.toThrow(/Event 不允许软删除/);
    });
  });

  it('事务软删公开面不暴露物理 delete/clear/remove', async () => {
    await dataStore.runAtomic([STORE.tasks], async (transaction) => {
      const surface = transaction as unknown as Record<string, unknown>;
      expect(surface.delete).toBeUndefined();
      expect(surface.clear).toBeUndefined();
      expect(surface.remove).toBeUndefined();
    });
  });
});
