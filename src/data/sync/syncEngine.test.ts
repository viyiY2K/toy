import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataStore, STORE } from '../dataStore';
import type { Settings } from '../schema';
import { createManualTask } from '../commands/taskCommands';
import { __resetSupabaseClientForTests, getSupabaseClient } from './supabaseClient';
import {
  __resetSyncEngineForTests,
  __setPendingBaselineConflictForTests,
  getSyncState,
  onSyncStateChange,
  resolveLifetimePomodoroBaselineConflict,
  runSync,
} from './syncEngine';

const TIMEZONE = 'Asia/Shanghai';
const NOW = '2026-10-01T09:00:00+08:00';

function memoryStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  __resetSupabaseClientForTests();
  __resetSyncEngineForTests();
});

afterEach(() => {
  __resetSupabaseClientForTests();
  __resetSyncEngineForTests();
});

describe('runSync (S6 orchestration entry：上传 + 下载 + baseline 冲突状态)', () => {
  it('未配置 Supabase 时透传 configured:false，不抛错', async () => {
    getSupabaseClient({});
    const result = await runSync(NOW, TIMEZONE);
    expect(result.configured).toBe(false);
    expect(result.upload.configured).toBe(false);
    expect(result.download.configured).toBe(false);
  });

  it('每轮 runSync 跑完后通知所有订阅者一次', async () => {
    getSupabaseClient({});
    const received: boolean[] = [];
    const unsubscribe = onSyncStateChange((result) => {
      received.push(result.configured);
    });

    await runSync(NOW, TIMEZONE);
    expect(received).toEqual([false]);

    unsubscribe();
    await runSync(NOW, TIMEZONE);
    expect(received).toEqual([false]); // 取消订阅后不再收到通知
  });

  it('未配置 Supabase 时不会产生 pending baseline 冲突', async () => {
    getSupabaseClient({});
    await runSync(NOW, TIMEZONE);
    expect(getSyncState().pendingBaselineConflict).toBeNull();
  });
});

describe('resolveLifetimePomodoroBaselineConflict', () => {
  it('choice=keepLocal 落地本地值，并清空 pending 状态', async () => {
    await createManualTask({
      now: NOW, timezone: TIMEZONE, title: '为了初始化 Settings', estimatedPomodoros: 1, destination: 'list',
    });
    const [settingsBefore] = await dataStore.getAll<Settings>(STORE.settings);

    __setPendingBaselineConflictForTests({ local: settingsBefore!.lifetimePomodoroBaseline, remote: 999 });
    expect(getSyncState().pendingBaselineConflict).not.toBeNull();

    await resolveLifetimePomodoroBaselineConflict('keepLocal', NOW, TIMEZONE, undefined, { storage: memoryStorage() });

    expect(getSyncState().pendingBaselineConflict).toBeNull();
    const [settingsAfter] = await dataStore.getAll<Settings>(STORE.settings);
    expect(settingsAfter!.lifetimePomodoroBaseline).toBe(settingsBefore!.lifetimePomodoroBaseline);
    expect(settingsAfter!.deviceId).not.toBeNull();
  });

  it('choice=useValue 落地用户指定的最终值', async () => {
    await createManualTask({
      now: NOW, timezone: TIMEZONE, title: '为了初始化 Settings2', estimatedPomodoros: 1, destination: 'list',
    });

    __setPendingBaselineConflictForTests({ local: 10, remote: 20 });
    await resolveLifetimePomodoroBaselineConflict('useValue', NOW, TIMEZONE, 15, { storage: memoryStorage() });

    const [settingsAfter] = await dataStore.getAll<Settings>(STORE.settings);
    expect(settingsAfter!.lifetimePomodoroBaseline).toBe(15);
    expect(getSyncState().pendingBaselineConflict).toBeNull();
  });

  it('没有 pending 冲突时调用是无操作', async () => {
    await expect(resolveLifetimePomodoroBaselineConflict('keepLocal', NOW, TIMEZONE)).resolves.toBeUndefined();
  });
});
