import { describe, expect, it, vi } from 'vitest';
import {
  dataStore,
  EVENT_STORE,
  STORE,
  type SyncableEntityMap,
} from '../dataStore';
import { makeEnergyRecord, makeEvent, makeTask, type Event, type Task } from '../schema';
import { EntityValidationError } from '../validation';
import { executeAtomicWrite, getInMemoryWriteDiagnostics } from './executeAtomicWrite';

const NOW = '2026-07-19T17:00:00+08:00';
const LATER = '2026-07-19T17:15:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

async function newEventsSince(before: Set<string>): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter((event) => !before.has(event.id));
}

async function eventIds(): Promise<Set<string>> {
  return new Set((await dataStore.getAll<Event>(EVENT_STORE)).map((event) => event.id));
}

describe('S12 executeAtomicWrite', () => {
  it('合法实体与 Event 经事务可见校验后原子提交并共享 correlationId', async () => {
    const task = makeTask({ now: NOW, title: 'validated write', estimatedPomodoros: 2 });
    const correlationId = await executeAtomicWrite(
      { storeNames: [STORE.tasks, EVENT_STORE], now: NOW, timezone: TIMEZONE },
      async (transaction) => {
        await transaction.put(STORE.tasks, task);
        const event = makeEvent({
          now: NOW,
          timezone: TIMEZONE,
          type: 'task.created',
          taskId: task.id,
          correlationId: transaction.correlationId,
          payload: {
            title: task.title,
            parentId: null,
            estimatedPomodoros: 2,
            source: 'manual',
          },
        });
        await transaction.appendEvent(event);
        return transaction.correlationId;
      },
    );

    expect((await dataStore.get<Task>(STORE.tasks, task.id))?.title).toBe('validated write');
    const events = await dataStore.getAll<Event<'task.created'>>(EVENT_STORE);
    expect(events.find((event) => event.taskId === task.id)?.correlationId).toBe(correlationId);
  });

  it('create/update 校验失败均拒绝写入并追加脱敏 unexpectedState', async () => {
    const before = await eventIds();
    const invalidCreate = { ...makeTask({ now: NOW, title: 'SECRET_CREATE' }), estimatedPomodoros: 8 };
    await expect(
      executeAtomicWrite(
        {
          storeNames: [STORE.tasks],
          now: NOW,
          timezone: TIMEZONE,
          diagnosticContext: {
            entityType: 'Settings',
          },
        },
        (transaction) => transaction.put(STORE.tasks, invalidCreate),
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);
    expect(await dataStore.get(STORE.tasks, invalidCreate.id)).toBeUndefined();

    const task = makeTask({ now: NOW, title: 'SECRET_UPDATE' });
    await executeAtomicWrite(
      { storeNames: [STORE.tasks], now: NOW, timezone: TIMEZONE },
      (transaction) => transaction.put(STORE.tasks, task),
    );
    await expect(
      executeAtomicWrite(
        { storeNames: [STORE.tasks], now: LATER, timezone: TIMEZONE },
        (transaction) =>
          transaction.put(STORE.tasks, {
            ...task,
            updatedAt: LATER,
            estimatedPomodoros: 8,
          }),
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);
    expect((await dataStore.get<Task>(STORE.tasks, task.id))?.estimatedPomodoros).toBe(1);

    const errors = (await newEventsSince(before)).filter(
      (event): event is Event<'error.unexpectedState'> => event.type === 'error.unexpectedState',
    );
    expect(errors).toHaveLength(2);
    for (const event of errors) {
      expect(event.payload.errorCode).toBe('ERR_WRITE_VALIDATION');
      expect(event.payload.errorMessage).toBeNull();
      expect(event.payload.context.detectedBy).toBe('writeValidation');
      expect(event.payload.context.storageEngine).toBe('indexedDB');
      expect(JSON.stringify(event.payload)).not.toContain('SECRET_');
    }
    expect(errors.map((event) => event.payload.context.operation)).toEqual(['create', 'update']);
  });

  it('softDelete 在 put 前校验；非法时间拒绝且原实体保持有效', async () => {
    const record = makeEnergyRecord({
      now: NOW,
      occurredAt: NOW,
      timezone: TIMEZONE,
      energyLevel: 6,
      source: 'manual',
      note: 'SECRET_ENERGY_NOTE',
    });
    await executeAtomicWrite(
      { storeNames: [STORE.energyRecords], now: NOW, timezone: TIMEZONE },
      (transaction) => transaction.put(STORE.energyRecords, record),
    );
    const before = await eventIds();

    await expect(
      executeAtomicWrite(
        { storeNames: [STORE.energyRecords], now: LATER, timezone: TIMEZONE },
        (transaction) => transaction.softDelete(STORE.energyRecords, record.id, '2026-07-19'),
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);

    expect(await dataStore.get(STORE.energyRecords, record.id)).toEqual(record);
    const [error] = (await newEventsSince(before)).filter(
      (event) => event.type === 'error.unexpectedState',
    );
    expect(error?.payload.context.operation).toBe('softDelete');
    expect(JSON.stringify(error?.payload)).not.toContain('SECRET_ENERGY_NOTE');
  });

  it('appendEvent payload 校验失败时拒绝 append 并记录 unexpectedState', async () => {
    const before = await eventIds();
    const invalid = makeEvent({
      now: NOW,
      timezone: TIMEZONE,
      type: 'triage.movedToList',
      payload: {},
    }) as Event & { payload: { extra: string } };
    invalid.payload = { extra: 'not allowed' };

    await expect(
      executeAtomicWrite(
        { storeNames: [EVENT_STORE], now: NOW, timezone: TIMEZONE },
        (transaction) => transaction.appendEvent(invalid),
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);
    expect(await dataStore.get(EVENT_STORE, invalid.id)).toBeUndefined();
    const [error] = (await newEventsSince(before)).filter(
      (event) => event.type === 'error.unexpectedState',
    );
    expect(error?.payload.context.operation).toBe('appendEvent');
    expect(error?.payload.context.sourceEventType).toBe('triage.movedToList');
  });

  it('IndexedDB 写失败回滚全部业务写，并在独立事务追加 dataWriteFailed', async () => {
    const duplicate = makeEvent({
      now: NOW,
      timezone: TIMEZONE,
      type: 'error.unexpectedState',
      payload: {
        errorCode: 'ERR_DUPLICATE_FIXTURE',
        errorMessage: null,
        context: {},
      },
    });
    await executeAtomicWrite(
      { storeNames: [EVENT_STORE], now: NOW, timezone: TIMEZONE },
      (transaction) => transaction.appendEvent({ ...duplicate, correlationId: transaction.correlationId }),
    );
    const before = await eventIds();
    const task = makeTask({ now: NOW, title: 'SECRET_ROLLBACK_TASK' });

    await expect(
      executeAtomicWrite(
        { storeNames: [STORE.tasks, EVENT_STORE], now: LATER, timezone: TIMEZONE },
        async (transaction) => {
          await transaction.put(STORE.tasks, task);
          await transaction.appendEvent({
            ...duplicate,
            correlationId: transaction.correlationId,
            createdAt: LATER,
            occurredAt: LATER,
          });
        },
      ),
    ).rejects.toThrow();

    expect(await dataStore.get(STORE.tasks, task.id)).toBeUndefined();
    const [error] = (await newEventsSince(before)).filter(
      (event) => event.type === 'error.dataWriteFailed',
    );
    expect(error?.payload.errorCode).toBe('ERR_DATA_WRITE_FAILED');
    expect(error?.payload.errorMessage).toBeNull();
    expect(error?.payload.context).toMatchObject({
      entityType: 'Event',
      operation: 'appendEvent',
      storageEngine: 'indexedDB',
      objectStore: EVENT_STORE,
    });
    expect(JSON.stringify(error?.payload)).not.toContain('SECRET_ROLLBACK_TASK');
  });

  it('context 运行时白名单移除正文/快照字段', async () => {
    const before = await eventIds();
    const invalid = { ...makeTask({ now: NOW, title: 'SECRET_TITLE' }), estimatedPomodoros: 9 };
    const unsafeContext = {
      entityType: 'Task',
      title: 'SECRET_CONTEXT_TITLE',
      note: 'SECRET_CONTEXT_NOTE',
      entitySnapshot: invalid,
    } as never;

    await expect(
      executeAtomicWrite(
        {
          storeNames: [STORE.tasks],
          now: NOW,
          timezone: TIMEZONE,
          diagnosticContext: unsafeContext,
        },
        (transaction) => transaction.put(STORE.tasks, invalid),
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);

    const [error] = (await newEventsSince(before)).filter(
      (event) => event.type === 'error.unexpectedState',
    );
    expect(error?.payload.context).not.toHaveProperty('title');
    expect(error?.payload.context).not.toHaveProperty('note');
    expect(error?.payload.context).not.toHaveProperty('entitySnapshot');
    expect(JSON.stringify(error?.payload)).not.toContain('SECRET_');
  });

  it('调用方即使捕获校验异常，事务仍保持 poisoned 并回滚全部写入', async () => {
    const invalid = { ...makeTask({ now: NOW, title: 'invalid caught' }), estimatedPomodoros: 8 };
    const otherwiseValid = makeTask({ now: NOW, title: 'must also rollback' });

    await expect(
      executeAtomicWrite(
        { storeNames: [STORE.tasks], now: NOW, timezone: TIMEZONE },
        async (transaction) => {
          try {
            await transaction.put(STORE.tasks, invalid);
          } catch {
            // 故意吞掉：executeAtomicWrite 仍必须在 work 返回后拒绝并 abort。
          }
          await transaction.put(STORE.tasks, otherwiseValid);
        },
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);

    expect(await dataStore.get(STORE.tasks, invalid.id)).toBeUndefined();
    expect(await dataStore.get(STORE.tasks, otherwiseValid.id)).toBeUndefined();
  });

  it('普通业务回调异常不冒充存储失败，也不产生 error Event', async () => {
    const before = await eventIds();
    await expect(
      executeAtomicWrite(
        { storeNames: [STORE.tasks], now: NOW, timezone: TIMEZONE },
        async () => {
          throw new Error('SECRET_BUSINESS_ERROR');
        },
      ),
    ).rejects.toThrow('SECRET_BUSINESS_ERROR');
    expect(await newEventsSince(before)).toHaveLength(0);
  });

  it('错误 Event 自身无法落库时仅写脱敏 console/内存诊断且不递归', async () => {
    const beforeEvents = await eventIds();
    const beforeFallback = getInMemoryWriteDiagnostics().length;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invalid = { ...makeTask({ now: NOW, title: 'SECRET_FALLBACK' }), estimatedPomodoros: 8 };

    await expect(
      executeAtomicWrite(
        { storeNames: [STORE.tasks], now: NOW, timezone: 'Invalid/Timezone' },
        (transaction) => transaction.put(STORE.tasks, invalid),
      ),
    ).rejects.toBeInstanceOf(EntityValidationError);

    expect(await newEventsSince(beforeEvents)).toHaveLength(0);
    const fallback = getInMemoryWriteDiagnostics();
    expect(fallback).toHaveLength(beforeFallback + 1);
    expect(fallback.at(-1)).toMatchObject({
      eventType: 'error.unexpectedState',
      errorCode: 'ERR_WRITE_VALIDATION',
    });
    expect(JSON.stringify(fallback.at(-1))).not.toContain('SECRET_FALLBACK');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('六个实体 store 均路由到各自写入校验器', async () => {
    const invalidByStore: Array<[keyof SyncableEntityMap, unknown]> = [
      [STORE.tasks, { id: 'bad' }],
      [STORE.dayPlans, { id: 'bad' }],
      [STORE.sessions, { id: 'bad' }],
      [STORE.energyRecords, { id: 'bad' }],
      [STORE.unresolvedIntervals, { id: 'bad' }],
      [STORE.settings, { id: 'bad' }],
    ];
    for (const [store, value] of invalidByStore) {
      await expect(
        executeAtomicWrite(
          { storeNames: [store], now: NOW, timezone: TIMEZONE },
          (transaction) => transaction.put(store, value as never),
        ),
      ).rejects.toBeInstanceOf(EntityValidationError);
    }
  });
});
