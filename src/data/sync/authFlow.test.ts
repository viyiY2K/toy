import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { __resetSupabaseClientForTests, getSupabaseClient } from './supabaseClient';
import { getAuthState, requestMagicLink } from './authFlow';

const SUPABASE_URL = 'https://example.supabase.co';
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  __resetSupabaseClientForTests();
});

describe('authFlow (S7)', () => {
  it('未配置 Supabase 时 requestMagicLink 直接返回失败，不发请求', async () => {
    getSupabaseClient({});
    const result = await requestMagicLink('user@example.com');
    expect(result).toEqual({ ok: false, error: '同步未配置' });
  });

  it('未配置 Supabase 时 getAuthState 返回 unconfigured', async () => {
    getSupabaseClient({});
    const state = await getAuthState();
    expect(state).toEqual({ status: 'unconfigured', email: null });
  });

  it('白名单内邮箱：Supabase 接受请求，requestMagicLink 返回成功', async () => {
    getSupabaseClient({ VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'test-anon-key' });
    server.use(http.post(`${AUTH_URL}/otp`, () => HttpResponse.json({})));

    const result = await requestMagicLink('owner@example.com');
    expect(result).toEqual({ ok: true });
  });

  it('白名单外邮箱：Supabase 拒绝，requestMagicLink 把错误信息透传出来', async () => {
    getSupabaseClient({ VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'test-anon-key' });
    server.use(
      http.post(`${AUTH_URL}/otp`, () =>
        HttpResponse.json({ error_code: 'signup_disabled', msg: 'Email not allowed' }, { status: 422 }),
      ),
    );

    const result = await requestMagicLink('stranger@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('已配置但尚未登录时 getAuthState 返回 unauthenticated', async () => {
    getSupabaseClient({ VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'test-anon-key' });
    const state = await getAuthState();
    expect(state).toEqual({ status: 'unauthenticated', email: null });
  });
});
