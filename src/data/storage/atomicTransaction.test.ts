import { describe, expect, it } from 'vitest';
import { internalDataStore as dataStore, EVENT_STORE, STORE } from '../dataStore';
import { newId } from '../id';

interface AtomicTestEvent {
  id: string;
  correlationId: string | null;
  marker: string;
}

describe('S8 原子事务', () => {
  it('在同一事务提交实体与多条共享 correlationId 的 Event，并可读取待提交写入', async () => {
    const taskId = newId();
    const eventIds = [newId(), newId()];

    const returnedCorrelationId = await dataStore.runAtomic(
      [STORE.tasks, EVENT_STORE],
      async (transaction) => {
        const task = { id: taskId, marker: 'atomic-committed', deletedAt: null };
        await transaction.put(STORE.tasks, task);
        expect(await transaction.get(STORE.tasks, taskId)).toEqual(task);

        for (const [index, id] of eventIds.entries()) {
          await transaction.appendEvent({
            id,
            correlationId: transaction.correlationId,
            marker: `event-${index}`,
          });
        }
        return transaction.correlationId;
      },
    );

    expect(returnedCorrelationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(await dataStore.get(STORE.tasks, taskId)).toEqual({
      id: taskId,
      marker: 'atomic-committed',
      deletedAt: null,
    });
    for (const id of eventIds) {
      const event = await dataStore.get<AtomicTestEvent>(EVENT_STORE, id);
      expect(event?.correlationId).toBe(returnedCorrelationId);
    }
  });

  it('work 抛错时显式 abort，实体和 Event 均不产生部分提交', async () => {
    const taskId = newId();
    const eventId = newId();

    await expect(
      dataStore.runAtomic([STORE.tasks, EVENT_STORE], async (transaction) => {
        await transaction.put(STORE.tasks, { id: taskId, marker: 'must-rollback' });
        await transaction.appendEvent({
          id: eventId,
          correlationId: transaction.correlationId,
          marker: 'must-rollback',
        });
        throw new Error('fault injection');
      }),
    ).rejects.toThrow('fault injection');

    expect(await dataStore.get(STORE.tasks, taskId)).toBeUndefined();
    expect(await dataStore.get(EVENT_STORE, eventId)).toBeUndefined();
  });

  it('底层请求失败会整体回滚先前实体写入且不覆盖既有 Event', async () => {
    const duplicateEventId = newId();
    const original = { id: duplicateEventId, marker: 'original' };
    await dataStore.appendEvent(original);
    const taskId = newId();

    await expect(
      dataStore.runAtomic([STORE.tasks, EVENT_STORE], async (transaction) => {
        await transaction.put(STORE.tasks, { id: taskId, marker: 'must-rollback' });
        await transaction.appendEvent({
          id: duplicateEventId,
          correlationId: transaction.correlationId,
          marker: 'duplicate',
        });
      }),
    ).rejects.toThrow();

    expect(await dataStore.get(STORE.tasks, taskId)).toBeUndefined();
    expect(await dataStore.get(EVENT_STORE, duplicateEventId)).toEqual(original);
  });

  it('拒绝未声明 store 访问并回滚此前写入', async () => {
    const taskId = newId();

    await expect(
      dataStore.runAtomic([STORE.tasks], async (transaction) => {
        await transaction.put(STORE.tasks, { id: taskId, marker: 'must-rollback' });
        await transaction.get(STORE.dayPlans, newId());
      }),
    ).rejects.toThrow(/未在本次 runAtomic 中声明/);

    expect(await dataStore.get(STORE.tasks, taskId)).toBeUndefined();
  });

  it('拒绝 correlationId 不一致的 Event 并回滚实体写入', async () => {
    const taskId = newId();
    const eventId = newId();

    await expect(
      dataStore.runAtomic([STORE.tasks, EVENT_STORE], async (transaction) => {
        await transaction.put(STORE.tasks, { id: taskId, marker: 'must-rollback' });
        await transaction.appendEvent({
          id: eventId,
          correlationId: newId(),
          marker: 'wrong-correlation',
        });
      }),
    ).rejects.toThrow(/correlationId/);

    expect(await dataStore.get(STORE.tasks, taskId)).toBeUndefined();
    expect(await dataStore.get(EVENT_STORE, eventId)).toBeUndefined();
  });

  it('异步间隙后失败仍回滚，不允许 IndexedDB 提前自动提交', async () => {
    const taskId = newId();

    await expect(
      dataStore.runAtomic([STORE.tasks], async (transaction) => {
        await transaction.put(STORE.tasks, { id: taskId, marker: 'must-rollback' });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throw new Error('late fault');
      }),
    ).rejects.toThrow('late fault');

    expect(await dataStore.get(STORE.tasks, taskId)).toBeUndefined();
  });

  it('拒绝空 store 集合且不生成事务', async () => {
    await expect(dataStore.runAtomic([], async () => undefined)).rejects.toThrow(/至少需要/);
  });

  it('事务公开面仍不含物理删除入口', async () => {
    await dataStore.runAtomic([STORE.tasks], async (transaction) => {
      const surface = transaction as unknown as Record<string, unknown>;
      expect(surface.delete).toBeUndefined();
      expect(surface.clear).toBeUndefined();
      expect(surface.remove).toBeUndefined();
    });
  });
});
