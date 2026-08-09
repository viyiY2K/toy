import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSupabaseClientForTests,
  getSupabaseClient,
  isSyncConfigured,
  type SupabaseEnvSource,
} from './supabaseClient';

beforeEach(() => {
  __resetSupabaseClientForTests();
});

const CONFIGURED: SupabaseEnvSource = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
};

describe('supabaseClient (S3 sync network infra)', () => {
  it('未配置任何环境变量时视为未配置，getSupabaseClient 返回 null', () => {
    const env: SupabaseEnvSource = {};
    expect(isSyncConfigured(env)).toBe(false);
    expect(getSupabaseClient(env)).toBeNull();
  });

  it('空字符串视为未配置', () => {
    const env: SupabaseEnvSource = { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' };
    expect(isSyncConfigured(env)).toBe(false);
    expect(getSupabaseClient(env)).toBeNull();
  });

  it('只配置了一半（缺 anon key）时仍视为未配置', () => {
    const env: SupabaseEnvSource = { VITE_SUPABASE_URL: 'https://example.supabase.co' };
    expect(isSyncConfigured(env)).toBe(false);
    expect(getSupabaseClient(env)).toBeNull();
  });

  it('两个环境变量都配置后视为已配置，能拿到一个客户端实例', () => {
    expect(isSyncConfigured(CONFIGURED)).toBe(true);
    expect(getSupabaseClient(CONFIGURED)).not.toBeNull();
  });

  it('客户端是单例，重复调用（即使传不同 env）返回同一个已缓存实例', () => {
    const first = getSupabaseClient(CONFIGURED);
    const second = getSupabaseClient({});
    expect(first).toBe(second);
    expect(second).not.toBeNull();
  });
});
