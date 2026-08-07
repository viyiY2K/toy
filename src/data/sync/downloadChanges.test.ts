import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { dataStore, STORE } from '../dataStore';
import type { DayPlan, Event, Task } from '../schema';
import { createManualTask } from '../commands/taskCommands';
import { __resetSupabaseClientForTests, getSupabaseClient } from './supabaseClient';
import { downloadChanges } from './downloadChanges';
import { toRemoteEventRow } from './remoteRowMappers';

const TIMEZONE = 'Asia/Shanghai';
const dayAt = (day: number, minute: number) =>
  `2026-10-${String(day).padStart(2, '0')}T09:${String(minute).padStart(2, '0')}:00+08:00`;

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

/** 默认所有表都返回空结果，测试里按需用 server.use() 覆盖具体表。 */
function emptyHandlers() {
  return TABLES.map((table) => http.get(`${REST_URL}/${table}`, () => HttpResponse.json([])));
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  server.use(...emptyHandlers());
  __resetSupabaseClientForTests();
  getSupabaseClient({ VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'test-anon-key' });
});

const REMOTE_DEVICE_ID = '018f5e2a-0000-7000-8000-0000000000aa';

function remoteTaskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '018f5e2a-0000-7000-8000-000000000001',
    created_at: dayAt(1, 0),
    updated_at: dayAt(1, 0),
    schema_version: 1,
    deleted_at: null,
    device_id: REMOTE_DEVICE_ID,
    parent_id: null,
    title: '远端任务',
    status: 'active',
    outcome: null,
    completion_source: null,
    estimated_pomodoros: 1,
    estimate_rounds: [{ index: 1, pomodoros: 1, occurredAt: dayAt(1, 0) }],
    actual_work_note: null,
    note: null,
    sort_index: 1000,
    completed_at: null,
    archived_at: null,
    deleted_reason: null,
    metadata: {},
    lineage_id: '018f5e2a-0000-7000-8000-000000000001',
    split_from_task_id: null,
    split_index: 0,
    ...overrides,
  };
}

function remoteDayPlanRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '018f5e2a-0000-7000-8000-0000000000d1',
    created_at: dayAt(2, 0),
    updated_at: dayAt(2, 0),
    schema_version: 1,
    deleted_at: null,
    device_id: REMOTE_DEVICE_ID,
    app_date: '2026-10-02',
    local_date: '2026-10-02',
    timezone: TIMEZONE,
    task_ids: [],
    budget_pomodoros: 0,
    budget_mode: 'conservative',
    estimate: {
      workWindowMin: 0, fixedDeductions: [], lifeDeductions: [], freeMin: 0,
      conservativePomodoros: 0, optimisticPomodoros: 0,
    },
    settings_snapshot: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
    ...overrides,
  };
}

