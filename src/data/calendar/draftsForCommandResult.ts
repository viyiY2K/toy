import { collectSessionsFromCommandResult } from './collectSessionsFromCommandResult';
import { loadSessionInterruptCounts, loadTaskTitles } from './loadTaskTitles';
import {
  mapSessionToCalendarEvents,
  type CalendarEventDraft,
} from './mapSessionToCalendarEvents';

export async function calendarDraftsFromCommandResult(
  result: unknown,
): Promise<CalendarEventDraft[]> {
  const sessions = collectSessionsFromCommandResult(result);
  const drafts: CalendarEventDraft[] = [];
  for (const session of sessions) {
    const taskIds = session.taskSegments.length > 0
      ? session.taskSegments.map((segment) => segment.taskId)
      : session.taskIds;
    const [titles, interrupts] = await Promise.all([
      loadTaskTitles(taskIds),
      loadSessionInterruptCounts(session.id),
    ]);
    drafts.push(...mapSessionToCalendarEvents(session, titles, interrupts));
  }
  return drafts;
}
