/**
 * 自动备份文件夹句柄。单独放在本机元数据库，不进用户数据快照，也不参与同步。
 */

const META_DB_NAME = 'pomodoro-backup-handles';
const META_STORE = 'handles';
const DIRECTORY_KEY = 'autoBackupDirectory';

export interface BackupDirectoryHandle {
  readonly name: string;
  getFileHandle?(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState | string>;
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState | string>;
}

function openMetaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(META_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(META_STORE)) {
        request.result.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveBackupDirectoryHandle(handle: BackupDirectoryHandle): Promise<void> {
  const db = await openMetaDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore(META_STORE).put(handle, DIRECTORY_KEY);
  });
}

export async function loadBackupDirectoryHandle(): Promise<BackupDirectoryHandle | null> {
  const db = await openMetaDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(DIRECTORY_KEY);
    request.onsuccess = () => resolve((request.result as BackupDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function clearBackupDirectoryHandle(): Promise<void> {
  const db = await openMetaDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore(META_STORE).delete(DIRECTORY_KEY);
  });
}
