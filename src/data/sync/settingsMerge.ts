/**
 * Settings 合并（S6）：不适用整表 last-write-wins，需要字段级处理（v4 §2.6 方向）。
 *
 * 已确认的落地精细度：除 `lifetimePomodoroBaseline` 外的全部字段整条记录取 `updatedAt`
 * 较新一份（含 `restSuggestions`/`dailyTaskTemplates` 两个数组字段，不做数组级 diff）。
 * `lifetimePomodoroBaseline` 是语义冲突（用户手动录入的历史累计基数，不该"谁改得晚就听谁的"），
 * 检测到两端不同时不自动覆盖、暂缓保持本地值，交给用户决定（`resolveLifetimePomodoroBaselineConflict`）。
 *
 * 合并结果恒定延续本机既有 Settings 的身份（`id`/`createdAt` 取本地），不吸收远端 id——
 * Settings 是单例，"合并"语义上是"把远端信息并入本机这一份"，不是"选出一个新的代表"。
 * 已知限制：如果这次合并选中的是远端内容更新，远端那条 id 不同的行不会被这台设备清理，
 * 会在 Supabase 里持续存在（与 ADR-0036 记录的 DayPlan 同类限制一致）。
 */

import type { Settings, IsoDateTime } from '../schema';
import { STORE } from '../dataStore';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';

export interface LifetimeBaselineConflict {
  local: number;
  remote: number;
}

export interface SettingsMergeResult {
  merged: Settings;
  baselineConflict: LifetimeBaselineConflict | null;
}

const CONTENT_KEYS = [
  'focusMinutes',
  'shortBreakMinutes',
  'longBreakMinutes',
  'longBreakEvery',
  'restSuggestions',
  'dailyTaskTemplates',
  'lifetimePomodoroBaseline',
  'restSuggestionDisplayMode',
  'appDayStartOffsetMinutes',
] as const;

/** 只比较业务字段，不比较 id/createdAt/updatedAt/deviceId/syncedAt 这些同步簿记字段。 */
export function settingsContentEquals(a: Settings, b: Settings): boolean {
  return CONTENT_KEYS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/** 纯函数：给定本地与远端两份 Settings，算出合并结果与 baseline 冲突信息，不做任何写入。 */
export function mergeSettings(local: Settings, remote: Settings): SettingsMergeResult {
  const remoteIsNewer = Date.parse(remote.updatedAt) > Date.parse(local.updatedAt);
  const winner = remoteIsNewer ? remote : local;
  const baselineConflict: LifetimeBaselineConflict | null =
    local.lifetimePomodoroBaseline === remote.lifetimePomodoroBaseline
      ? null
      : { local: local.lifetimePomodoroBaseline, remote: remote.lifetimePomodoroBaseline };

  const merged: Settings = {
    ...winner,
    id: local.id,
    createdAt: local.createdAt,
    lifetimePomodoroBaseline: local.lifetimePomodoroBaseline,
  };

  return { merged, baselineConflict };
}

export type BaselineConflictChoice = 'keepLocal' | 'keepRemote' | 'useValue';

/**
 * 用户对 lifetimePomodoroBaseline 冲突做出选择后，把最终值落地到本地 Settings。
 * 走 writeMode:'sync'——这次写入是"同步冲突解决"的一部分，不是普通本地编辑。
 * 调用方（syncEngine）负责在写入成功后清空自己的 pending 状态。
 */
export async function applyLifetimePomodoroBaselineResolution(
  conflict: LifetimeBaselineConflict,
  choice: BaselineConflictChoice,
  now: IsoDateTime,
  timezone: string,
  deviceId: string,
  value?: number,
): Promise<Settings> {
  const finalValue = choice === 'keepLocal' ? conflict.local : choice === 'keepRemote' ? conflict.remote : value;
  if (finalValue === undefined) {
    throw new Error("applyLifetimePomodoroBaselineResolution: choice='useValue' 必须提供 value");
  }
  return executeAtomicWrite(
    { storeNames: [STORE.settings], now, timezone, writeMode: 'sync' },
    async (transaction) => {
      const [current] = await transaction.getAll<Settings>(STORE.settings);
      if (!current) throw new Error('本地不存在有效 Settings，无法落地冲突解决结果');
      const updated: Settings = {
        ...current,
        lifetimePomodoroBaseline: finalValue,
        updatedAt: now,
        deviceId,
        syncedAt: now,
      };
      await transaction.put(STORE.settings, updated);
      return updated;
    },
  );
}
