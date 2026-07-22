export function splitTodayTasks(tasks) {
  return {
    activeTasks: tasks.filter((task) => task.status === 'active' || task.status === 'splitNeeded'),
    completedTasks: tasks.filter((task) => task.status === 'completed'),
  };
}

export function dayPlanIndexOf(tasks, taskId) {
  return tasks.findIndex((task) => task.id === taskId);
}

export function activityReorderPayload(drag, toIndex) {
  if (
    drag?.from !== 'list' ||
    typeof drag.taskId !== 'string' ||
    !Number.isInteger(drag.index) ||
    !Number.isInteger(toIndex) ||
    drag.index < 0 ||
    toIndex < 0 ||
    drag.index === toIndex
  ) {
    return null;
  }
  return { fromIndex: drag.index, toIndex };
}

export function completionSourceLabel(completionSource) {
  if (completionSource === 'manual') return '手动完成';
  if (completionSource === 'pomodoro') return '番茄完成';
  return '完成来源未知';
}

export function currentPlanMetrics(dayPlan, todayPlanningCapacityRemaining) {
  return {
    freeHours: dayPlan.estimate.freeMin / 60,
    budgetPomodoros: dayPlan.budgetPomodoros,
    remainingPomodoros: todayPlanningCapacityRemaining,
    overloadedPomodoros: Math.max(0, -todayPlanningCapacityRemaining),
  };
}

export function availableParentTasks(views, selectedTaskId) {
  const seen = new Set();
  return [...views.activeTasks, ...views.todayTasks].filter((candidate) => {
    if (
      candidate.id === selectedTaskId
      || candidate.parentId !== null
      || (candidate.status !== 'active' && candidate.status !== 'splitNeeded')
      || seen.has(candidate.id)
    ) {
      return false;
    }
    seen.add(candidate.id);
    return true;
  });
}

export function unattachedSubtasks(views) {
  const visibleParentIds = new Set([
    ...views.activeTasks,
    ...views.todayTasks,
    ...views.completedTasks,
  ].filter((task) => task.parentId === null).map(({ id }) => id));
  const seen = new Set();
  return Object.values(views.subtasksByParentId)
    .flat()
    .filter((task) => {
      if (visibleParentIds.has(task.parentId) || seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort((left, right) =>
      left.parentId.localeCompare(right.parentId)
      || left.sortIndex - right.sortIndex
      || left.id.localeCompare(right.id));
}

export function archivedTaskPresentation(task) {
  return {
    outcomeLabel: task.outcome === 'split' ? '拆分归档' : '完成归档',
    completionLabel: task.completionSource ? completionSourceLabel(task.completionSource) : null,
    lineageLabel: task.splitIndex > 0 ? `拆分 #${task.splitIndex}` : null,
    archivedAt: task.archivedAt,
  };
}

export function canAdjustTaskEstimate(task) {
  return (task.status === 'active' || task.status === 'splitNeeded')
    && task.estimateRounds.length < 3;
}

export function canReorderSubtasks(views, parentId) {
  return [...views.activeTasks, ...views.todayTasks, ...views.completedTasks]
    .some((task) => task.id === parentId && task.parentId === null);
}

export function hasRetainedChildren(views, taskId) {
  return (views.subtasksByParentId[taskId] ?? []).length > 0
    || views.archivedTasks.some((task) => task.parentId === taskId);
}

export function batchCandidates(views, action) {
  if (action === 'addToToday') return views.activeTasks;
  if (action === 'moveToList') return splitTodayTasks(views.todayTasks).activeTasks;
  if (action === 'archiveCompleted') {
    const seen = new Set();
    return [
      ...views.completedTasks,
      ...Object.keys(views.subtasksByParentId ?? {})
        .sort()
        .flatMap((parentId) => views.subtasksByParentId[parentId])
        .filter((task) => task.status === 'completed'),
    ].filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
  }
  return [];
}

export function splitDraftValid(title, estimate) {
  const value = Number(estimate);
  return title.trim().length > 0
    && Number.isInteger(value)
    && value >= 1
    && value <= 7;
}

export function batchRetryIds(result) {
  return [...result.failed.map(({ taskId }) => taskId), ...result.notAttempted];
}

export function reconcileBatchSelection(selectedIds, candidates) {
  const candidateIds = new Set(candidates.map(({ id }) => id));
  return selectedIds.filter((taskId) => candidateIds.has(taskId));
}

export function batchResultPresentation(result, tasks) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const titleOf = (taskId) => taskById.get(taskId)?.title ?? `${taskId.slice(0, 8)}…`;
  return {
    failed: result.failed.map(({ taskId, message }) => ({
      taskId,
      title: titleOf(taskId),
      message,
    })),
    notAttempted: result.notAttempted.map((taskId) => ({ taskId, title: titleOf(taskId) })),
  };
}

export function splitLineagePresentation(task, tasks) {
  if (task.outcome === 'split') {
    const successor = tasks
      .filter((candidate) => candidate.splitFromTaskId === task.id)
      .sort((left, right) => left.splitIndex - right.splitIndex || left.id.localeCompare(right.id))[0];
    return successor ? {
      relation: 'source',
      task: successor,
      label: `后继：${successor.title} · 拆分 #${successor.splitIndex} · ${successor.id.slice(0, 8)}…`,
    } : null;
  }
  if (task.splitFromTaskId) {
    const source = tasks.find((candidate) => candidate.id === task.splitFromTaskId);
    return source ? {
      relation: 'successor',
      task: source,
      label: `源自：${source.title} · ${source.id.slice(0, 8)}…`,
    } : null;
  }
  return null;
}
