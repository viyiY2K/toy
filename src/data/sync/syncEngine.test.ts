import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetSupabaseClientForTests, getSupabaseClient } from './supabaseClient';
import { __clearSyncStateListenersForTests, onSyncStateChange, runSync } from './syncEngine';

const TIMEZONE = 'Asia/Shanghai';
const NOW = '2026-10-01T09:00:00+08:00';

beforeEach(() => {
  __resetSupabaseClientForTests();
  __clearSyncStateListenersForTests();
});

afterEach(() => {
  __resetSupabaseClientForTests();
  __clearSyncStateListenersForTests();
});

describe('runSync (S5 orchestration entry：上传 + 下载)', () => {
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
});
