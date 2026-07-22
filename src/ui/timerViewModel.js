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
