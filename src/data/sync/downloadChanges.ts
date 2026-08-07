/**
 * 下载：远端变更 → 本地（S5，pull + last-write-wins by updatedAt）。
 *
 * 五个实体（不含 settings——它走字段级合并，见下方说明）按本地游标（各表各自的
 * `lastPulledAt`）增量拉取 `updated_at > cursor` 的远端行，逐条应用：本地不存在则
 * 直接写入，已存在则按 updatedAt 取较新一份，否则跳过（本地更新，留给下一轮上传推送）。
 *
 * 每条远端行各自一次独立的 executeAtomicWrite（而不是整批一个大事务）：校验失败
 * （比如极端情况下 DayPlan 引用的 Task 还没下载到本地）只影响这一条，不拖累同批
 * 其它行——红线要求的"失败整体回滚"在事务内部依然成立，只是把"批"缩小到
 * "单条记录"这个粒度，不把互不相关的多条远端行捆进同一个事务。
 * DayPlan 遇到 appDate 冲突时会额外多开一次独立的 'local' 模式原子写先清理本地
 * 输家记录，理由见 `resolveDayPlanAppDateCollisionIfAny` 的注释。
 *
 * 已知限制：游标按"这一批已抓取到的行"整体推进，不区分单行是否应用成功。
 * 一条持续失败的行（理论上只会发生在极端的乱序/引用缺失场景）不会被无限重试，
 * 除非它在远端又有新的 updatedAt。真实使用中，本模块把 tasks 排在 dayPlans 之前
 * 下载，同一轮内 DayPlan 引用的 Task 通常已经先落地，这个限制预期极少触发。
 *
 * Settings 不在本模块处理：不适用整表 last-write-wins，需要字段级合并，
 * 留给 S6 的 settingsMerge 模块。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { dataStore, STORE } from '../dataStore';
import type { SyncableEntityMap, SyncableStoreName } from '../dataStore';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import { EntityValidationError } from '../validation';
import type { DayPlan, Event, IsoDateTime } from '../schema';
import { getSupabaseClient } from './supabaseClient';
import { type DeviceIdentityStorage } from './deviceIdentity';
import {
  REMOTE_EVENTS_TABLE,
  REMOTE_TABLE_BY_STORE,
  fromRemoteEntityRow,
  fromRemoteEventRow,
  type RemoteRow,
} from './remoteRowMappers';

type DownloadableStoreName = Exclude<SyncableStoreName, 'settings'>;

/** S5 处理的实体 store：不含 settings（见文件头说明）。tasks 必须排在 dayPlans 之前。 */
const DOWNLOADABLE_STORE_NAMES: readonly DownloadableStoreName[] = [
  STORE.tasks,
  STORE.dayPlans,
  STORE.sessions,
  STORE.energyRecords,
  STORE.unresolvedIntervals,
];

const EVENT_DOWNLOAD_OVERLAP_MS = 60_000;

function entityCursorKey(store: SyncableStoreName): string {
  return `pomodoro:sync:lastPulledAt:${store}`;
}
const EVENT_DOWNLOAD_CURSOR_KEY = 'pomodoro:sync:lastDownloadedEventCreatedAt';

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export interface DownloadEntityResult {
  store: SyncableStoreName;
  fetched: number;
  applied: number;
  skipped: number;
  failed: number;
  error?: string;
}

export interface DownloadEventsResult {
  fetched: number;
  applied: number;
  error?: string;
}

export interface DownloadChangesResult {
  configured: boolean;
  entities: readonly DownloadEntityResult[];
  events: DownloadEventsResult;
}

type ApplyOutcome = 'applied' | 'skipped' | 'failed';

/**
 * 应用一条远端 DayPlan 行前的 appDate 唯一性预处理。只在"本地完全没见过这个 id"时才需要
 * 考虑——已经同步过的同 id DayPlan 走普通 LWW 即可（appDate 创建后不可变，不会出现同 id
 * 不同 appDate 的情况）。
 *
 * 独立成一次单独的 'local' 模式原子写（而不是塞进后面那次 'sync' 模式写入的同一个事务）：
 * 本地这条"输家" DayPlan 从未同步过（deviceId/syncedAt 是 null/null），软删它只是清理本地
 * 遗留数据，不是"这条记录本身被同步了"，理应保持 null/null 配对——用 'sync' 模式的事务顺带
 * 处理会强制要求 deviceId/syncedAt 非空，反而校验不过。
 *
 * 返回 'skip' 表示这一轮跳过这条远端行、保留本地版本；'proceed' 表示可以继续正常 LWW 流程。
 * 读一致性说明：本地"是否存在同 appDate 记录"的判断和随后的软删是两次独立的异步操作，
 * 中间理论上存在极小的竞态窗口（比如恰好这一刻用户又在改本地 DayPlan）；这是首次同步这种
 * 冷启动冲突场景里可接受的已知限制，不在本次范围内做更复杂的加锁处理。
 */
async function resolveDayPlanAppDateCollisionIfAny(
  remote: DayPlan,
  now: IsoDateTime,
  timezone: string,
): Promise<'proceed' | 'skip'> {
  const localSameAppDate = (await dataStore.getAll<DayPlan>(STORE.dayPlans)).find(
    (dayPlan) => dayPlan.appDate === remote.appDate,
  );
  if (!localSameAppDate || localSameAppDate.id === remote.id) return 'proceed';

  if (Date.parse(remote.updatedAt) <= Date.parse(localSameAppDate.updatedAt)) {
    // 本地这条更新：保留本地，跳过远端这条。远端那条会在本机之外持续存在，是已知的、
    // 留待后续需要时再处理的边界情形（见文件头说明）。
    return 'skip';
  }

  await executeAtomicWrite({ storeNames: [STORE.dayPlans], now, timezone }, async (transaction) => {
    await transaction.softDelete(STORE.dayPlans, localSameAppDate.id, now);
  });
  return 'proceed';
}

