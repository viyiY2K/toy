export const AUTO_BACKUP_FILE_NAME = 'toy-backup-auto.json';

export function canPickBackupDirectory(api = globalThis) {
  return typeof api.showDirectoryPicker === 'function';
}

export function suggestedManualBackupFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `toy-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}

export function formatBackupClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatBackupStatus(prefs, { canPickDirectory } = { canPickDirectory: true }) {
  if (!canPickDirectory) {
    return '当前浏览器不能自动写到你选的文件夹。请改用手动导出，或使用 Chrome / Edge。';
  }
  if (!prefs.enabled) return '自动备份已关闭';
  if (!prefs.directoryName) return '自动备份已打开，还需要选择一个文件夹';
  const interval = `每 ${prefs.intervalMinutes} 分钟覆盖写入「${prefs.directoryName}」里的 ${AUTO_BACKUP_FILE_NAME}`;
  if (prefs.lastError) return `${interval}。上次失败：${prefs.lastError}`;
  if (prefs.lastSuccessAt) return `${interval}。上次成功：${formatBackupClock(prefs.lastSuccessAt)}`;
  return interval;
}
