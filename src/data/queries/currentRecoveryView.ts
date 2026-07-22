import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { Event, Session, Task, UnresolvedInterval } from '../schema';

export interface CurrentRecoveryView {
  interval: UnresolvedInterval;
  detectionEvent: Event<'interval.detected'>;
  sourceSession: Session;
  sourceTask: Task | null;
  envelopeDurationSeconds: number;
}

export async function loadCurrentRecoveryView(): Promise<CurrentRecoveryView | null> {
  const [intervals, events, sessions, tasks] = await Promise.all([
    dataStore.getAll<UnresolvedInterval>(STORE.unresolvedIntervals),
    dataStore.getAll<Event>(EVENT_STORE),
    dataStore.getAllIncludingDeleted<Session>(STORE.sessions),
    dataStore.getAllIncludingDeleted<Task>(STORE.tasks),
  ]);
  const pending = intervals.filter(({ status }) => status === 'pending');
  if (pending.length === 0) return null;
  if (pending.length > 1) throw new Error('当前存在多个 pending UnresolvedInterval');
  const interval = pending[0]!;
  const detections = events.filter(
    (event): event is Event<'interval.detected'> =>
      event.type === 'interval.detected' && event.unresolvedIntervalId === interval.id,
  );
  if (detections.length !== 1 || detections[0]!.sessionId === null) {
    throw new Error('pending interval 缺少唯一的原 Session 检测关联');
  }
  const detectionEvent = detections[0]!;
  const sourceSessionId = detectionEvent.sessionId;
  if (sourceSessionId === null) throw new Error('pending interval 未关联原 Session');
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const sourceSession = sessionById.get(sourceSessionId);
  if (!sourceSession || !isActiveStandard(sourceSession)) {
    throw new Error('pending interval 的原 Session 不再是 active 标准 Session');
  }
  const sourceTaskId = sourceSession.type === 'focus'
    ? sourceSession.taskId
    : sourceSession.sourceFocusSessionId === null
      ? null
      : sessionById.get(sourceSession.sourceFocusSessionId)?.taskId ?? null;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return {
    interval,
    detectionEvent,
    sourceSession,
    sourceTask: sourceTaskId === null ? null : taskById.get(sourceTaskId) ?? null,
    envelopeDurationSeconds: Math.floor(
      (Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 1000,
    ),
  };
}

function isActiveStandard(session: Session): boolean {
  return session.status === 'active'
    && (session.type === 'focus' || session.type === 'shortBreak' || session.type === 'longBreak');
}