async function applyRemoteEntityRow<S extends DownloadableStoreName>(
  store: S,
  row: RemoteRow,
  now: IsoDateTime,
  timezone: string,
): Promise<ApplyOutcome> {
  const remote = fromRemoteEntityRow(store, row, now);
  try {
    if (store === STORE.dayPlans) {
      const collision = await resolveDayPlanAppDateCollisionIfAny(remote as unknown as DayPlan, now, timezone);
      if (collision === 'skip') return 'skipped';
    }

    return await executeAtomicWrite(
      { storeNames: [store], now, timezone, writeMode: 'sync' },
      async (transaction) => {
        const existing = await transaction.getIncludingDeleted<SyncableEntityMap[S]>(store, remote.id);
        if (!existing) {
          await transaction.put(store, remote);
          return 'applied';
        }
        if (Date.parse(remote.updatedAt) > Date.parse(existing.updatedAt)) {
          await transaction.put(store, remote);
          return 'applied';
        }
        return 'skipped';
      },
    );
  } catch (error) {
    if (error instanceof EntityValidationError) return 'failed';
    throw error;
  }
}

async function downloadEntityStore<S extends DownloadableStoreName>(
  client: SupabaseClient,
  store: S,
  now: IsoDateTime,
  timezone: string,
  storage: DeviceIdentityStorage | undefined,
): Promise<DownloadEntityResult> {
  const table = REMOTE_TABLE_BY_STORE[store];
  const cursor = storage?.getItem(entityCursorKey(store)) ?? null;
  let query = client.from(table).select('*').order('updated_at', { ascending: true });
  if (cursor !== null) query = query.gt('updated_at', cursor);
  const { data, error } = await query;

  if (error) return { store, fetched: 0, applied: 0, skipped: 0, failed: 0, error: error.message };
  const rows = (data ?? []) as RemoteRow[];
  if (rows.length === 0) return { store, fetched: 0, applied: 0, skipped: 0, failed: 0 };

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = await applyRemoteEntityRow(store, row, now, timezone);
    if (outcome === 'applied') applied += 1;
    else if (outcome === 'skipped') skipped += 1;
    else failed += 1;
  }

  const maxUpdatedAt = rows.reduce<string>((max, row) => {
    const value = row.updated_at as string;
    return value > max ? value : max;
  }, cursor ?? '');
  if (storage && maxUpdatedAt) storage.setItem(entityCursorKey(store), maxUpdatedAt);

  return { store, fetched: rows.length, applied, skipped, failed };
}

async function downloadEvents(
  client: SupabaseClient,
  now: IsoDateTime,
  timezone: string,
  storage: DeviceIdentityStorage | undefined,
): Promise<DownloadEventsResult> {
  const cursor = storage?.getItem(EVENT_DOWNLOAD_CURSOR_KEY) ?? null;
  // 各设备的 createdAt 来自各自本地时钟，存在轻微时钟偏差风险；用一个小的重叠窗口
  // 回退查询下限，靠"本地已存在同 id 则跳过"的去重兜底，而不是要求时钟严格一致。
  const queryFrom = cursor === null ? null : new Date(Date.parse(cursor) - EVENT_DOWNLOAD_OVERLAP_MS).toISOString();

  let query = client.from(REMOTE_EVENTS_TABLE).select('*').order('created_at', { ascending: true });
  if (queryFrom !== null) query = query.gt('created_at', queryFrom);
  const { data, error } = await query;

  if (error) return { fetched: 0, applied: 0, error: error.message };
  const rows = (data ?? []) as RemoteRow[];
  if (rows.length === 0) return { fetched: 0, applied: 0 };

  let applied = 0;
  for (const row of rows) {
    const remote = fromRemoteEventRow(row);
    await executeAtomicWrite({ storeNames: [STORE.events], now, timezone, writeMode: 'sync' }, async (transaction) => {
      const existing = await transaction.get<Event>(STORE.events, remote.id);
      if (existing) return;
      await transaction.appendEvent(remote);
      applied += 1;
    });
  }

  const maxCreatedAt = rows.reduce<string>((max, row) => {
    const value = row.created_at as string;
    return value > max ? value : max;
  }, cursor ?? '');
  if (storage && maxCreatedAt) storage.setItem(EVENT_DOWNLOAD_CURSOR_KEY, maxCreatedAt);

  return { fetched: rows.length, applied };
}

export interface DownloadChangesOptions {
  storage?: DeviceIdentityStorage;
}

export async function downloadChanges(
  now: IsoDateTime,
  timezone: string,
  options: DownloadChangesOptions = {},
): Promise<DownloadChangesResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { configured: false, entities: [], events: { fetched: 0, applied: 0 } };
  }

  const storage = options.storage ?? defaultStorage();

  const entities: DownloadEntityResult[] = [];
  for (const store of DOWNLOADABLE_STORE_NAMES) {
    entities.push(await downloadEntityStore(client, store, now, timezone, storage));
  }
  const events = await downloadEvents(client, now, timezone, storage);

  return { configured: true, entities, events };
}
