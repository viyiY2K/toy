import {
  completeBreak,
  completeFocus,
  completeTaskFromPomodoro,
  captureTriageTask,
  discardFocus,
  endWorkAfterFocus,
  recordEnergy,
  recordInterrupt,
  resolveRecoveryInterval,
  skipActiveBreak,
  skipPendingBreak,
  startBreak,
  startFocus,
} from '../data/index';
import { Icon } from './Icon';
import {
  canWriteStandardSession,
  canCaptureTriage,
  elapsedSeconds,
  energySourceForCompletedSession,
  enabledRestSuggestions,
  formatCountdown,
  isRecoveryRequiredSession,
  nextStandardBreakType,
  recoveryRestChoices,
  recoveryTaskChoices,
  remainingSeconds,
  shouldOfferTaskCompletionCheck,
  canUseActiveBreakExit,
  canUsePendingBreakExits,
  timerDisplayTask,
  timerSubtasks,
} from './timerViewModel';

const React = window.React;

function clock() {
  return {
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function EnergyBar({ value, onChange, disabled }) {
  const [hover, setHover] = React.useState(null);
  const shown = hover ?? value;
  return (
    <div className="bar10">
      <div className="bar10-track" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => (
          <button
            key={level}
            className={`bar10-seg ${shown && level <= shown ? 'on' : ''}`}
            disabled={disabled}
            onMouseEnter={() => setHover(level)}
            onClick={() => onChange(level)}
            title={`能量 ${level} / 10`}
          />
        ))}
      </div>
      <div className="bar10-labels">
        <span>耗尽</span>
        <span className="bar10-value mono">{shown ? `${shown}/10` : '— / 10'}</span>
        <span>充满</span>
      </div>
    </div>
  );
}

function EnergyPrompt({ title, detail, busy, onSubmit, onSkip = null }) {
  const [level, setLevel] = React.useState(null);
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="section-h" style={{ marginBottom: 12 }}>
        <h3>{title}</h3>
      </div>
      <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>{detail}</p>
      <EnergyBar value={level} onChange={setLevel} disabled={busy}/>
      <button
        className="btn primary"
        style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
        disabled={busy || level === null}
        onClick={() => onSubmit(level)}
      >
        记录能量
      </button>
      {onSkip && (
        <button
          className="btn ghost"
          style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          disabled={busy}
          onClick={onSkip}
        >
          跳过本次记录
        </button>
      )}
    </div>
  );
}

function TimerCircle({
  session = null,
  remaining,
  idleDuration = 0,
  idleBlocked = false,
  idleBlockedMessage = '暂时不能开始',
  staticMode = null,
  staticHint = null,
  onStart = null,
}) {
  const total = session?.plannedDuration ?? idleDuration;
  const isStatic = session === null && staticMode !== null;
  const progress = isStatic
    ? 1
    : session === null
      ? 0
      : total > 0 ? 1 - remaining / total : 1;
  const circumference = 2 * Math.PI * 170;
  const isIdle = session === null && !isStatic;
  const mode = isStatic
    ? staticMode
    : isIdle
      ? 'FOCUS'
      : session.type === 'focus'
        ? 'FOCUS'
        : session.type === 'shortBreak'
          ? 'BREAK'
          : 'LONG BREAK';
  const hint = isStatic
    ? staticHint
    : isIdle ? (idleBlocked ? idleBlockedMessage : '点击开始') : null;
  const content = (
    <>
      <svg viewBox="0 0 360 360" aria-hidden="true">
        <circle cx="180" cy="180" r="170" fill="none" stroke="var(--line-2)" strokeWidth="4"/>
        <circle
          cx="180"
          cy="180"
          r="170"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform="rotate(-90 180 180)"
        />
      </svg>
      <div className="timer-readout">
        <div className="digits">{formatCountdown(remaining)}</div>
        <div className="mode">{mode}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </>
  );
  return isIdle ? (
    <button
      type="button"
      className={`timer-circle timer-circle-action ${idleBlocked ? 'is-blocked' : ''}`}
      disabled={idleBlocked || onStart === null}
      onClick={onStart}
      aria-label={idleBlocked ? idleBlockedMessage : '开始专注'}
    >
      {content}
    </button>
  ) : <div className={`timer-circle ${isStatic ? 'is-complete' : ''}`}>{content}</div>;
}

