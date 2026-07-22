import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { Event, Session, Settings } from '../schema';
import type { IsoDate } from '../time';
import { makeStatsRange, type StatsRangeKind } from '../stats/dateRange';
import { aggregateSessionStats, type SessionStats } from '../stats/sessionStats';

export interface LoadSessionStatsInput {
  kind: StatsRangeKind;
  anchorAppDate: IsoDate;
}

/** Read-only persisted query. It never initializes, caches, or writes statistics. */
export async function loadSessionStats(input: LoadSessionStatsInput): Promise<SessionStats> {
  const [sessions, events, settingsRecords] = await Promise.all([
    dataStore.getAll<Session>(STORE.sessions),
    dataStore.getAll<Event>(EVENT_STORE),
    dataStore.getAll<Settings>(STORE.settings),
  ]);
  if (settingsRecords.length !== 1) {
    throw new Error(`统计查询要求恰好一条有效 Settings，当前为 ${settingsRecords.length} 条`);
  }
  return aggregateSessionStats({
    sessions,
    events,
    settings: settingsRecords[0]!,
    range: makeStatsRange(input.kind, input.anchorAppDate),
  });
}
