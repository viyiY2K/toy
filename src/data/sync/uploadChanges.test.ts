import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { dataStore, STORE } from '../dataStore';
import type { Task } from '../schema';
import { createManualTask, deleteActiveTask, updateTaskTitle } from '../commands/taskCommands';
import { __resetSupabaseClientForTests, getSupabaseClient } from './supabaseClient';
import { uploadChanges } from './uploadChanges';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) => `2026-10-01T09:${String(minute).padStart(2, '0')}:00+08:00`;

const SUPABASE_URL = 'https://example.supabase.co';
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const TABLES = ['tasks', 'day_plans', 'sessions', 'energy_records', 'unresolved_intervals', 'settings', 'events'];

function memoryStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/** 每张表一个"总是成功"的默认 handler，并把请求体记到 captured[table]、请求次数记到 callCounts[table]。 */
function defaultHandlers(captured: Record<string, unknown[]>, callCounts: Record<string, number>) {
  return TABLES.map((table) =>
    http.post(`${REST_URL}/${table}`, async ({ request }) => {
      callCounts[table] = (callCounts[table] ?? 0) + 1;
      const body = (await request.json()) as unknown[];
      captured[table] = [...(captured[table] ?? []), ...body];
      return HttpResponse.json([], { status: 201 });
    }),
  );
}

let captured: Record<string, unknown[]>;
let callCounts: Record<string, number>;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  captured = {};
  callCounts = {};
  server.use(...defaultHandlers(captured, callCounts));
  __resetSupabaseClientForTests();
  getSupabaseClient({ VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'test-anon-key' });
});

function rowsFor(table: string, id: string): Array<Record<string, unknown>> {
  return ((captured[table] ?? []) as Array<Record<string, unknown>>).filter((row) => row.id === id);
}

