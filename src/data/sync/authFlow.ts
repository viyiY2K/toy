/**
 * 登录（S7）：邮箱免密登录（Magic Link）。真正的白名单限制在 Supabase 后台配置
 * （见 docs/sync-supabase-setup.md），这里只是发起/查询登录状态，不做前端白名单判断。
 */

import { getSupabaseClient } from './supabaseClient';

export type AuthStatus = 'unconfigured' | 'unauthenticated' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  email: string | null;
}

const UNCONFIGURED: AuthState = { status: 'unconfigured', email: null };

/** 发起一次 Magic Link 登录邮件；Supabase 后台白名单外的邮箱会在这一步被拒绝。 */
export async function requestMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: '同步未配置' };
  const { error } = await client.auth.signInWithOtp({ email });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getAuthState(): Promise<AuthState> {
  const client = getSupabaseClient();
  if (!client) return UNCONFIGURED;
  const { data } = await client.auth.getSession();
  const session = data.session;
  return { status: session ? 'authenticated' : 'unauthenticated', email: session?.user.email ?? null };
}

/** 订阅登录状态变化（含 Magic Link 邮件回跳后的自动登录）。返回取消订阅函数。 */
export function onAuthStateChange(listener: (state: AuthState) => void): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    listener({ status: session ? 'authenticated' : 'unauthenticated', email: session?.user.email ?? null });
  });
  return () => data.subscription.unsubscribe();
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}
