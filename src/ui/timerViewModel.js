export function elapsedSeconds(session, nowMs) {
  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

export function remainingSeconds(session, nowMs) {
  return Math.max(0, (session.plannedDuration ?? 0) - elapsedSeconds(session, nowMs));
}

export function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function timerDisplayTask(activeSession, activeTask, selectedTask) {
  return activeSession === null ? selectedTask : activeTask;
}

/**
 * 计时页那张「这次专注涉及哪几件事」的卡片内容。
 *
 * 产品结论：计时页**不再展示任何任务的子母层级关系**。这张卡片只在合并场景出现——
 * 有合并时列出合并组成员，`Session.taskIds` 长度为 1（普通单任务专注）时返回空数组，
 * 整张卡片不展示。
 *
 * 组内成员完全平等、互相独立：合并只表示"这几件事各自都占不满一个番茄"，
 * 不表示它们属于同一件事，因此这里不做任何按上层归属的分组或排序。
 */
export function timerMergeMembers(sessionTasks) {
  return sessionTasks.length > 1 ? sessionTasks : [];
}

/**
 * 合并番茄到点后给用户哪几个选项（§3.8 关键规则 4/6）。
 *
 * 组内全部做完时返回 null——没有需要决定的事，不打扰用户。
 * 还有没做完的成员时：
 * - 常态：「结束」+「追加预估番茄」二选一；
 * - 三轮用满 / 预估已达 7 个 / 组已被判定 limitReached：**强阻断**，
 *   不再给「追加预估」，只能「结束」或「取消整次合并」（关掉提示不解除阻塞）。
 */
export function mergeRoundChoiceOptions(group, members) {
  const unfinishedCount = members.filter((task) => task.status !== 'completed').length;
  if (unfinishedCount === 0) return null;
  const blocked = group.status === 'limitReached';
  return {
    unfinishedCount,
    blocked,
    canExtend: !blocked && group.estimateRounds.length < 3 && group.estimatedPomodoros < 7,
    canDissolve: blocked,
  };
}

export function shouldOfferTaskCompletionCheck(taskViews, task) {
  if (
    task === null
    || (task.status !== 'active' && task.status !== 'splitNeeded')
  ) return false;
  const completedFocusCount = taskViews.completedValidFocusCountByTaskId[task.id] ?? 0;
  return completedFocusCount >= task.estimatedPomodoros;
}

export function nextStandardBreakType(completedFocusCount, longBreakEvery) {
  return completedFocusCount > 0 && completedFocusCount % longBreakEvery === 0
    ? 'longBreak'
    : 'shortBreak';
}

export function enabledRestSuggestions(settings, breakType) {
  return settings.restSuggestions
    .filter((item) => item.isEnabled && item.appliesTo.includes(breakType))
    .sort((left, right) => left.sortIndex - right.sortIndex || left.key.localeCompare(right.key));
}

export function recoveryTaskChoices(taskViews) {
  const byId = new Map();
  for (const task of [...taskViews.todayTasks, ...taskViews.activeTasks]) {
    if (task.status === 'active' || task.status === 'splitNeeded') byId.set(task.id, task);
  }
  return [...byId.values()];
}

export function recoveryRestChoices(settings, sourceSessionType) {
  return settings.restSuggestions
    .filter(
      (item) => item.isEnabled && (
        sourceSessionType === 'focus' || item.appliesTo.includes(sourceSessionType)
      ),
    )
    .sort((left, right) => left.sortIndex - right.sortIndex || left.key.localeCompare(right.key));
}

export function energySourceForCompletedSession(sessionType) {
  if (sessionType === 'focus') return 'afterFocus';
  if (sessionType === 'shortBreak') return 'afterShortBreak';
  if (sessionType === 'longBreak') return 'afterLongBreak';
  return null;
}

export function shouldPromptOnReturn(hiddenAtMs, visibleAtMs, longBreakMinutes) {
  return hiddenAtMs !== null
    && visibleAtMs - hiddenAtMs >= longBreakMinutes * 60 * 1000;
}

export function canWriteStandardSession(activeSession, runtimeSessionIds) {
  return activeSession !== null && runtimeSessionIds.has(activeSession.id);
}

export function isRecoveryRequiredSession(activeSession, pendingRecovery, runtimeSessionIds) {
  return pendingRecovery !== null
    || (activeSession !== null && !canWriteStandardSession(activeSession, runtimeSessionIds));
}

export function canUsePendingBreakExits(activeSession, pendingBreakFocus, pendingRecovery) {
  return activeSession === null
    && pendingBreakFocus?.type === 'focus'
    && pendingBreakFocus.status === 'completed'
    && pendingRecovery === null;
}

export function canUseActiveBreakExit(activeSession, pendingRecovery, runtimeSessionIds) {
  return pendingRecovery === null
    && activeSession !== null
    && (activeSession.type === 'shortBreak' || activeSession.type === 'longBreak')
    && activeSession.status === 'active'
    && canWriteStandardSession(activeSession, runtimeSessionIds);
}

export function canCaptureTriage(activeSession, pendingRecovery, runtimeSessionIds) {
  return pendingRecovery === null
    && activeSession?.type === 'focus'
    && activeSession.status === 'active'
    && canWriteStandardSession(activeSession, runtimeSessionIds);
}

export function shouldDetectAppReopened(activeSession, pendingRecovery, runtimeSessionIds) {
  return activeSession !== null
    && pendingRecovery === null
    && !runtimeSessionIds.has(activeSession.id);
}

export function pageForTimerSnapshot(currentPage, pendingRecovery) {
  return pendingRecovery === null ? currentPage : 'timer';
}

export function shouldRecoverAfterHidden(
  activeSession,
  pendingRecovery,
  runtimeSessionIds,
  hiddenAtMs,
  visibleAtMs,
) {
  if (
    activeSession === null
    || pendingRecovery !== null
    || !runtimeSessionIds.has(activeSession.id)
    || hiddenAtMs === null
    || !Number.isFinite(visibleAtMs)
  ) return false;
  const startedAtMs = Date.parse(activeSession.startedAt);
  const plannedDuration = activeSession.plannedDuration;
  if (!Number.isFinite(startedAtMs) || !Number.isInteger(plannedDuration) || plannedDuration <= 0) {
    return false;
  }
  const plannedEndMs = startedAtMs + plannedDuration * 1000;
  return hiddenAtMs < plannedEndMs && visibleAtMs >= plannedEndMs;
}
