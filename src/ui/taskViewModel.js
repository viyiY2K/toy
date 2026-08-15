export function splitTodayTasks(tasks) {
  return {
    activeTasks: tasks.filter((task) => task.status === 'active' || task.status === 'splitNeeded'),
    completedTasks: tasks.filter((task) => task.status === 'completed'),
  };
}

export function dayPlanIndexOf(tasks, taskId) {
  return tasks.findIndex((task) => task.id === taskId);
}

/**
 * 把「拖拽悬停在目标行的上/下半」换算成 splice 语义下最终的插入下标。
 * 目标始终是「落到目标行的前面（或后面）」，而不是和目标行互换位置。
 */
export function dropInsertIndex(fromIndex, targetIndex, position = 'before') {
  const anchor = position === 'after' ? targetIndex + 1 : targetIndex;
  return fromIndex < anchor ? anchor - 1 : anchor;
}

export function activityReorderPayload(drag, targetIndex, position = 'before') {
  if (
    drag?.from !== 'list' ||
    typeof drag.taskId !== 'string' ||
    !Number.isInteger(drag.index) ||
    !Number.isInteger(targetIndex) ||
    drag.index < 0 ||
    targetIndex < 0
  ) {
    return null;
  }
  const toIndex = dropInsertIndex(drag.index, targetIndex, position);
  if (toIndex === drag.index) return null;
  return { fromIndex: drag.index, toIndex };
}

export function completionSourceLabel(completionSource) {
  if (completionSource === 'manual') return '手动完成';
  if (completionSource === 'pomodoro') return '番茄完成';
  return '完成来源未知';
}

// 只用于展示：按事实记录自带的 timezone 取墙钟时刻，不用当前设备时区重算历史记录。
function wallClockLabel(isoInstant, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(isoInstant));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return { date: `${get('year')}.${get('month')}.${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

// 番茄完成优先展示那次专注的起止时间段；手动完成没有关联专注，退回展示完成时刻。
export function completedTaskTimeLabel(task, timing) {
  if (!timing) return '';
  if (timing.focusStartedAt && timing.focusEndedAt) {
    const start = wallClockLabel(timing.focusStartedAt, timing.timezone);
    const end = wallClockLabel(timing.focusEndedAt, timing.timezone);
    return `${start.date} ${start.time}~${end.time}`;
  }
  if (!task.completedAt) return '';
  const instant = wallClockLabel(task.completedAt, timing.timezone);
  return `${instant.date} ${instant.time}`;
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

/** 任务正在进行标准 focus 时，清单页不能完成或改预估，需等本轮专注结束。 */
export function isTaskRunningFocus(task, runningFocusTaskId) {
  return runningFocusTaskId !== null && task.id === runningFocusTaskId;
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

/**
 * 合并资格（v4.1 §3.8 关键规则 9）：只有从未有过任何 focus 记录的 active 任务
 * 才能被合并，且不能已经在别的组里。有过一条 focus 记录就**永久**失去资格。
 * 返回 null 表示可以合并，返回字符串是给用户看的拒绝理由（拖拽防呆用）。
 */
export function mergeIneligibleReason(task, views) {
  if (!task) return '任务不存在';
  if (task.status !== 'active') return '只有进行中的任务可以合并';
  if (task.mergeGroupId !== null) return '这个任务已经在另一个合并组里';
  if (views.hasFocusHistoryByTaskId?.[task.id]) return '这个任务已经计时过，不能再并进合并番茄';
  return null;
}

/**
 * 拖拽落点意图：拖到某行的**正中间**是合并，落在上/下缘是排序。
 * 中间带占行高的中段（默认 40%），两侧各留 30% 给排序，避免误触。
 */
export function dropIntent(offsetY, height, mergeBandRatio = 0.4) {
  if (!(height > 0)) return 'before';
  const ratio = offsetY / height;
  const edge = (1 - mergeBandRatio) / 2;
  if (ratio < edge) return 'before';
  if (ratio > 1 - edge) return 'after';
  return 'merge';
}

/**
 * 把一列任务折叠成渲染行：属于同一个合并组的成员收进一组父行+缩进成员，
 * 组落在该组**第一个成员**原本的位置，其余成员不再单独出行。
 *
 * 父行是 MergeGroup.title，成员是平等的小事，不是子任务血缘。
 */
export function foldMergeRows(tasks, views) {
  const rows = [];
  const emitted = new Set();
  for (const task of tasks) {
    const groupId = task.mergeGroupId;
    if (groupId === null || groupId === undefined) {
      rows.push({ kind: 'task', key: task.id, task });
      continue;
    }
    if (emitted.has(groupId)) continue;
    const group = views.mergeGroups?.find((candidate) => candidate.id === groupId);
    if (!group) {
      // 组已解散但视图还没刷新到：按独立任务渲染，不吞掉这一行。
      rows.push({ kind: 'task', key: task.id, task });
      continue;
    }
    emitted.add(groupId);
    rows.push({
      kind: 'merge',
      key: groupId,
      group,
      members: views.mergeGroupMembersById?.[groupId] ?? [],
      remaining: views.mergeGroupRemainingById?.[groupId] ?? 0,
    });
  }
  return rows;
}

/** 合并组父行上的摘要：进度、预估、是否被硬上限卡住。 */
export function mergeCardSummary(group, members, remaining) {
  const done = members.filter((task) => task.status === 'completed').length;
  return {
    memberLabel: `${members.length} 件小事`,
    progressLabel: `${done} / ${members.length} 已完成`,
    estimateLabel: `整组 ${group.estimatedPomodoros} 个番茄`,
    remainingLabel: remaining > 0 ? `还剩 ${remaining} 个` : '预估已用满',
    blocked: group.status === 'limitReached',
  };
}

export function unfinishedMergeMembers(members) {
  return members.filter((task) => task.status === 'active' || task.status === 'splitNeeded');
}

/** 组内当前该做的成员：按组内顺序第一个尚未完成的。 */
export function currentMergeMember(members) {
  return unfinishedMergeMembers(members)[0] ?? null;
}

/** 开新一轮合并 focus 的门槛：组仍 active，且未完成成员 ≥ 2。 */
export function canStartMergeGroup(group, members) {
  return group?.status === 'active' && unfinishedMergeMembers(members).length >= 2;
}

/**
 * 活动列表里已经把成员都勾完、因而 fold 不到的在用合并组。
 * 仍要露出来，否则用户没法确认整组完成或取消合并。
 */
export function completedOnlyMergeRows(rows, views) {
  const shown = new Set(rows.filter((row) => row.kind === 'merge').map((row) => row.key));
  return (views.mergeGroups ?? []).flatMap((group) => {
    if (shown.has(group.id)) return [];
    const members = views.mergeGroupMembersById?.[group.id] ?? [];
    if (members.length === 0 || members.some((task) => task.status !== 'completed')) return [];
    return [{
      kind: 'merge',
      key: group.id,
      group,
      members,
      remaining: views.mergeGroupRemainingById?.[group.id] ?? 0,
    }];
  });
}

export function isMergeGroupSessionActive(group, runningFocus) {
  return runningFocus?.mergeGroupId === group.id;
}

export function isMergeMemberLocked(task, runningFocus) {
  return isMergeGroupSessionActive({ id: task.mergeGroupId }, runningFocus)
    && runningFocus.taskId === task.id;
}
