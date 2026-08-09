import {
  adjustMergeGroupEstimate,
  adjustTaskEstimate,
  completeBreak,
  completeFocus,
  completeTaskFromPomodoro,
  captureTriageTask,
  discardFocus,
  dissolveMergeGroup,
  endMergeGroupRound,
  endWorkAfterFocus,
  markMergeGroupLimitReached,
  recordEnergy,
  recordInterrupt,
  resolveRecoveryInterval,
  skipActiveBreak,
  skipPendingBreak,
  startBreak,
  startFocus,
  startMergeGroupFocus,
} from '../data/index';
import { Icon } from './Icon';
import { EmptyState } from './EmptyState';
import { canAdjustTaskEstimate } from './taskViewModel';
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
  mergeRoundChoiceOptions,
  timerDisplayTask,
  timerMergeMembers,
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
        <circle cx="180" cy="180" r="170" fill="none" stroke="var(--line)" strokeWidth="2"/>
        <circle
          cx="180"
          cy="180"
          r="170"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
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

/**
 * 本次专注涉及的任务。
 *
 * 计时页**不再展示任何任务的子母层级关系**：这张卡片只在合并场景出现，列出合并组
 * 成员；普通单任务专注（taskIds 长度为 1）整张卡片不展示。
 *
 * 成员之间完全平等、互相独立——合并只表示"这几件事各自都占不满一个番茄"，不表示
 * 它们属于同一件事，因此这里既不分层也不按任何上层归属分组。
 */
