import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { EnergyRecord, Event, Session, Task } from '../schema';
import { deriveAppDate } from '../time';
import type { InitializationClock } from '../initialization/currentAppDate';
import { loadCurrentTaskViews, type CurrentTaskViews } from './currentTaskViews';
import { loadCurrentRecoveryView, type CurrentRecoveryView } from './currentRecoveryView';

export type StandaloneEnergyPromptSource = 'dayStart' | 'beforeFocus';

export interface CurrentTimerViews {
  taskViews: CurrentTaskViews;
  activeSession: Session | null;
  activeTask: Task | null;
  pendingBreakFocus: Session | null;
  pendingBreakTask: Task | null;
  preFocusEnergySource: StandaloneEnergyPromptSource | null;
  completedFocusCount: number;
  interruptCounts: { internal: number; external: number };
  pendingRecovery: CurrentRecoveryView | null;
}

function compareCompleted(left: Session, right: Session): number {
  return Date.parse(left.endedAt ?? left.startedAt) - Date.parse(right.endedAt ?? right.startedAt)
    || left.id.localeCompare(right.id);
}

function referencedTaskId(session: Session | null, sessionById: Map<string, Session>): string | null {
  if (!session) return null;
  if (session.type === 'focus') return session.taskId;
  if (session.sourceFocusSessionId) {
    return sessionById.get(session.sourceFocusSessionId)?.taskId ?? null;
  }
  return null;
}

/**
 * S13c timer/awareness read model. All membership and facts come from v4 entities/Events;
 * no UI state or legacy aggregate is promoted to truth.
 */
export async function loadCurrentTimerViews(clock: InitializationClock): Promise<CurrentTimerViews> {
  const [taskViews, pendingRecovery] = await Promise.all([
    loadCurrentTaskViews(clock),
    loadCurrentRecoveryView(),
  ]);
  const [sessions, historicalSessions, tasks, energyRecords, events] = await Promise.all([
    dataStore.getAll<Session>(STORE.sessions),
    dataStore.getAllIncludingDeleted<Session>(STORE.sessions),
    dataStore.getAllIncludingDeleted<Task>(STORE.tasks),
    dataStore.getAll<EnergyRecord>(STORE.energyRecords),
    dataStore.getAll<Event>(EVENT_STORE),
  ]);

  const activeSessions = sessions.filter((session) => session.status === 'active');
  if (activeSessions.length > 1) throw new Error('检测到多个 active Session，无法构造计时视图');
  const activeSession = activeSessions[0] ?? null;

  const breakSourceIds = new Set(
    historicalSessions
      .filter((session) => session.type === 'shortBreak' || session.type === 'longBreak')
      .map((session) => session.sourceFocusSessionId),
  );
  const workEndedFocusIds = new Set(
    events.flatMap((event) =>
      event.type === 'dayPlan.workEnded' && event.payload.endedAfterFocusSessionId !== null
        ? [event.payload.endedAfterFocusSessionId]
        : [],
    ),
  );
  const pendingBreakFocus = sessions
    .filter(
      (session) =>
        session.type === 'focus'
        && session.status === 'completed'
        && !breakSourceIds.has(session.id)
        && !workEndedFocusIds.has(session.id),
    )
    .sort(compareCompleted)[0] ?? null;

  const sessionById = new Map(historicalSessions.map((session) => [session.id, session]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const activeTaskId = referencedTaskId(activeSession, sessionById);
  const pendingBreakTaskId = referencedTaskId(pendingBreakFocus, sessionById);

  const currentDayEnergy = energyRecords
    .filter(
      (record) =>
        deriveAppDate(
          record.occurredAt,
          record.timezone,
          taskViews.settings.appDayStartOffsetMinutes,
        ) === taskViews.appDate,
    )
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const latestEnergy = currentDayEnergy.at(-1);
  const preFocusEnergySource: StandaloneEnergyPromptSource | null = !latestEnergy
    ? 'dayStart'
    : Date.parse(clock.now) - Date.parse(latestEnergy.occurredAt)
        > taskViews.settings.longBreakMinutes * 60 * 1000
      ? 'beforeFocus'
      : null;

  const interruptCounts = { internal: 0, external: 0 };
  if (activeSession?.type === 'focus') {
    for (const event of events) {
      if (event.sessionId !== activeSession.id) continue;
      if (event.type === 'interrupt.internal') interruptCounts.internal += 1;
      if (event.type === 'interrupt.external') interruptCounts.external += 1;
    }
  }

  return {
    taskViews,
    activeSession,
    activeTask: activeTaskId === null ? null : taskById.get(activeTaskId) ?? null,
    pendingBreakFocus,
    pendingBreakTask: pendingBreakTaskId === null ? null : taskById.get(pendingBreakTaskId) ?? null,
    preFocusEnergySource,
    completedFocusCount: sessions.filter(
      (session) => session.type === 'focus' && session.status === 'completed',
    ).length,
    interruptCounts,
    pendingRecovery,
  };
}
