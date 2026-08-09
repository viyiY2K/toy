export const SYNC_POLL_INTERVAL_MS = 5 * 60 * 1000;

export function hasSyncErrors(syncRunResult) {
  if (!syncRunResult) return false;
  const uploadErrors = syncRunResult.upload.entities.some((entity) => entity.error)
    || Boolean(syncRunResult.upload.events.error);
  const downloadErrors = syncRunResult.download.entities.some((entity) => entity.error)
    || Boolean(syncRunResult.download.events.error);
  return uploadErrors || downloadErrors;
}

/**
 * 侧边栏底部展示的同步状态文案。authStatus 来自 authFlow 的 AuthState.status；
 * lastSyncResult 是最近一次 runSync() 的结果（还没跑过则为 null）。
 * 返回 null 表示这一行完全不显示（同步未配置时，不打扰纯本地使用的用户）。
 */
export function formatSyncStatusText(authStatus, lastSyncResult) {
  if (authStatus === 'unconfigured') return null;
  if (authStatus === 'unauthenticated') return '未登录，数据只存在本机';
  if (!lastSyncResult) return '已登录，等待首次同步…';
  if (!lastSyncResult.configured) return '同步未生效';
  if (hasSyncErrors(lastSyncResult)) return '同步时遇到问题，稍后自动重试';
  return '已同步';
}