describe('uploadChanges (S4)', () => {
  it('未配置 Supabase 时直接返回 configured:false，不发任何请求', async () => {
    __resetSupabaseClientForTests();
    getSupabaseClient({}); // 显式钉住"未配置"状态，避免落回真实 .env 环境变量
    const result = await uploadChanges(at(10), TIMEZONE, { storage: memoryStorage() });
    expect(result).toEqual({ configured: false, entities: [], events: { attempted: 0, succeeded: 0 } });
    expect(Object.keys(callCounts)).toEqual([]);
  });

  it('上传一条从未同步过的新建 Task，成功后本地 syncedAt/deviceId 被回写', async () => {
    const created = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '待上传任务', estimatedPomodoros: 1, destination: 'list',
    });

    const storage = memoryStorage();
    const result = await uploadChanges(at(5), TIMEZONE, { storage });

    expect(result.configured).toBe(true);
    const taskRows = rowsFor('tasks', created.value.id);
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0]).toMatchObject({ title: '待上传任务', status: 'active' });
    expect(taskRows[0]).not.toHaveProperty('synced_at');
    // 回归测试：上传 payload 里的 device_id 必须是本机 id，不能是本地记录当前仍为 null 的
    // 旧值——否则远端这一行会永久带着 device_id=null，导致其它设备下载它时在 'sync' 模式
    // 校验（deviceId 必须非空）上失败，见本次修复。
    expect(taskRows[0]!.device_id).not.toBeNull();
    expect(typeof taskRows[0]!.device_id).toBe('string');

    const stored = await dataStore.get<Task>(STORE.tasks, created.value.id);
    expect(stored!.syncedAt).toBe(at(5));
    expect(stored!.deviceId).not.toBeNull();
    expect(stored!.deviceId).toBe(taskRows[0]!.device_id); // 本地回写的 deviceId 和实际上传的一致

    const taskEntity = result.entities.find((entity) => entity.store === STORE.tasks)!;
    expect(taskEntity.succeeded).toBeGreaterThanOrEqual(1);
    expect(taskEntity.failedIds).toEqual([]);
  });

  it('软删除的 tombstone 也会被上传', async () => {
    const created = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '会被删除', estimatedPomodoros: 1, destination: 'list',
    });
    // 先上传一次，制造"已同步"状态。
    await uploadChanges(at(1), TIMEZONE, { storage: memoryStorage() });

    await deleteActiveTask({ now: at(2), timezone: TIMEZONE, taskId: created.value.id });

    const result = await uploadChanges(at(3), TIMEZONE, { storage: memoryStorage() });
    const taskEntity = result.entities.find((entity) => entity.store === STORE.tasks)!;
    expect(taskEntity.succeeded).toBeGreaterThanOrEqual(1);

    const taskRows = rowsFor('tasks', created.value.id);
    const tombstoneRow = taskRows.at(-1);
    expect(tombstoneRow).toMatchObject({ deleted_reason: 'userDeleted' });
    expect(tombstoneRow?.deleted_at).not.toBeNull();
  });

  it('上传失败时不回写本地 syncedAt，留给下一轮重试', async () => {
    server.use(
      http.post(`${REST_URL}/tasks`, () =>
        HttpResponse.json({ message: 'server error' }, { status: 500 }),
      ),
    );

    const created = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '上传会失败', estimatedPomodoros: 1, destination: 'list',
    });

    const result = await uploadChanges(at(5), TIMEZONE, { storage: memoryStorage() });
    const taskEntity = result.entities.find((entity) => entity.store === STORE.tasks)!;
    expect(taskEntity.succeeded).toBe(0);
    expect(taskEntity.failedIds).toContain(created.value.id);
    expect(taskEntity.error).toBeTruthy();

    const stored = await dataStore.get<Task>(STORE.tasks, created.value.id);
    expect(stored!.syncedAt).toBeNull();
    expect(stored!.deviceId).toBeNull();
  });

  it('上传网络往返期间用户又在本地编辑了这条记录时，不覆盖那次编辑的"未同步"状态', async () => {
    let releaseResponse!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    server.use(
      http.post(`${REST_URL}/tasks`, async ({ request }) => {
        const body = (await request.json()) as unknown[];
        captured.tasks = [...(captured.tasks ?? []), ...body];
        await gate;
        return HttpResponse.json([], { status: 201 });
      }),
    );

    const created = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '会被并发编辑', estimatedPomodoros: 1, destination: 'list',
    });

    const storage = memoryStorage();
    const uploadPromise = uploadChanges(at(5), TIMEZONE, { storage });

    // 上传请求还在"网络中"时，模拟用户在本地又编辑了一次标题。
    await updateTaskTitle({ now: at(6), timezone: TIMEZONE, taskId: created.value.id, title: '并发编辑后的标题' });

    releaseResponse();
    await uploadPromise;

    const stored = await dataStore.get<Task>(STORE.tasks, created.value.id);
    expect(stored!.title).toBe('并发编辑后的标题');
    // 并发编辑之后 updatedAt 已经前进，上传成功回写时应该发现"captured 的 updatedAt 已经过期"而跳过，
    // 这条记录的 syncedAt 必须保持 null，下一轮同步才会再次把这次编辑真正传上去。
    expect(stored!.syncedAt).toBeNull();
  });

  it('已同步且之后没有新变化的记录，再次调用不会把它重新上传第二次', async () => {
    // 注意：本文件内的 IndexedDB 在多个 it 之间是共享的（不做逐用例重置，与既有
    // src/data 测试文件的一贯写法一致），所以这里只断言"这一条记录"的上传次数，
    // 不断言全局请求总数——其他用例故意留下的未同步记录会在每轮同步里被正常重试，
    // 这是预期行为，不是本用例要验证的对象。
    const created = await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '只上传一次', estimatedPomodoros: 1, destination: 'list',
    });

    await uploadChanges(at(1), TIMEZONE, { storage: memoryStorage() });
    expect(rowsFor('tasks', created.value.id)).toHaveLength(1);

    const secondResult = await uploadChanges(at(2), TIMEZONE, { storage: memoryStorage() });

    expect(rowsFor('tasks', created.value.id)).toHaveLength(1);
    const taskEntity = secondResult.entities.find((entity) => entity.store === STORE.tasks)!;
    expect(taskEntity.failedIds).not.toContain(created.value.id);
  });
});

describe('uploadChanges events (S4)', () => {
  it('上传 Event 使用游标去重，第二次调用不会重复上传同一批 Event', async () => {
    await createManualTask({
      now: at(0), timezone: TIMEZONE, title: '产生一个 Event', estimatedPomodoros: 1, destination: 'list',
    });

    const storage = memoryStorage();
    const first = await uploadChanges(at(1), TIMEZONE, { storage });
    expect(first.events.succeeded).toBeGreaterThan(0);
    const firstBatchCount = (captured.events ?? []).length;
    expect(firstBatchCount).toBeGreaterThan(0);

    const second = await uploadChanges(at(2), TIMEZONE, { storage });
    expect(second.events).toEqual({ attempted: 0, succeeded: 0 });
    expect((captured.events ?? []).length).toBe(firstBatchCount);
  });
});
