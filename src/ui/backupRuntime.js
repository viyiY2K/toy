import {
  clearBackupDirectoryHandle,
  exportLocalBackup,
  getBackupPreferences,
  importLocalBackup,
  loadBackupDirectoryHandle,
  recordLocalBackupExported,
  saveBackupDirectoryHandle,
  serializeLocalBackup,
  updateBackupPreferences,
} from '../data/index';
import { AUTO_BACKUP_FILE_NAME, canPickBackupDirectory } from './backupViewModel';

const listeners = new Set();
let intervalId = null;
let inFlight = false;

function clock() {
  return {
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function notifyBackupRuntime() {
  const prefs = getBackupPreferences();
  for (const listener of listeners) listener(prefs);
}

export function subscribeBackupRuntime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function pickBackupDirectory() {
  if (!canPickBackupDirectory()) {
    throw new Error('当前浏览器不支持选择文件夹');
  }
  const handle = await window.showDirectoryPicker({ id: 'toy-backup', mode: 'readwrite' });
  if (typeof handle.requestPermission === 'function') {
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('没有写入该文件夹的权限');
  }
  await saveBackupDirectoryHandle(handle);
  updateBackupPreferences({
    directoryName: handle.name,
    enabled: true,
    lastError: null,
  });
  notifyBackupRuntime();
  restartAutoBackupLoop();
  return handle;
}

export async function clearPickedBackupDirectory() {
  await clearBackupDirectoryHandle();
  updateBackupPreferences({ directoryName: null, enabled: false, lastError: null });
  notifyBackupRuntime();
  restartAutoBackupLoop();
}

export function setAutoBackupEnabled(enabled) {
  updateBackupPreferences({ enabled, lastError: enabled ? null : getBackupPreferences().lastError });
  notifyBackupRuntime();
  restartAutoBackupLoop();
}

export function setAutoBackupIntervalMinutes(intervalMinutes) {
  updateBackupPreferences({ intervalMinutes });
  notifyBackupRuntime();
  restartAutoBackupLoop();
}

async function writeTextToDirectory(handle, filename, text) {
  if (typeof handle.queryPermission === 'function') {
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (permission !== 'granted') {
      throw new Error('没有写入该文件夹的权限，请重新选择');
    }
  }
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBackupFile(handle, text) {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    // 失败时释放临时文件与写入锁，不把未完成的文件当成成功备份。
    if (typeof writable.abort === 'function') {
      await writable.abort().catch(() => undefined);
    }
    throw error;
  }
  return 'saved';
}

export async function saveBackupTextToUserFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 给浏览器下载导航留出消费 Blob URL 的时间。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export async function exportBackupToUserFile(filename) {
  let handle = null;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      // 必须在点击的用户激活仍有效时打开，不要先等待整个数据库读取完。
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }],
      });
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  const snapshot = await exportLocalBackup(clock());
  const text = serializeLocalBackup(snapshot);
  const outcome = handle
    ? await writeBackupFile(handle, text)
    : await saveBackupTextToUserFile(filename, text);
  await recordLocalBackupExported({ ...clock(), totalRecords: snapshot.totalRecords });
  return outcome;
}

export async function restoreBackupFromText(jsonText) {
  const result = await importLocalBackup({ ...clock(), jsonText });
  notifyBackupRuntime();
  return result;
}

export async function runAutoBackupOnce() {
  if (inFlight) return { ok: false, skipped: true };
  const prefs = getBackupPreferences();
  if (!prefs.enabled) return { ok: false, skipped: true };
  inFlight = true;
  try {
    const handle = await loadBackupDirectoryHandle();
    if (!handle) {
      updateBackupPreferences({ lastError: '还没有选择备份文件夹' });
      notifyBackupRuntime();
      return { ok: false };
    }
    const snapshot = await exportLocalBackup(clock());
    await writeTextToDirectory(handle, AUTO_BACKUP_FILE_NAME, serializeLocalBackup(snapshot));
    updateBackupPreferences({ lastSuccessAt: clock().now, lastError: null });
    notifyBackupRuntime();
    return { ok: true };
  } catch (error) {
    updateBackupPreferences({
      lastError: error instanceof Error ? error.message : String(error),
    });
    notifyBackupRuntime();
    return { ok: false };
  } finally {
    inFlight = false;
  }
}

export function stopAutoBackupLoop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function restartAutoBackupLoop() {
  stopAutoBackupLoop();
  const prefs = getBackupPreferences();
  if (!prefs.enabled || !prefs.directoryName || !canPickBackupDirectory()) return;
  const intervalMs = prefs.intervalMinutes * 60 * 1000;
  const last = prefs.lastSuccessAt ? Date.parse(prefs.lastSuccessAt) : NaN;
  const overdue = !Number.isFinite(last) || Date.now() - last >= intervalMs;
  if (overdue) void runAutoBackupOnce();
  intervalId = setInterval(() => {
    void runAutoBackupOnce();
  }, intervalMs);
}

export function startAutoBackupLoop() {
  restartAutoBackupLoop();
  return stopAutoBackupLoop;
}