function TimerMergeMembers({ tasks }) {
  if (tasks.length === 0) return null;
  return (
    <div className="card timer-merge-card">
      <div className="card-title"><span>本次一起做 · {tasks.length} 件小事</span></div>
      <div className="merge-members">
        {tasks.map((task) => {
          const completed = task.status === 'completed';
          return (
            <div key={task.id} className={`merge-member ${completed ? 'is-completed' : ''}`}>
              <span
                className={`timer-merge-member-check ${completed ? 'is-done' : ''}`}
                aria-hidden="true"
              />
              <span className="merge-member-name">{task.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 合并番茄到点后的收尾二选一（§3.8 关键规则 4）。
 *
 * - 结束：没做完的退出组、回到今日待办独立显示；已做完的留在组里，组不解散
 *   （除非退出后剩余成员 < 2，此时自动解散）；
 * - 追加预估番茄：组保持进行中，预估 +1，已做完的继续留在组里，下一轮只带没做完的。
 *
 * 三轮用满或已做满 7 个番茄仍未全部完成时是**强阻断**（关键规则 6）：不再提供
 * 「追加预估」，只能移出剩余成员或整组解散；提示本身不解除阻塞。
 */
function MergeRoundChoice({ group, members, busy, command }) {
  const options = mergeRoundChoiceOptions(group, members);
  if (options === null) return null;
  const { unfinishedCount, blocked, canExtend, canDissolve } = options;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="section-h" style={{ marginBottom: 10 }}>
        <h3>这一轮结束了</h3>
      </div>
      <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>
        还剩 {unfinishedCount} 件没做完
        {blocked
          ? '。这些零碎事项已经占满一个多番茄的量，建议拆开单独处理，不要继续合并。'
          : '。要就此结束，还是再追加一个番茄？'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn primary"
          style={{ flex: 1, justifyContent: 'center' }}
          disabled={busy}
          onClick={() => command((time) => endMergeGroupRound({ ...time, mergeGroupId: group.id }))}
        >
          结束（没做完的回到今日待办）
        </button>
        {canExtend && (
          <button
            className="btn ghost"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={busy}
            onClick={() => command((time) => adjustMergeGroupEstimate({
              ...time, mergeGroupId: group.id, estimatedPomodoros: group.estimatedPomodoros + 1,
            }))}
          >
            追加预估番茄（{group.estimatedPomodoros} → {group.estimatedPomodoros + 1}）
          </button>
        )}
        {canDissolve && (
          <button
            className="btn ghost"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={busy}
            onClick={() => command((time) => dissolveMergeGroup({ ...time, mergeGroupId: group.id }))}
          >
            取消整次合并
          </button>
        )}
      </div>
    </div>
  );
}

function TaskPicker({ tasks, mergeGroups = [], selectedTaskId, onSelect, disabled }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="section-h" style={{ marginBottom: 8 }}>
        <h3>今日任务</h3>
      </div>
      <div className="timer-today-list">
        {mergeGroups.map(({ group, members }) => (
          <button
            key={group.id}
            className={`timer-today-item ${selectedTaskId === `merge:${group.id}` ? 'current' : ''}`}
            disabled={disabled || group.status === 'limitReached'}
            title={group.status === 'limitReached'
              ? '这个合并卡片已达上限，先处理掉里面没做完的事'
              : '一起做这几件小事'}
            onClick={() => onSelect(`merge:${group.id}`)}
          >
            <span className="timer-today-name">
              一起做 · {members.map((task) => task.title).join('、')}
            </span>
            <span className="timer-today-pomo mono">{group.estimatedPomodoros}</span>
          </button>
        ))}
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
        {tasks.length === 0 && mergeGroups.length === 0 && (
          <EmptyState
            icon="list"
            title="今天还没有待办"
            hint="先到清单页把今天要做的事安排好，再回来开始专注。"
          />
        )}
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

function TaskCompletionActions({ task, focusCount, busy, onComplete, onReestimate }) {
  const [reestimating, setReestimating] = React.useState(false);
  const [estimate, setEstimate] = React.useState(String(task.estimatedPomodoros));
  const canReestimate = canAdjustTaskEstimate(task);
  const estimateValue = Number(estimate);
  const estimateValid = Number.isInteger(estimateValue)
    && estimateValue >= 1 && estimateValue <= 7 && estimateValue !== task.estimatedPomodoros;

  if (reestimating) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          className="input boxed mono"
          type="number"
          min="1"
          max="7"
          style={{ width: 70 }}
          value={estimate}
          disabled={busy}
          autoFocus
          onChange={(event) => setEstimate(event.target.value)}
        />
        <button
          className="btn primary sm"
          disabled={busy || !estimateValid}
          onClick={() => onReestimate(estimateValue)}
        >
          确认新预估
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={() => setReestimating(false)}>
          取消
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
      <button
        className="btn primary"
        style={{ flex: 1, justifyContent: 'center' }}
        disabled={busy}
        onClick={onComplete}
      >
        <Icon name="check" size={13}/> 已完成 {focusCount} / {task.estimatedPomodoros} · 任务已完成
      </button>
      {canReestimate && (
        <button
          className="btn ghost"
          style={{ flex: 1, justifyContent: 'center' }}
          disabled={busy}
          onClick={() => setReestimating(true)}
        >
          需要重新预估
        </button>
      )}
    </div>
  );
}

// 恢复处理只知道事实包络的开始时刻（session.startedAt）；结束时刻永远是用户手填的
// 事实，不能反推。时间段模式让用户填「几点结束」而不是心算秒数，开始时刻只读展示。
function secondsOfDayToClock(totalSeconds) {
  const normalized = ((Math.round(totalSeconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clockToSecondsOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function localSecondsOfDay(isoString) {
  const date = new Date(isoString);
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function durationModeToggleStyle(active) {
  return {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 999,
    border: '1px solid var(--line)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent-ink)' : 'var(--muted)',
  };
}

function DurationSecondsField({ id, label, value, onChange, disabled, max, unitHint, startClockSeconds }) {
  const [mode, setMode] = React.useState('seconds');
  const startClock = secondsOfDayToClock(startClockSeconds);
  const [endClock, setEndClock] = React.useState('');

  const switchMode = (nextMode) => {
    if (nextMode === 'range') {
      const raw = Number(value);
      setEndClock(
        value.trim() !== '' && Number.isFinite(raw)
          ? secondsOfDayToClock(startClockSeconds + raw)
          : '',
      );
    }
    setMode(nextMode);
  };

  const commitRange = (nextEndClock) => {
    const endSeconds = clockToSecondsOfDay(nextEndClock);
    if (endSeconds === null) return;
    let duration = endSeconds - startClockSeconds;
    if (duration < 0) duration += 86400;
    onChange(String(Math.round(duration)));
  };

  return (
    <div className="planner-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
      <label className="planner-l" htmlFor={id}>{label}</label>
      {mode === 'seconds' ? (
        <>
          <input
            id={id}
            className="input boxed mono"
            style={{ width: 130 }}
            type="number"
            min="0"
            max={max}
            step="1"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="planner-eq">{unitHint}</span>
        </>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            className="input boxed mono"
            style={{ width: 110 }}
            type="time"
            step="1"
            value={startClock}
            disabled
            aria-label={`${label}开始时间（记录事实，不可改）`}
            title="计时开始的时刻，来自当时的记录，不可修改"
          />
          <span className="planner-eq">到</span>
          <input
            id={id}
            className="input boxed mono"
            style={{ width: 110 }}
            type="time"
            step="1"
            value={endClock}
            disabled={disabled}
            aria-label={`${label}结束时间`}
            onChange={(event) => setEndClock(event.target.value)}
            onBlur={() => commitRange(endClock)}
          />
        </span>
      )}
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <button
          type="button"
          style={durationModeToggleStyle(mode === 'seconds')}
          disabled={disabled}
          title="按秒数输入"
          onClick={() => switchMode('seconds')}
        >
          秒数
        </button>
        <button
          type="button"
          style={durationModeToggleStyle(mode === 'range')}
          disabled={disabled}
          title="按结束时刻输入"
          onClick={() => switchMode('range')}
        >
          时间段
        </button>
      </span>
    </div>
  );
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
  const sessionStartClockSeconds = localSecondsOfDay(sourceSession.startedAt);
  const extraStartClockSeconds = (sessionStartClockSeconds + coverageSeconds) % 86400;
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
          <DurationSecondsField
            id="recovery-original-duration"
            label="实际时长"
            value={originalDuration}
            onChange={setOriginalDuration}
            disabled={busy}
            max={recovery.envelopeDurationSeconds}
            unitHint="秒"
            startClockSeconds={sessionStartClockSeconds}
          />
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
            <DurationSecondsField
              id="recovery-extra-duration"
              label="归类时长"
              value={extraDuration}
              onChange={setExtraDuration}
              disabled={busy}
              max={availableExtraSeconds}
              unitHint={`秒（最多 ${availableExtraSeconds}）`}
              startClockSeconds={extraStartClockSeconds}
            />
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
  /*
   * 可单独开始计时的今日任务。已经并进合并组的成员不在此列——它们要整组一起开，
   * 在选择列表里以一张合并条目出现，避免同一件事出现两次。
   */
  const activeTasks = taskViews.todayTasks.filter(
    (task) => task.status === 'active' && task.mergeGroupId === null,
  );
  const [selectedTaskId, setSelectedTaskId] = React.useState(activeTasks[0]?.id ?? null);
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [actualRest, setActualRest] = React.useState(null);
  const [pendingEnergyPrompt, setPendingEnergyPrompt] = React.useState(null);
  const [pendingTaskCheck, setPendingTaskCheck] = React.useState(null);
  const [triageTitle, setTriageTitle] = React.useState('');
  const completedFocusId = React.useRef(null);
  const limitCheckedGroupId = React.useRef(null);
  const selectedTask = activeTasks.find((task) => task.id === selectedTaskId) ?? null;
  const displayTask = timerDisplayTask(activeSession, snapshot.activeTask, selectedTask);
  const displayMergeMembers = timerMergeMembers(snapshot.activeSessionTasks ?? []);

  /*
   * 选中项失效时回退到第一个可选任务。选中的可能是一个合并组（key 形如 `merge:<id>`），
   * 它不在 activeTasks 里，所以要单独认一下——否则刚点中的合并卡会被立刻重置掉。
   */
  const selectableMergeKeys = new Set(
    (taskViews.mergeGroups ?? []).map((group) => `merge:${group.id}`),
  );
  React.useEffect(() => {
    const stillValid = activeTasks.some((task) => task.id === selectedTaskId)
      || selectableMergeKeys.has(selectedTaskId);
    if (!stillValid) setSelectedTaskId(activeTasks[0]?.id ?? null);
  }, [activeTasks, selectedTaskId, taskViews.mergeGroups]);

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
          focusSessionId: activeSession.id,
          source: 'afterFocus',
          taskId: snapshot.activeTask?.id ?? activeSession.taskIds[0] ?? null,
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

  /*
   * 合并轮次的硬上限判定（§3.8 关键规则 6）。放在"响铃之后、展示收尾选择之前"，
   * 而不是 completeFocus 里：响铃那一刻用户还没勾谁做完了，那时判"仍有未完成成员"
   * 会误弹提示。命令本身在未达上限或已全部完成时是 no-op。
   */
  const pendingMergeGroupId = snapshot.pendingBreakMergeGroup?.id ?? null;
  React.useEffect(() => {
    if (pendingMergeGroupId === null || busy) return;
    if (limitCheckedGroupId.current === pendingMergeGroupId) return;
    limitCheckedGroupId.current = pendingMergeGroupId;
    command((time) => markMergeGroupLimitReached({ ...time, mergeGroupId: pendingMergeGroupId }));
  }, [pendingMergeGroupId, busy]);

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
    const completedMergeMembers = timerMergeMembers(snapshot.pendingBreakTasks ?? []);
    // 合并场景下不走单任务的完成确认：成员各自的完成语义（completionSource、
    // validFocusCountAtCompletion）尚未定案，不在这里替产品拍板。
    const completionCheckDue = snapshot.pendingBreakMergeGroup === null
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
                </div>
                <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>
                  已达到当前预估番茄数。这个任务做完了，还是需要继续、调整预估？
                </p>
                <TaskCompletionActions
                  task={completedTask}
                  focusCount={completedTaskFocusCount}
                  busy={busy}
                  onComplete={() => command((time) => completeTaskFromPomodoro({
                    ...time,
                    sessionId: pendingEnergyPrompt.focusSessionId,
                  }))}
                  onReestimate={(estimatedPomodoros) => command((time) => adjustTaskEstimate({
                    ...time, taskId: completedTask.id, estimatedPomodoros,
                  }))}
                />
              </div>
            )}
            {snapshot.pendingBreakMergeGroup && (
              <MergeRoundChoice
                group={snapshot.pendingBreakMergeGroup}
                members={snapshot.pendingBreakTasks ?? []}
                busy={busy}
                command={command}
              />
            )}
            <EnergyPrompt
              key={`${pendingEnergyPrompt.source}:${pendingEnergyPrompt.sessionId}`}
              title={title}
              detail={detail}
              busy={busy}
              onSubmit={submitEnergy(pendingEnergyPrompt.source, pendingEnergyPrompt.sessionId)}
              onSkip={() => setPendingEnergyPrompt(null)}
            />
            <TimerMergeMembers tasks={completedMergeMembers}/>
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

  if (pendingTaskCheck) {
    return (
      <div>
        <div className="main-head">
          <div><h1>计时</h1><div className="sub">{pendingTaskCheck.reason}，先确认一下这个任务的状态。</div></div>
        </div>
        <div style={{ maxWidth: 480, margin: '40px auto' }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="section-h" style={{ marginBottom: 10 }}>
              <h3>{pendingTaskCheck.task.title}</h3>
            </div>
            <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>
              已达到当前预估番茄数。这个任务做完了，还是需要继续、调整预估？
            </p>
            <TaskCompletionActions
              task={pendingTaskCheck.task}
              focusCount={pendingTaskCheck.focusCount}
              busy={busy}
              onComplete={() => command((time) => completeTaskFromPomodoro({
                ...time, sessionId: pendingTaskCheck.focusSessionId,
              })).then((result) => { if (result) setPendingTaskCheck(null); })}
              onReestimate={(estimatedPomodoros) => command((time) => adjustTaskEstimate({
                ...time, taskId: pendingTaskCheck.task.id, estimatedPomodoros,
              })).then((result) => { if (result) setPendingTaskCheck(null); })}
            />
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={busy}
              onClick={() => setPendingTaskCheck(null)}
            >
              稍后再说
            </button>
          </div>
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
                <TaskCompletionActions
                  task={snapshot.pendingBreakTask}
                  focusCount={pendingTaskFocusCount}
                  busy={busy}
                  onComplete={() => command((time) => completeTaskFromPomodoro({
                    ...time, sessionId: snapshot.pendingBreakFocus.id,
                  }))}
                  onReestimate={(estimatedPomodoros) => command((time) => adjustTaskEstimate({
                    ...time, taskId: snapshot.pendingBreakTask.id, estimatedPomodoros,
                  }))}
                />
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
                  })).then((result) => {
                    if (result && completionCheckDue) {
                      setPendingTaskCheck({
                        focusSessionId: snapshot.pendingBreakFocus.id,
                        task: snapshot.pendingBreakTask,
                        focusCount: pendingTaskFocusCount,
                        reason: '短休已跳过',
                      });
                    }
                  })}
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
                && snapshot.pendingBreakMergeGroup === null
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
            {snapshot.pendingBreakMergeGroup && (
              <MergeRoundChoice
                group={snapshot.pendingBreakMergeGroup}
                members={snapshot.pendingBreakTasks ?? []}
                busy={busy}
                command={command}
              />
            )}
            <TimerMergeMembers tasks={timerMergeMembers(snapshot.pendingBreakTasks ?? [])}/>
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
    const startableGroups = (taskViews.mergeGroups ?? []).flatMap((group) => {
      const members = taskViews.mergeGroupMembersById?.[group.id] ?? [];
      // 组内全部做完就没有可开的下一轮了，不再出现在可选列表里。
      return members.some((task) => task.status !== 'completed') ? [{ group, members }] : [];
    });
    const selectedGroupEntry = startableGroups.find(
      ({ group }) => `merge:${group.id}` === selectedTaskId,
    ) ?? null;
    const idleBlockedMessage = standaloneEnergySource !== null
      ? '请先记录能量'
      : selectedTask === null && selectedGroupEntry === null
        ? '请先选择任务'
        : selectedGroupEntry?.group.status === 'limitReached'
          ? '这个合并卡片已达上限'
          : busy
            ? '正在处理'
            : null;
    /*
     * 待机时选中的可能是一个合并组（key 形如 `merge:<id>`），也可能是一个独立任务。
     * 两条启动路径不同：合并组走 startMergeGroupFocus（组整体编号、成员各自快照）。
     */
    const selectedGroup = selectedGroupEntry?.group ?? null;
    const startSelectedFocus = () => {
      if (selectedGroup) {
        return command(
          (time) => startMergeGroupFocus({ ...time, mergeGroupId: selectedGroup.id }),
          (result) => onSessionStarted(result.value.id),
        );
      }
      return selectedTask && command(
        (time) => startFocus({ ...time, taskId: selectedTask.id }),
        (result) => onSessionStarted(result.value.id),
      );
    };
    return (
      <div>
        <div className="main-head">
          <div><h1>计时</h1><div className="sub">开始一个标准 focus，进入「清单」安排今天的任务。</div></div>
        </div>
        <div className="timer-stage">
          <div className="timer-main">
            <div className="timer-task">
              <div className="label">准备开始</div>
              <div className="name">
                {selectedGroupEntry
                  ? `一起做 · ${selectedGroupEntry.members.length} 件小事`
                  : selectedTask?.title ?? '先从今日待办选择任务'}
              </div>
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
            <TimerMergeMembers tasks={selectedGroupEntry?.members ?? []}/>
            <TaskPicker
              tasks={activeTasks}
              mergeGroups={startableGroups}
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
            <div className="name">
              {displayMergeMembers.length > 0
                ? `一起做 · ${displayMergeMembers.length} 件小事`
                : snapshot.activeTask?.title ?? (isFocus ? '专注' : '休息')}
            </div>
          </div>
          <TimerCircle session={activeSession} remaining={remaining}/>
          {isFocus && (
            <TimerRoundDots
              completedFocusCount={snapshot.completedFocusCount}
              longBreakEvery={taskViews.settings.longBreakEvery}
            />
          )}
        </div>
        <aside className="timer-aside">
          {!isFocus && (
            <div className="card" style={{ padding: 18 }}>
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
                        focusSessionId: activeSession.sourceFocusSessionId,
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
                  onClick={() => {
                    const sourceFocusSessionId = activeSession.sourceFocusSessionId;
                    const task = snapshot.activeTask;
                    const focusCount = task
                      ? taskViews.completedValidFocusCountByTaskId[task.id] ?? 0
                      : 0;
                    const checkDue = shouldOfferTaskCompletionCheck(taskViews, task);
                    activeSessionCommand((time) => skipActiveBreak({
                      ...time,
                      sessionId: activeSession.id,
                    })).then((result) => {
                      if (result && checkDue) {
                        setPendingTaskCheck({
                          focusSessionId: sourceFocusSessionId,
                          task,
                          focusCount,
                          reason: '休息已提前结束',
                        });
                      }
                    });
                  }}
                >
                  提前结束休息
                </button>
              )}
            </div>
          )}
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
          <TimerMergeMembers tasks={displayMergeMembers}/>
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
