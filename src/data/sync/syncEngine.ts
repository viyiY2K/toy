/**
 * 同步引擎编排入口（S4：只接上传；S5 会补上下载 + 变更通知）。
 * 本阶段不对外暴露给 UI（不进 src/data/index.ts），仅供后续阶段内部调用。
 */

import type { IsoDateTime } from '../schema';
import { uploadChanges, type UploadChangesResult } from './uploadChanges';

export interface SyncRunResult {
  configured: boolean;
  upload: UploadChangesResult;
}

export async function runSync(now: IsoDateTime, timezone: string): Promise<SyncRunResult> {
  const upload = await uploadChanges(now, timezone);
  return { configured: upload.configured, upload };
}
