import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetSupabaseClientForTests, getSupabaseClient } from './supabaseClient';
import { runSync } from './syncEngine';

const TIMEZONE = 'Asia/Shanghai';
const NOW = '2026-10-01T09:00:00+08:00';

beforeEach(() => {
  __resetSupabaseClientForTests();
});

afterEach(() => {
  __resetSupabaseClientForTests();
});

describe('runSync (S4 orchestration entry)', () => {
  it('未配置 Supabase 时透传 configured:false，不抛错', async () => {
    getSupabaseClient({});
    const result = await runSync(NOW, TIMEZONE);
    expect(result.configured).toBe(false);
    expect(result.upload.configured).toBe(false);
  });
});