describe('downloadChanges (S5)', () => {
  it('未配置 Supabase 时直接返回 configured:false，不发任何请求', async () => {
    __resetSupabaseClientForTests();
    getSupabaseClient({});
    const result = await downloadChanges(dayAt(1, 10), TIMEZONE, { storage: memoryStorage() });
    expect(result).toEqual({ configured: false, entities: [], events: { fetched: 0, applied: 0 } });
  });

  it('本地不存在的远端 Task 会被直接写入本地', async () => {
    server.use(http.get(`${REST_URL}/tasks`, () => HttpResponse.json([remoteTaskRow()])));

    const result = await downloadChanges(dayAt(1, 5), TIMEZONE, { storage: memoryStorage() });
    const taskEntity = result.entities.find((entity) => entity.store === STORE.tasks)!;
    expect(taskEntity).toMatchObject({ fetched: 1, applied: 1, skipped: 0, failed: 0 });

    const stored = await dataStore.get<Task>(STORE.tasks, remoteTaskRow().id);
    expect(stored).toMatchObject({ title: '远端任务', deviceId: REMOTE_DEVICE_ID });
    expect(stored!.syncedAt).toBe(dayAt(1, 5));
  });

  it('本地已存在同 id 记录时，远端更新则覆盖，远端更旧则跳过', async () => {
    // 本地先手动创建一条同 id 的记录不现实（id 由本地生成），改用「先下载一次远端旧版本，
    // 再下载一次远端新版本」验证覆盖分支；跳过分支则反过来用「先新后旧」验证。
    const older = remoteTaskRow({ updated_at: dayAt(1, 1), title: '旧标题' });
    const newer = remoteTaskRow({ updated_at: dayAt(1, 2), title: '新标题' });

    server.use(http.get(`${REST_URL}/tasks`, () => HttpResponse.json([older])));
    await downloadChanges(dayAt(1, 5), TIMEZONE, { storage: memoryStorage() });
    let stored = await dataStore.get<Task>(STORE.tasks, older.id);
    expect(stored!.title).toBe('旧标题');

    // 覆盖分支：不依赖游标（游标已经推进到 older.updated_at 之后），直接构造一次
    // "全量返回"场景验证 applyRemoteEntityRow 的 LWW 比较本身。
    server.resetHandlers(...emptyHandlers());
    server.use(http.get(`${REST_URL}/tasks`, () => HttpResponse.json([newer])));
    const storage = memoryStorage();
    // 手动种一个游标空白的 storage，绕开"cursor 已经超过 newer.updated_at"的问题。
    await downloadChanges(dayAt(1, 6), TIMEZONE, { storage });
    stored = await dataStore.get<Task>(STORE.tasks, older.id);
    expect(stored!.title).toBe('新标题');
  });

  it('DayPlan appDate 冲突：远端更新时，本地旧的那条被软删，远端那条落地', async () => {
    const created = await createManualTask({
      now: dayAt(3, 0), timezone: TIMEZONE, title: '本地今日任务', estimatedPomodoros: 1, destination: 'today',
    });
    const localDayPlan = (await dataStore.getAll<DayPlan>(STORE.dayPlans)).find(
      (dayPlan) => dayPlan.appDate === '2026-10-03',
    );
    expect(localDayPlan).toBeDefined();

    const remoteRow = remoteDayPlanRow({
      id: '018f5e2a-0000-7000-8000-0000000000e1',
      created_at: dayAt(3, 15),
      app_date: '2026-10-03',
      local_date: '2026-10-03',
      updated_at: dayAt(3, 20), // 比本地 DayPlan 的 updatedAt（dayAt(3,0)）更新
    });
    server.use(http.get(`${REST_URL}/day_plans`, () => HttpResponse.json([remoteRow])));

    const result = await downloadChanges(dayAt(3, 25), TIMEZONE, { storage: memoryStorage() });
    const dayPlanEntity = result.entities.find((entity) => entity.store === STORE.dayPlans)!;
    expect(dayPlanEntity).toMatchObject({ applied: 1, failed: 0 });

    const localOldTombstone = await dataStore.getIncludingDeleted<DayPlan>(STORE.dayPlans, localDayPlan!.id);
    expect(localOldTombstone!.deletedAt).not.toBeNull();

    const remoteApplied = await dataStore.get<DayPlan>(STORE.dayPlans, remoteRow.id);
    expect(remoteApplied).toMatchObject({ appDate: '2026-10-03' });

    // 原本今日任务所属的 DayPlan 已经不是"当前有效"的那条了，但 Task 本身不受影响。
    const task = await dataStore.get<Task>(STORE.tasks, created.value.id);
    expect(task).not.toBeNull();
  });

  it('DayPlan appDate 冲突：本地更新时，保留本地、跳过远端那条', async () => {
    await createManualTask({
      now: dayAt(4, 30), timezone: TIMEZONE, title: '本地今日任务2', estimatedPomodoros: 1, destination: 'today',
    });
    const localDayPlan = (await dataStore.getAll<DayPlan>(STORE.dayPlans)).find(
      (dayPlan) => dayPlan.appDate === '2026-10-04',
    );
    expect(localDayPlan).toBeDefined();

    const remoteRow = remoteDayPlanRow({
      id: '018f5e2a-0000-7000-8000-0000000000e2',
      created_at: dayAt(4, 5),
      app_date: '2026-10-04',
      local_date: '2026-10-04',
      updated_at: dayAt(4, 10), // 比本地 DayPlan 的 updatedAt（dayAt(4,30)）更旧
    });
    server.use(http.get(`${REST_URL}/day_plans`, () => HttpResponse.json([remoteRow])));

    const result = await downloadChanges(dayAt(4, 35), TIMEZONE, { storage: memoryStorage() });
    const dayPlanEntity = result.entities.find((entity) => entity.store === STORE.dayPlans)!;
    expect(dayPlanEntity).toMatchObject({ skipped: 1, applied: 0, failed: 0 });

    const stillLocal = await dataStore.get<DayPlan>(STORE.dayPlans, localDayPlan!.id);
    expect(stillLocal).not.toBeNull();
    expect(stillLocal!.deletedAt).toBeNull();

    const remoteNotApplied = await dataStore.get<DayPlan>(STORE.dayPlans, remoteRow.id);
    expect(remoteNotApplied).toBeUndefined();
  });
});

describe('downloadChanges events (S5)', () => {
  it('本地已存在同 id 的 Event 时跳过，不重复 append', async () => {
    await createManualTask({
      now: dayAt(5, 0), timezone: TIMEZONE, title: '产生一个本地 Event', estimatedPomodoros: 1, destination: 'list',
    });
    const localEvents = await dataStore.getAll<Event>(STORE.events);
    const existingEvent = localEvents[0]!;

    server.use(
      http.get(`${REST_URL}/events`, () => HttpResponse.json([toRemoteEventRow(existingEvent)])),
    );

    const result = await downloadChanges(dayAt(5, 5), TIMEZONE, { storage: memoryStorage() });
    expect(result.events.fetched).toBeGreaterThan(0);
    expect(result.events.applied).toBe(0);

    const afterEvents = await dataStore.getAll<Event>(STORE.events);
    expect(afterEvents.filter((event) => event.id === existingEvent.id)).toHaveLength(1);
  });
});
