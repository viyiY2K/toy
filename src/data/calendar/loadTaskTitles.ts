import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { Event, Task } from '../schema';
import type { CalendarInterruptCounts } from './mapSessionToCalendarEvents';
import { ZERO_INTERRUPT_COUNTS } from './mapSessionToCalendarEvents';

export async function loadTaskTitles(
  taskIds: readonly string[],
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  for (const taskId of taskIds) {
    const task = await dataStore.getIncludingDeleted<Task>(STORE.tasks, taskId);
    if (task?.title) titles[taskId] = task.title;
  }
  return titles;
}

export async function loadSessionInterruptCounts(
  sessionId: string,
): Promise<CalendarInterruptCounts> {
  const events = await dataStore.getAll<Event>(EVENT_STORE);
  let internal = 0;
  let external = 0;
  for (const event of events) {
    if (event.sessionId !== sessionId) continue;
    if (event.type === 'interrupt.internal') internal += 1;
    if (event.type === 'interrupt.external') external += 1;
  }
  if (internal === 0 && external === 0) return ZERO_INTERRUPT_COUNTS;
  return { internal, external };
}