function TimerRoundDots({ completedFocusCount, longBreakEvery }) {
  const cycleLength = Math.max(1, longBreakEvery);
  const completedInCycle = completedFocusCount % cycleLength;
  const currentPosition = completedInCycle + 1;
  return (
    <div className="timer-round-dots" aria-label={`本轮已完成 ${completedInCycle} 个番茄`}>
      {Array.from({ length: cycleLength }, (_, index) => index + 1).map((position) => (
        <span
          key={position}
          className={`d ${
            position <= completedInCycle ? 'done' : position === currentPosition ? 'now' : ''
          }`}
        />
      ))}
    </div>
  );
}

function TimerSubtasks({ tasks }) {
  if (tasks.length === 0) return null;
  return (
    <div className="card timer-subtasks-card">
      <div className="card-title"><span>当前子任务</span></div>
      <div className="timer-subtasks-list">
        {tasks.map((task) => {
          const completed = task.status === 'completed';
          return (
            <div key={task.id} className={`timer-subtask-item ${completed ? 'is-completed' : ''}`}>
              <span className="timer-subtask-mark" aria-hidden="true">{completed ? '✓' : ''}</span>
              <span>{task.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskPicker({ tasks, selectedTaskId, onSelect, disabled }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="section-h" style={{ marginBottom: 8 }}>
        <h3>今日任务</h3>
      </div>
      <div className="timer-today-list">
        {tasks.map((task) => (
          <button
            key={task.id}
            className={`timer-today-item ${selectedTaskId === task.id ? 'current' : ''}`}
            disabled={disabled}
            onClick={() => onSelect(task.id)}
          >
            <span className="timer-today-name">{task.title}</span>
            <span className="timer-today-pomo mono">{task.estimatedPomodoros}</span>
          </button>
        ))}
        {tasks.length === 0 && <div className="empty">今日没有可开始的任务。</div>}
      </div>
    </div>
  );
}

function sourceLabel(source) {
  switch (source) {
    case 'dayStart': return ['开始今天之前', '记录此刻能量；只有主动提交才会写入。'];
    case 'beforeFocus': return ['重新开始专注之前', '距上一条能量记录已超过一个长休时长。'];
    case 'onReturn': return ['欢迎回来', '页面离开较久，先记录回来时的状态。'];
    case 'afterFocus': return ['专注结束后的状态', '本次 focus 已先独立完成；现在提交一条关联的能量记录。'];
    case 'afterShortBreak': return ['短休后的状态', '记录这次短休后的恢复感受。'];
    case 'afterLongBreak': return ['长休后的状态', '记录这次长休后的恢复感受。'];
    default: return ['记录能量', '记录此刻状态。'];
  }
}

function RecoveryPanel({ recovery, taskViews, busy, command, onResolved }) {
  const sourceSession = recovery.sourceSession;
  const isFocus = sourceSession.type === 'focus';
  const taskChoices = recoveryTaskChoices(taskViews);
  const restChoices = recoveryRestChoices(taskViews.settings, sourceSession.type);
  const defaultTaskId = taskChoices.some(({ id }) => id === recovery.sourceTask?.id)
    ? recovery.sourceTask.id
    : taskChoices[0]?.id ?? '';
  const [originalAs, setOriginalAs] = React.useState('completed');
  const [originalDuration, setOriginalDuration] = React.useState('');
  const [originalRest, setOriginalRest] = React.useState('');
  const [remainderKind, setRemainderKind] = React.useState('ignore');
  const [ignoreReason, setIgnoreReason] = React.useState('');
  const [extraDuration, setExtraDuration] = React.useState('');
  const [extraTaskId, setExtraTaskId] = React.useState(defaultTaskId);
  const [extraRest, setExtraRest] = React.useState('');

  const originalDurationValue = Number(originalDuration);
  const originalNeedsDuration = originalAs !== 'skipped';
  const originalDurationValid = !originalNeedsDuration || (
    originalDuration.trim() !== ''
    && Number.isInteger(originalDurationValue)
    && originalDurationValue >= 0
    && originalDurationValue <= recovery.envelopeDurationSeconds
  );
  const coverageSeconds = originalNeedsDuration && originalDurationValid
    ? originalDurationValue
    : 0;
  const availableExtraSeconds = Math.max(0, recovery.envelopeDurationSeconds - coverageSeconds);
  const extraDurationValue = Number(extraDuration);
  const extraDurationValid = (
    extraDuration.trim() !== ''
    && Number.isInteger(extraDurationValue)
    && extraDurationValue > 0
    && extraDurationValue <= availableExtraSeconds
  );
  const remainderValid = remainderKind === 'ignore'
    || (extraDurationValid && (remainderKind !== 'extraFocus' || extraTaskId !== ''));
  const canSubmit = !busy && originalDurationValid && remainderValid;

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    const original = originalAs === 'skipped'
      ? { resolvedAs: 'skipped' }
      : isFocus
        ? { resolvedAs: originalAs, actualDuration: originalDurationValue }
        : {
            resolvedAs: 'completed',
            actualDuration: originalDurationValue,
            actualRest: originalRest || null,
          };
    const remainder = remainderKind === 'ignore'
      ? { kind: 'ignore', ignoreReason: ignoreReason.trim() || null }
      : remainderKind === 'extraFocus'
        ? { kind: 'extraFocus', taskId: extraTaskId, actualDuration: extraDurationValue }
        : { kind: 'extraRest', actualDuration: extraDurationValue, actualRest: extraRest || null };
    await command(
      (time) => resolveRecoveryInterval({
        ...time,
        intervalId: recovery.interval.id,
        original,
        remainder,
      }),
      () => onResolved(sourceSession.id),
    );
  };

  const sourceLabelText = isFocus
    ? '专注'
    : sourceSession.type === 'shortBreak' ? '短休息' : '长休息';
  const detectionLabel = recovery.interval.source === 'systemRecovered'
    ? '后台越过计时终点'
    : '应用重新打开';
  return (
    <div>
      <div className="main-head">
        <div>
          <h1>计时</h1>
          <div className="sub">上次计时没有正常收尾，请确认事实后一次提交。</div>
        </div>
      </div>
      <form className="card" style={{ maxWidth: 680, margin: '28px auto', padding: 22 }} onSubmit={submit}>
        <div className="section-h" style={{ marginBottom: 10 }}>
          <h3>需要恢复处理</h3>
          <span className="count">{sourceLabelText}</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>
          检测来源：{detectionLabel}。事实包络共 {recovery.envelopeDurationSeconds} 秒；
          {recovery.sourceTask ? `关联任务“${recovery.sourceTask.title}”。` : '未关联任务。'}
          系统不会按墙钟差值自动判定结果。
        </p>

        <div className="card-title" style={{ marginTop: 18 }}><span>1 · 原计时结果</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button
            type="button"
            className={`btn ${originalAs === 'completed' ? 'primary' : ''}`}
            disabled={busy}
            onClick={() => setOriginalAs('completed')}
          >
            {isFocus ? '专注完成' : '休息完成'}
          </button>
          <button
            type="button"
            className={`btn ${originalAs === (isFocus ? 'discarded' : 'skipped') ? 'primary' : ''}`}
            disabled={busy}
            onClick={() => setOriginalAs(isFocus ? 'discarded' : 'skipped')}
          >
            {isFocus ? '专注作废' : '休息未进行'}
          </button>
        </div>
        {originalNeedsDuration && (
          <div className="planner-row" style={{ marginTop: 12 }}>
            <label className="planner-l" htmlFor="recovery-original-duration">实际时长</label>
            <input
              id="recovery-original-duration"
              className="input boxed mono"
              style={{ width: 130 }}
              type="number"
              min="0"
              max={recovery.envelopeDurationSeconds}
              step="1"
              value={originalDuration}
              disabled={busy}
              onChange={(event) => setOriginalDuration(event.target.value)}
            />
            <span className="planner-eq">秒</span>
          </div>
        )}
        {!isFocus && originalAs === 'completed' && (
          <div className="planner-row" style={{ marginTop: 8 }}>
            <label className="planner-l" htmlFor="recovery-original-rest">实际休息</label>
            <select
              id="recovery-original-rest"
              className="input boxed"
              value={originalRest}
              disabled={busy}
              onChange={(event) => setOriginalRest(event.target.value)}
            >
              <option value="">未选择</option>
              {restChoices.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </div>
        )}

        <div className="card-title" style={{ marginTop: 22 }}><span>2 · 剩余未知时段</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {[
            ['ignore', '忽略'],
            ['extraFocus', '额外专注'],
            ['extraRest', '额外休息'],
          ].map(([kind, label]) => (
            <button
              type="button"
              key={kind}
              className={`btn ${remainderKind === kind ? 'primary' : ''}`}
              disabled={busy}
              onClick={() => setRemainderKind(kind)}
            >
              {label}
            </button>
          ))}
        </div>
        {remainderKind === 'ignore' ? (
          <div className="planner-row" style={{ marginTop: 12 }}>
            <label className="planner-l" htmlFor="recovery-ignore-reason">说明</label>
            <input
              id="recovery-ignore-reason"
              className="input boxed"
              style={{ flex: 1 }}
              value={ignoreReason}
              disabled={busy}
              placeholder="可选"
              onChange={(event) => setIgnoreReason(event.target.value)}
            />
          </div>
        ) : (
          <>
            <div className="planner-row" style={{ marginTop: 12 }}>
              <label className="planner-l" htmlFor="recovery-extra-duration">归类时长</label>
              <input
                id="recovery-extra-duration"
                className="input boxed mono"
                style={{ width: 130 }}
                type="number"
                min="1"
                max={availableExtraSeconds}
                step="1"
                value={extraDuration}
                disabled={busy}
                onChange={(event) => setExtraDuration(event.target.value)}
              />
              <span className="planner-eq">秒（最多 {availableExtraSeconds}）</span>
            </div>
            {remainderKind === 'extraFocus' ? (
              <div className="planner-row" style={{ marginTop: 8 }}>
                <label className="planner-l" htmlFor="recovery-extra-task">关联任务</label>
                <select
                  id="recovery-extra-task"
                  className="input boxed"
                  value={extraTaskId}
                  disabled={busy}
                  onChange={(event) => setExtraTaskId(event.target.value)}
                >
                  {taskChoices.length === 0 && <option value="">没有可用任务</option>}
                  {taskChoices.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              </div>
            ) : (
              <div className="planner-row" style={{ marginTop: 8 }}>
                <label className="planner-l" htmlFor="recovery-extra-rest">休息项目</label>
                <select
                  id="recovery-extra-rest"
                  className="input boxed"
                  value={extraRest}
                  disabled={busy}
                  onChange={(event) => setExtraRest(event.target.value)}
                >
                  <option value="">未选择</option>
                  {restChoices.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </div>
            )}
          </>
        )}
        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 20 }}
          disabled={!canSubmit}
          type="submit"
        >
          确认并恢复计时流程
        </button>
      </form>
    </div>
  );
}

export function TimerView({
  snapshot,
  runCommand,
  busy,
  returnEnergyPrompt,
  onReturnEnergyRecorded,
  runtimeSessionIds,
  onSessionStarted,
  onRecoveryResolved,
  timerLifecyclePaused,
}) {
  const { taskViews } = snapshot;
  const activeSession = snapshot.activeSession;
  const standardSessionWritable = canWriteStandardSession(activeSession, runtimeSessionIds);
  const recoveryRequired = isRecoveryRequiredSession(
    activeSession,
    snapshot.pendingRecovery,
    runtimeSessionIds,
  );
  const activeTasks = taskViews.todayTasks.filter((task) => task.status === 'active');
  const [selectedTaskId, setSelectedTaskId] = React.useState(activeTasks[0]?.id ?? null);
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [actualRest, setActualRest] = React.useState(null);
  const [pendingEnergyPrompt, setPendingEnergyPrompt] = React.useState(null);
  const [triageTitle, setTriageTitle] = React.useState('');
  const completedFocusId = React.useRef(null);
  const selectedTask = activeTasks.find((task) => task.id === selectedTaskId) ?? null;
  const displayTask = timerDisplayTask(activeSession, snapshot.activeTask, selectedTask);
  const displaySubtasks = timerSubtasks(taskViews, displayTask);

  React.useEffect(() => {
    if (!activeTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(activeTasks[0]?.id ?? null);
    }
  }, [activeTasks, selectedTaskId]);

  React.useEffect(() => {
    setActualRest(null);
    completedFocusId.current = null;
  }, [snapshot.activeSession?.id]);

  React.useEffect(() => {
    if (!activeSession || recoveryRequired || timerLifecyclePaused) return undefined;
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [activeSession?.id, recoveryRequired, timerLifecyclePaused]);

  const command = (work, onSuccess = null) => runCommand(() => work(clock()), onSuccess);
  const activeSessionCommand = (work) => standardSessionWritable
    ? command(work)
    : Promise.resolve(undefined);
  const remaining = activeSession === null ? 0 : remainingSeconds(activeSession, nowMs);

  React.useEffect(() => {
    if (
      !activeSession
      || recoveryRequired
      || timerLifecyclePaused
      || document.visibilityState !== 'visible'
      || activeSession.type !== 'focus'
      || remaining > 0
      || busy
      || completedFocusId.current === activeSession.id
    ) return;
    completedFocusId.current = activeSession.id;
    activeSessionCommand((time) => completeFocus({
      ...time,
      sessionId: activeSession.id,
      actualDuration: activeSession.plannedDuration ?? 0,
    })).then((result) => {
      if (result) {
        setPendingEnergyPrompt({
          sessionId: activeSession.id,
          source: 'afterFocus',
          taskId: snapshot.activeTask?.id ?? activeSession.taskId,
          taskTitle: snapshot.activeTask?.title ?? null,
        });
      }
    });
  }, [
    activeSession,
    busy,
    recoveryRequired,
    remaining,
    standardSessionWritable,
    timerLifecyclePaused,
  ]);

  const standaloneEnergySource = returnEnergyPrompt ? 'onReturn' : snapshot.preFocusEnergySource;
  const submitEnergy = (source, sessionId = null) => async (energyLevel) => {
    const result = await command((time) => sessionId === null
      ? recordEnergy({ ...time, source, energyLevel })
      : recordEnergy({ ...time, source, sessionId, energyLevel }));
    if (!result) return;
    if (returnEnergyPrompt || source === 'onReturn') onReturnEnergyRecorded();
    if (sessionId !== null) setPendingEnergyPrompt(null);
  };

  if (recoveryRequired) {
    if (snapshot.pendingRecovery) {
      return (
        <RecoveryPanel
          key={snapshot.pendingRecovery.interval.id}
          recovery={snapshot.pendingRecovery}
          taskViews={taskViews}
          busy={busy}
          command={command}
          onResolved={onRecoveryResolved}
        />
      );
    }
    const sessionLabel = activeSession.type === 'focus'
      ? '专注'
      : activeSession.type === 'shortBreak' ? '短休息' : '长休息';
    return (
      <div>
        <div className="main-head">
          <div>
            <h1>计时</h1>
            <div className="sub">检测到本次启动前未正常收尾的计时。</div>
          </div>
        </div>
        <div style={{ maxWidth: 560, margin: '40px auto' }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="section-h" style={{ marginBottom: 12 }}>
              <h3>需要恢复处理</h3>
              <span className="count">{sessionLabel}</span>
            </div>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>
              该 Session 来自应用本次启动之前，但恢复区间尚未建立。请保留页面并重试；
              系统不会通过普通计时按钮改写它。
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (pendingEnergyPrompt) {
    const [title, detail] = sourceLabel(pendingEnergyPrompt.source);
    const completedTask = pendingEnergyPrompt.taskId == null
      ? null
      : [...taskViews.todayTasks, ...taskViews.activeTasks, ...taskViews.completedTasks]
          .find((task) => task.id === pendingEnergyPrompt.taskId)
        ?? (pendingEnergyPrompt.taskTitle
          ? { id: pendingEnergyPrompt.taskId, title: pendingEnergyPrompt.taskTitle }
          : null);
    const completedTaskSubtasks = timerSubtasks(taskViews, completedTask);
    const completionCheckDue = pendingEnergyPrompt.source === 'afterFocus'
      && shouldOfferTaskCompletionCheck(taskViews, completedTask);
    const completedTaskFocusCount = completedTask === null
      ? 0
      : taskViews.completedValidFocusCountByTaskId[completedTask.id] ?? 0;
    return (
      <div>
        <div className="main-head">
          <div><h1>计时</h1><div className="sub">计时事实已写入，觉察记录等待你的主动提交。</div></div>
        </div>
        <div className="timer-stage">
          <div className="timer-main">
            <div className="timer-task">
              <div className="label">本次专注任务</div>
              <div className="name">{completedTask?.title ?? '计时完成'}</div>
            </div>
            <TimerCircle
              remaining={0}
              staticMode={
                pendingEnergyPrompt.source === 'afterFocus' ? 'FOCUS COMPLETE' : 'BREAK COMPLETE'
              }
              staticHint="记录结束状态"
            />
          </div>
          <aside className="timer-aside">
            {completionCheckDue && (
              <div className="card" style={{ padding: 18 }}>
                <div className="section-h" style={{ marginBottom: 10 }}>
                  <h3>任务完成确认</h3>
                  <span className="count">
                    {completedTaskFocusCount} / {completedTask.estimatedPomodoros}
                  </span>
                </div>
                <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>
                  已达到当前预估番茄数。如果任务已经做完，请在这里确认。
                </p>
                <button
                  className="btn primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={busy}
                  onClick={() => command((time) => completeTaskFromPomodoro({
                    ...time,
                    sessionId: pendingEnergyPrompt.sessionId,
                  }))}
                >
                  <Icon name="check" size={13}/> 确认完成任务
                </button>
              </div>
            )}
            <EnergyPrompt
              key={`${pendingEnergyPrompt.source}:${pendingEnergyPrompt.sessionId}`}
              title={title}
              detail={detail}
              busy={busy}
              onSubmit={submitEnergy(pendingEnergyPrompt.source, pendingEnergyPrompt.sessionId)}
              onSkip={() => setPendingEnergyPrompt(null)}
            />
            <TimerSubtasks tasks={completedTaskSubtasks}/>
            <TaskPicker
              tasks={activeTasks}
              selectedTaskId={completedTask?.id ?? selectedTaskId}
              onSelect={setSelectedTaskId}
              disabled
            />
          </aside>
        </div>
      </div>
    );
  }

  if (canUsePendingBreakExits(
    activeSession,
    snapshot.pendingBreakFocus,
    snapshot.pendingRecovery,
  )) {
    const breakType = nextStandardBreakType(
      snapshot.completedFocusCount,
      taskViews.settings.longBreakEvery,
    );
    const choices = enabledRestSuggestions(taskViews.settings, breakType);
    const suggestion = choices[0] ?? null;
    const completionCheckDue = shouldOfferTaskCompletionCheck(
      taskViews,
      snapshot.pendingBreakTask,
    );
    const pendingTaskFocusCount = snapshot.pendingBreakTask === null
      ? 0
      : taskViews.completedValidFocusCountByTaskId[snapshot.pendingBreakTask.id] ?? 0;
    return (
      <div>
        <div className="main-head">
          <div>
            <h1>计时</h1>
            <div className="sub">本次专注已完成；休息由下一次明确操作开始。</div>
          </div>
        </div>
        <div className="timer-stage">
          <div className="timer-main">
            <div className="timer-task">
              <div className="label">刚完成的任务</div>
              <div className="name">{snapshot.pendingBreakTask?.title ?? '已完成专注'}</div>
            </div>
            <div className="card" style={{ width: '100%', maxWidth: 520, padding: 20 }}>
              <div className="rest-suggest">
                <div>
                  <div className="label">{breakType === 'longBreak' ? '长休建议' : '短休建议'}</div>
                  <div className="name">{suggestion?.label ?? '自由休息'}</div>
                </div>
                <Icon name="coffee" size={20}/>
              </div>
              {completionCheckDue && (
                <button
                  className="btn primary"
                  style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
                  disabled={busy}
                  onClick={() => command((time) => completeTaskFromPomodoro({
                    ...time, sessionId: snapshot.pendingBreakFocus.id,
                  }))}
                >
                  <Icon name="check" size={13}/>
                  已完成 {pendingTaskFocusCount} / {snapshot.pendingBreakTask.estimatedPomodoros}
                  · 确认完成任务
                </button>
              )}
              <button
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={busy}
                onClick={() => command(
                  (time) => startBreak({
                    ...time,
                    sourceFocusSessionId: snapshot.pendingBreakFocus.id,
                    suggestedRest: suggestion?.key ?? null,
                  }),
                  (result) => onSessionStarted(result.value.id),
                )}
              >
                开始{breakType === 'longBreak' ? '长休' : '短休'}
              </button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <button
                  className="btn ghost"
                  style={{ justifyContent: 'center' }}
                  disabled={busy}
                  onClick={() => command((time) => skipPendingBreak({
                    ...time,
                    sourceFocusSessionId: snapshot.pendingBreakFocus.id,
                  }))}
                >
                  跳过休息
                </button>
                <button
                  className="btn ghost"
                  style={{ justifyContent: 'center' }}
                  disabled={busy}
                  onClick={() => command((time) => endWorkAfterFocus({
                    ...time,
                    sourceFocusSessionId: snapshot.pendingBreakFocus.id,
                  }))}
                >
                  今日收工
                </button>
              </div>
              {snapshot.pendingBreakTask
                && snapshot.pendingBreakTask.status !== 'completed'
                && !completionCheckDue
                && (
                  <button
                    className="btn ghost"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    disabled={busy}
                    onClick={() => command((time) => completeTaskFromPomodoro({
                      ...time, sessionId: snapshot.pendingBreakFocus.id,
                    }))}
                  >
                    <Icon name="check" size={13}/> 完成这个任务
                  </button>
                )}
            </div>
          </div>
          <aside className="timer-aside">
            <TaskPicker
              tasks={activeTasks}
              selectedTaskId={selectedTaskId}
              onSelect={setSelectedTaskId}
              disabled
            />
          </aside>
        </div>
      </div>
    );
  }

  if (!activeSession) {
    const [energyTitle, energyDetail] = sourceLabel(standaloneEnergySource);
    const idleBlockedMessage = standaloneEnergySource !== null
      ? '请先记录能量'
      : selectedTask === null
        ? '请先选择任务'
        : busy
          ? '正在处理'
          : null;
    const startSelectedFocus = () => selectedTask && command(
      (time) => startFocus({ ...time, taskId: selectedTask.id }),
      (result) => onSessionStarted(result.value.id),
    );
    return (
      <div>
        <div className="main-head">
          <div><h1>计时</h1><div className="sub">选择今日任务，开始一个标准 focus。</div></div>
        </div>
        <div className="timer-stage">
          <div className="timer-main">
            <div className="timer-task">
              <div className="label">准备开始</div>
              <div className="name">{selectedTask?.title ?? '先从今日待办选择任务'}</div>
            </div>
            <TimerCircle
              remaining={taskViews.settings.focusMinutes * 60}
              idleDuration={taskViews.settings.focusMinutes * 60}
              idleBlocked={idleBlockedMessage !== null}
              idleBlockedMessage={idleBlockedMessage ?? undefined}
              onStart={startSelectedFocus}
            />
            <TimerRoundDots
              completedFocusCount={snapshot.completedFocusCount}
              longBreakEvery={taskViews.settings.longBreakEvery}
            />
          </div>
          <aside className="timer-aside">
            {standaloneEnergySource && (
              <EnergyPrompt
                key={standaloneEnergySource}
                title={energyTitle}
                detail={energyDetail}
                busy={busy}
                onSubmit={submitEnergy(standaloneEnergySource)}
              />
            )}
            <TimerSubtasks tasks={displaySubtasks}/>
            <TaskPicker
              tasks={activeTasks}
              selectedTaskId={selectedTaskId}
              onSelect={setSelectedTaskId}
              disabled={busy}
            />
          </aside>
        </div>
      </div>
    );
  }

  const isFocus = activeSession.type === 'focus';
  const elapsed = elapsedSeconds(activeSession, nowMs);
  const restChoices = isFocus
    ? []
    : enabledRestSuggestions(taskViews.settings, activeSession.type);
  const suggestedRest = restChoices.find((item) => item.key === activeSession.suggestedRest) ?? null;
  const breakReadyToComplete = !isFocus && remaining === 0;
  const triageCaptureEnabled = canCaptureTriage(
    activeSession,
    snapshot.pendingRecovery,
    runtimeSessionIds,
  );

  return (
    <div>
      <div className="main-head">
        <div>
          <h1>计时</h1>
          <div className="sub">
            {isFocus
              ? `第 ${activeSession.pomodoroIndex} 个任务番茄 · 专注中`
              : activeSession.type === 'shortBreak' ? '短休息进行中' : '长休息进行中'}
          </div>
        </div>
      </div>
      <div className="timer-stage">
        <div className="timer-main">
          <div className="timer-task">
            <div className="label">{isFocus ? '当前任务' : '刚才的任务'}</div>
            <div className="name">{snapshot.activeTask?.title ?? (isFocus ? '专注' : '休息')}</div>
          </div>
          <TimerCircle session={activeSession} remaining={remaining}/>
          {isFocus && (
            <TimerRoundDots
              completedFocusCount={snapshot.completedFocusCount}
              longBreakEvery={taskViews.settings.longBreakEvery}
            />
          )}
          {!isFocus && (
            <div className="card" style={{ width: '100%', maxWidth: 560, padding: 18, marginTop: 20 }}>
              {suggestedRest && (
                <div className="rest-suggest">
                  <div>
                    <div className="label">建议的休息</div>
                    <div className="name">{suggestedRest.label}</div>
                  </div>
                  <Icon name="coffee" size={20}/>
                </div>
              )}
              <div className="section-h" style={{ marginBottom: 8 }}>
                <h3>实际休息项目</h3>
                <span className="count">可不选</span>
              </div>
              <div className="rest-picker" style={{ margin: 0 }}>
                <button
                  className={`rest-picker-item ghost ${actualRest === null ? 'on' : ''}`}
                  disabled={busy}
                  onClick={() => setActualRest(null)}
                >
                  未选择休息项目
                </button>
                {restChoices.map((item) => (
                  <button
                    key={item.key}
                    className={`rest-picker-item ${actualRest === item.key ? 'on' : ''}`}
                    disabled={busy}
                    onClick={() => setActualRest(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {breakReadyToComplete && (
                <button
                  className="btn primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                  disabled={busy}
                  onClick={async () => {
                    const result = await activeSessionCommand((time) => completeBreak({
                      ...time,
                      sessionId: activeSession.id,
                      actualDuration: activeSession.plannedDuration ?? 0,
                      actualRest,
                    }));
                    const source = energySourceForCompletedSession(activeSession.type);
                    if (result && source) {
                      setPendingEnergyPrompt({
                        sessionId: activeSession.id,
                        source,
                        taskId: snapshot.activeTask?.id ?? null,
                        taskTitle: snapshot.activeTask?.title ?? null,
                      });
                    }
                  }}
                >
                  <Icon name="check" size={13}/> 完成休息
                </button>
              )}
              {canUseActiveBreakExit(
                activeSession,
                snapshot.pendingRecovery,
                runtimeSessionIds,
              ) && !breakReadyToComplete && (
                <button
                  className="btn ghost"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                  disabled={busy}
                  onClick={() => activeSessionCommand((time) => skipActiveBreak({
                    ...time,
                    sessionId: activeSession.id,
                  }))}
                >
                  提前结束休息
                </button>
              )}
            </div>
          )}
        </div>
        <aside className="timer-aside">
          {isFocus && (
            <>
              <div className="timer-side-actions">
                <button
                  className="side-action"
                  title="作废本次专注"
                  aria-label="作废本次专注"
                  disabled={busy}
                  onClick={() => activeSessionCommand((time) => discardFocus({
                    ...time,
                    sessionId: activeSession.id,
                    actualDuration: Math.min(elapsed, activeSession.plannedDuration ?? elapsed),
                  }))}
                >
                  <Icon name="x" size={21}/>
                </button>
                <button
                  className="side-action"
                  title="内部打扰（走神 / 自我打断）"
                  aria-label="内部打扰（走神 / 自我打断）"
                  disabled={busy}
                  onClick={() => activeSessionCommand((time) => recordInterrupt({
                    ...time, sessionId: activeSession.id, kind: 'internal',
                    offsetSeconds: elapsed,
                  }))}
                >
                  <Icon name="brain" size={21}/>
                  {snapshot.interruptCounts.internal > 0 && (
                    <span className="side-count">{snapshot.interruptCounts.internal}</span>
                  )}
                </button>
                <button
                  className="side-action"
                  title="外部打扰（消息 / 找人 / 噪音）"
                  aria-label="外部打扰（消息 / 找人 / 噪音）"
                  disabled={busy}
                  onClick={() => activeSessionCommand((time) => recordInterrupt({
                    ...time, sessionId: activeSession.id, kind: 'external',
                    offsetSeconds: elapsed,
                  }))}
                >
                  <Icon name="bell" size={21}/>
                  {snapshot.interruptCounts.external > 0 && (
                    <span className="side-count">{snapshot.interruptCounts.external}</span>
                  )}
                </button>
              </div>
              <div className="card urgent-card timer-triage-card">
                <div className="card-title">
                  <span><Icon name="urgent" size={12}/> &nbsp;计划外紧急</span>
                  <span>{taskViews.pendingTriageTasks.length} 条待分流</span>
                </div>
                <div className="triage-capture-form">
                  <input
                    className="input boxed"
                    aria-label="快速捕获待分流事项"
                    value={triageTitle}
                    disabled={busy || !triageCaptureEnabled}
                    placeholder="临时冒出来的事，回车记下来…"
                    onChange={(event) => setTriageTitle(event.target.value)}
                    onKeyDown={async (event) => {
                      if (event.key !== 'Enter' || !triageTitle.trim() || !triageCaptureEnabled) return;
                      const result = await command((time) => captureTriageTask({
                        ...time,
                        sessionId: activeSession.id,
                        title: triageTitle.trim(),
                      }));
                      if (result) setTriageTitle('');
                    }}
                  />
                  <button
                    className="btn sm"
                    aria-label="捕获计划外事项"
                    disabled={busy || !triageCaptureEnabled || !triageTitle.trim()}
                    onClick={async () => {
                      const result = await command((time) => captureTriageTask({
                        ...time,
                        sessionId: activeSession.id,
                        title: triageTitle.trim(),
                      }));
                      if (result) setTriageTitle('');
                    }}
                  >
                    <Icon name="plus" size={12}/>
                  </button>
                </div>
                <div className="timer-triage-help">番茄结束后，再到清单中处理。</div>
              </div>
            </>
          )}
          <TimerSubtasks tasks={displaySubtasks}/>
          <TaskPicker
            tasks={activeTasks}
            selectedTaskId={displayTask?.id ?? selectedTaskId}
            onSelect={setSelectedTaskId}
            disabled
          />
        </aside>
      </div>
    </div>
  );
}
