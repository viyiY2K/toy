/**
 * 上传：本地变更 → Supabase（S4，单向 push，见 ADR-0035）。
 *
 * 六个可同步实体各自筛出"自上次同步后有变化"的记录（含软删 tombstone，
 * tombstone 也要上传，让远端知道"这条记录已被删除"），upsert 到远端；
 * 成功后把本地 syncedAt/deviceId 通过 writeMode:'sync' 回写。
 * Event 走独立的游标 + 去重上传路径（append-only，无 updatedAt 可比较）。
 *
 * 未配置 Supabase（getSupabaseClient() 返回 null）时 uploadChanges 直接返回
 * `configured: false`，不抛错、不做任何事——保证同步能力未配置时不影响现有本地体验。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { dataStore, EVENT_STORE, SYNCABLE_STORE_NAMES } from '../dataStore';
import type { SyncableEntityMap, SyncableStoreName } from '../dataStore';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import type { Event, IsoDateTime } from '../schema';
import { getOrCreateDeviceId, type DeviceIdentityStorage } from './deviceIdentity';
import { getSupabaseClient } from './supabaseClient';
import { REMOTE_EVENTS_TABLE, REMOTE_TABLE_BY_STORE, toRemoteEntityRow, toRemoteEventRow } from './remoteRowMappers';

const EVENT_UPLOAD_CURSOR_KEY = 'pomodoro:sync:lastUploadedEventId';

export interface UploadEntityResult {
  store: SyncableStoreName;
  attempted: number;
  succeeded: number;
  failedIds: readonly string[];
  error?: string;
}

export interface UploadEventsResult {
  attempted: number;
  succeeded: number;
  error?: string;
}

export interface UploadChangesResult {
  configured: boolean;
  entities: readonly UploadEntityResult[];
  events: UploadEventsResult;
}

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function isStale(updatedAt: string, syncedAt: string | null): boolean {
  return syncedAt === null || Date.parse(updatedAt) > Date.parse(syncedAt);
}

/**
 * 把这批上传成功的记录的本地 syncedAt/deviceId 回写。
 * 逐条比较 updatedAt 是否仍与"读出来准备上传时"一致——上传的网络往返期间，
 * 用户完全可能在本地又编辑了一次；这种情况下跳过回写，让这条记录下一轮同步时
 * 因为 updatedAt 又超过 syncedAt 而被重新选中上传，不把用户刚做的编辑标记成"已同步"。
 */
async function writeBackSyncMetadata(
  store: SyncableStoreName,
  capturedUpdatedAtById: ReadonlyMap<string, string>,
  syncedAt: IsoDateTime,
  deviceId: string,
  timezone: string,
): Promise<void> {
  if (capturedUpdatedAtById.size === 0) return;
  await executeAtomicWrite(
    { storeNames: [store], now: syncedAt, timezone, writeMode: 'sync' },
    async (transaction) => {
      for (const [id, capturedUpdatedAt] of capturedUpdatedAtById) {
        const current = await transaction.getIncludingDeleted<SyncableEntityMap[typeof store]>(store, id);
        if (!current || current.updatedAt !== capturedUpdatedAt) continue;
        await transaction.put(store, { ...current, deviceId, syncedAt });
      }
    },
  );
}

async function uploadEntityStore<S extends SyncableStoreName>(
  client: SupabaseClient,
  store: S,
  now: IsoDateTime,
  timezone: string,
  deviceId: string,
): Promise<UploadEntityResult> {
  const all = await dataStore.getAllIncludingDeleted<SyncableEntityMap[S]>(store);
  const pending = all.filter((record) => isStale(record.updatedAt, record.syncedAt));
  if (pending.length === 0) return { store, attempted: 0, succeeded: 0, failedIds: [] };

  const rows = pending.map((record) => toRemoteEntityRow(store, record));
  const table = REMOTE_TABLE_BY_STORE[store];
  const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });

  if (error) {
    return {
      store,
      attempted: pending.length,
      succeeded: 0,
      failedIds: pending.map((record) => record.id),
      error: error.message,
    };
  }

  const capturedUpdatedAtById = new Map(pending.map((record) => [record.id, record.updatedAt]));
  await writeBackSyncMetadata(store, capturedUpdatedAtById, now, deviceId, timezone);

  return { store, attempted: pending.length, succeeded: pending.length, failedIds: [] };
}

async function uploadEvents(
  client: SupabaseClient,
  storage: DeviceIdentityStorage | undefined,
): Promise<UploadEventsResult> {
  const cursor = storage?.getItem(EVENT_UPLOAD_CURSOR_KEY) ?? null;
  const all = await dataStore.getAll<Event>(EVENT_STORE);
  const pending = all
    .filter((event) => cursor === null || event.id > cursor)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pending.length === 0) return { attempted: 0, succeeded: 0 };

  const rows = pending.map(toRemoteEventRow);
  const { error } = await client
    .from(REMOTE_EVENTS_TABLE)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

  if (error) return { attempted: pending.length, succeeded: 0, error: error.message };

  storage?.setItem(EVENT_UPLOAD_CURSOR_KEY, pending[pending.length - 1]!.id);
  return { attempted: pending.length, succeeded: pending.length };
}

export interface UploadChangesOptions {
  storage?: DeviceIdentityStorage;
}

export async function uploadChanges(
  now: IsoDateTime,
  timezone: string,
  options: UploadChangesOptions = {},
): Promise<UploadChangesResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { configured: false, entities: [], events: { attempted: 0, succeeded: 0 } };
  }

  const storage = options.storage ?? defaultStorage();
  const deviceId = getOrCreateDeviceId(storage);

  const entities: UploadEntityResult[] = [];
  for (const store of SYNCABLE_STORE_NAMES) {
    entities.push(await uploadEntityStore(client, store, now, timezone, deviceId));
  }
  const events = await uploadEvents(client, storage);

  return { configured: true, entities, events };
}
