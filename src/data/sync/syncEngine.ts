/**
 * 同步引擎编排入口（S6：上传 + 下载 + Settings baseline 冲突的 pending 状态与解决入口）。
 * 本阶段仍不对外暴露给 UI（不进 src/data/index.ts），接线留给 S7。
 */

import type { IsoDateTime } from '../schema';
import { uploadChanges, type UploadChangesResult } from './uploadChanges';
import { downloadChanges, type DownloadChangesResult } from './downloadChanges';
import {
  applyLifetimePomodoroBaselineResolution,
  type BaselineConflictChoice,
  type LifetimeBaselineConflict,
} from './settingsMerge';
import { getOrCreateDeviceId, type DeviceIdentityStorage } from './deviceIdentity';

export interface SyncRunResult {
  configured: boolean;
  upload: UploadChangesResult;
  download: DownloadChangesResult;
}

export interface SyncState {
  pendingBaselineConflict: LifetimeBaselineConflict | null;
}

type SyncStateListener = (result: SyncRunResult) => void;

const listeners = new Set<SyncStateListener>();
let pendingBaselineConflict: LifetimeBaselineConflict | null = null;

/**
 * 订阅"一轮同步跑完了"的通知（无论成功与否，只要 runSync 走完一次就通知一次）。
 * 返回取消订阅函数。S7 会用它触发 UI 的 reload()。
 */
export function onSyncStateChange(listener: SyncStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 当前同步引擎状态；目前只有"是否有待用户处理的 lifetimePomodoroBaseline 冲突"。 */
export function getSyncState(): SyncState {
  return { pendingBaselineConflict };
}

/** 先上传本地变更、再下载远端变更——保证本地这一轮产生的变更不会被自己刚下载的旧数据覆盖。 */
export async function runSync(now: IsoDateTime, timezone: string): Promise<SyncRunResult> {
  const upload = await uploadChanges(now, timezone);
  const download = await downloadChanges(now, timezone);
  if (download.settingsBaselineConflict) pendingBaselineConflict = download.settingsBaselineConflict;

  const result: SyncRunResult = { configured: upload.configured && download.configured, upload, download };
  for (const listener of listeners) listener(result);
  return result;
}

/**
 * 用户对 lifetimePomodoroBaseline 冲突做出选择后调用；写入成功才清空 pending 状态，
 * 写入失败（比如 value 非法）保留 pending，让用户可以重新选择。
 */
export async function resolveLifetimePomodoroBaselineConflict(
  choice: BaselineConflictChoice,
  now: IsoDateTime,
  timezone: string,
  value?: number,
  options: { storage?: DeviceIdentityStorage } = {},
): Promise<void> {
  if (!pendingBaselineConflict) return;
  await applyLifetimePomodoroBaselineResolution(
    pendingBaselineConflict,
    choice,
    now,
    timezone,
    getOrCreateDeviceId(options.storage),
    value,
  );
  pendingBaselineConflict = null;
}

/** 仅供测试清空订阅者列表与 pending 状态，避免测试间互相污染。 */
export function __resetSyncEngineForTests(): void {
  listeners.clear();
  pendingBaselineConflict = null;
}

/** 仅供测试直接摆入一个 pending 冲突，绕开真实的下载流程去单独验证解决入口的行为。 */
export function __setPendingBaselineConflictForTests(conflict: LifetimeBaselineConflict | null): void {
  pendingBaselineConflict = conflict;
}
