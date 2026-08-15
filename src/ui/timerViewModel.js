import { mergeIneligibleReason } from './taskViewModel';

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
 * 合并专注进行中，还可以拉进未来队列的任务。
 * 资格与清单拖拽相同：从未计时、未在别的组、仍是 active。
 * 今日待办排在前面，活动清单随后，去重。
 */
export function timerAddableMergeMembers(taskViews, mergeGroup) {
  if (!mergeGroup || (mergeGroup.status !== 'active' && mergeGroup.status !== 'limitReached')) {
    return [];
  }
  const seen = new Set();
  const pool = [...(taskViews.todayTasks ?? []), ...(taskViews.activeTasks ?? [])];
  return pool.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return mergeIneligibleReason(task, taskViews) === null;
  });
}

/**
 * 计时页合并组成员。有合并组时始终列出（已开跑后允许缩到 1 个成员），
 * 普通单任务专注返回空数组，不展示这棵树。
 */
export function timerMergeMembers(sessionTasks, mergeGroup = null) {
  if (mergeGroup) return sessionTasks;
  return sessionTasks.length > 1 ? sessionTasks : [];
}

/**
 * 合并番茄到点后的收尾选项（§3.8 关键规则 4/6、红线 29）。
 *
 * - 全部做完：确认整组完成。
 * - 还剩 ≥ 2 件没做完：结束 / 追加预估 / 确认整组完成。
 * - 只剩 1 件：不能再开下一轮，只能结束或确认整组完成。
 * - 硬上限：不再追加，结束 / 取消合并 / 确认整组完成。
 */
export function mergeRoundChoiceOptions(group, members) {
  const unfinishedCount = members.filter((task) => task.status !== 'completed').length;
  const blocked = group.status === 'limitReached';
  return {
    unfinishedCount,
    blocked,
    canEnd: unfinishedCount > 0,
    canComplete: true,
    canExtend: !blocked
      && unfinishedCount >= 2
      && group.estimateRounds.length < 3
      && group.estimatedPomodoros < 7,
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
