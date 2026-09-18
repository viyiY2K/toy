import { dataStore, STORE } from '../dataStore';
import type { Task } from '../schema';

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
