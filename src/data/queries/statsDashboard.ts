import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { DayPlan, EnergyRecord, Event, Session, Settings, Task } from '../schema';
import type { IsoDate } from '../time';
import { aggregateAwarenessStats } from '../stats/awarenessStats';
import { makeStatsRange, type StatsRangeKind } from '../stats/dateRange';
import { aggregateSessionStats } from '../stats/sessionStats';

export interface LoadStatsDashboardInput {
  kind: StatsRangeKind;
  anchorAppDate: IsoDate;
}

/** Unified read-only stats query. All results remain rebuildable from retained facts. */
export async function loadStatsDashboard(input: LoadStatsDashboardInput) {
  const [tasks, sessions, events, energyRecords, dayPlans, settingsRecords] = await Promise.all([
    dataStore.getAll<Task>(STORE.tasks),
    dataStore.getAll<Session>(STORE.sessions),
    dataStore.getAll<Event>(EVENT_STORE),
    dataStore.getAll<EnergyRecord>(STORE.energyRecords),
    dataStore.getAll<DayPlan>(STORE.dayPlans),
    dataStore.getAll<Settings>(STORE.settings),
  ]);
  if (settingsRecords.length !== 1) {
    throw new Error(`统计查询要求恰好一条有效 Settings，当前为 ${settingsRecords.length} 条`);
  }
  const settings = settingsRecords[0]!;
  const range = makeStatsRange(input.kind, input.anchorAppDate);
  return {
    session: aggregateSessionStats({ sessions, events, settings, range }),
    ...aggregateAwarenessStats({
      tasks,
      sessions,
      events,
      energyRecords,
      dayPlans,
      settings,
      range,
    }),
  };
}
