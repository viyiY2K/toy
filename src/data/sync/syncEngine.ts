/**
 * 同步引擎编排入口（S5：上传 + 下载，并对外暴露"这一轮同步完成了"的通知）。
 * 本阶段仍不对外暴露给 UI（不进 src/data/index.ts），接线留给 S7。
 */

import type { IsoDateTime } from '../schema';
import { uploadChanges, type UploadChangesResult } from './uploadChanges';
import { downloadChanges, type DownloadChangesResult } from './downloadChanges';

export interface SyncRunResult {
  configured: boolean;
  upload: UploadChangesResult;
  download: DownloadChangesResult;
}

type SyncStateListener = (result: SyncRunResult) => void;

const listeners = new Set<SyncStateListener>();

/**
 * 订阅"一轮同步跑完了"的通知（无论成功与否，只要 runSync 走完一次就通知一次）。
 * 返回取消订阅函数。S7 会用它触发 UI 的 reload()。
 */
export function onSyncStateChange(listener: SyncStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 先上传本地变更、再下载远端变更——保证本地这一轮产生的变更不会被自己刚下载的旧数据覆盖。 */
export async function runSync(now: IsoDateTime, timezone: string): Promise<SyncRunResult> {
  const upload = await uploadChanges(now, timezone);
  const download = await downloadChanges(now, timezone);
  const result: SyncRunResult = { configured: upload.configured && download.configured, upload, download };
  for (const listener of listeners) listener(result);
  return result;
}

/** 仅供测试清空订阅者列表，避免测试间互相污染。 */
export function __clearSyncStateListenersForTests(): void {
  listeners.clear();
}
