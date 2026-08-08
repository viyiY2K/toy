/**
 * Supabase 客户端单例（S3，多端同步网络地基）。
 *
 * 环境变量缺失（本地未配置 .env、或 CI 未注入 Secrets）时，getSupabaseClient()
 * 返回 null 而不是抛错——这是保证"中间施工阶段不破坏现有本地单机体验"的关键：
 * 同步相关代码必须先检查这个返回值，未配置就直接跳过同步、不阻塞 App 启动。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** 可注入的环境变量来源，便于测试脱离真实 import.meta.env / .env 文件。 */
export interface SupabaseEnvSource {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

function defaultEnv(): SupabaseEnvSource {
  return (import.meta as unknown as { env?: SupabaseEnvSource }).env ?? {};
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 同步能力是否已配置（即两个环境变量是否都已提供）。 */
export function isSyncConfigured(env: SupabaseEnvSource = defaultEnv()): boolean {
  return nonEmpty(env.VITE_SUPABASE_URL) !== undefined && nonEmpty(env.VITE_SUPABASE_ANON_KEY) !== undefined;
}

let cached: SupabaseClient | null | undefined;

/** 返回单例 Supabase 客户端；环境变量未配置时返回 null，调用方必须显式处理这个分支。 */
export function getSupabaseClient(env: SupabaseEnvSource = defaultEnv()): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = nonEmpty(env.VITE_SUPABASE_URL);
  const anonKey = nonEmpty(env.VITE_SUPABASE_ANON_KEY);
  cached = url && anonKey ? createClient(url, anonKey) : null;
  return cached;
}

/** 仅供测试重置单例缓存，生产代码不应调用。 */
export function __resetSupabaseClientForTests(): void {
  cached = undefined;
}
