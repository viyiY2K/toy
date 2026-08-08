import { runSync, updateLifetimePomodoroBaseline, updateTimerSetting } from '../data/index';
import { formatSyncStatusText, hasSyncErrors } from './syncViewModel';

const React = window.React;

const LONG_BREAK_OPTIONS = [15, 20, 30];

function clock() {
  return {
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function MinutesField({ label, field, value, min, max, command, busy }) {
  const commit = (event) => {
    const next = Number(event.currentTarget.value);
    if (!Number.isInteger(next) || next < min || next > max || next === value) {
      event.currentTarget.value = String(value);
      return;
    }
    command((time) => updateTimerSetting({ ...time, field, value: next }));
  };
  return (
    <div className="planner-row">
      <label className="planner-l" htmlFor={`settings-${field}`}>{label}</label>
      <input
        id={`settings-${field}`}
        key={value}
        className="input boxed mono"
        type="number"
        min={min}
        max={max}
        step="1"
        defaultValue={value}
        disabled={busy}
        style={{ width: 80 }}
        onBlur={commit}
      />
      <span className="planner-eq">分钟（{min}–{max}）</span>
    </div>
  );
}

function LongBreakField({ value, command, busy }) {
  return (
    <div className="planner-row">
      <span className="planner-l">长休时长</span>
      <div className="range-tabs" role="radiogroup" aria-label="长休时长">
        {LONG_BREAK_OPTIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            role="radio"
            aria-checked={value === minutes}
            className={`range-tab ${value === minutes ? 'on' : ''}`}
            disabled={busy}
            onClick={() => {
              if (minutes === value) return;
              command((time) => updateTimerSetting({ ...time, field: 'longBreakMinutes', value: minutes }));
            }}
          >{minutes}</button>
        ))}
      </div>
      <span className="planner-eq">分钟</span>
    </div>
  );
}

function BaselineField({ value, command, busy }) {
  const [draft, setDraft] = React.useState(String(value));

  React.useEffect(() => setDraft(String(value)), [value]);

  const draftValue = Number(draft);
  const draftValid = draft.trim() !== '' && Number.isInteger(draftValue) && draftValue >= 0;
  const changed = draftValid && draftValue !== value;

  const confirm = () => {
    if (!changed || busy) return;
    command((time) => updateLifetimePomodoroBaseline({ ...time, value: draftValue }));
  };

  return (
    <div className="planner-row">
      <label className="planner-l" htmlFor="settings-baseline">累计基数</label>
      <input
        id="settings-baseline"
        className="input boxed mono"
        type="number"
        min="0"
        step="1"
        value={draft}
        disabled={busy}
        style={{ width: 100 }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && confirm()}
      />
      <span className="planner-eq">个完整番茄</span>
      <button
        className="btn sm"
        style={{ marginLeft: 'auto' }}
        disabled={busy || !changed}
        onClick={confirm}
      >确认修改</button>
    </div>
  );
}

function SyncCard({ syncAuthState, lastSyncResult }) {
  const [manualState, setManualState] = React.useState('idle'); // idle | syncing | done | error

  if (!syncAuthState || syncAuthState.status === 'unconfigured') return null;

  const handleManualSync = async () => {
    setManualState('syncing');
    try {
      const result = await runSync(clock().now, clock().timezone);
      setManualState(!result.configured || hasSyncErrors(result) ? 'error' : 'done');
    } catch {
      setManualState('error');
    }
  };

  const authenticated = syncAuthState.status === 'authenticated';
  const statusText = formatSyncStatusText(syncAuthState.status, lastSyncResult);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title"><span>多端同步</span></div>
      <div className="sub" style={{ marginBottom: 12 }}>
        {statusText}
        {authenticated && syncAuthState.email ? ` · ${syncAuthState.email}` : ''}
      </div>
      {authenticated ? (
        <div className="planner-row">
          <button
            className="btn sm"
            disabled={manualState === 'syncing'}
            onClick={handleManualSync}
          >{manualState === 'syncing' ? '同步中…' : '立即同步'}</button>
          {manualState === 'done' && <span className="planner-eq">刚刚同步完成</span>}
          {manualState === 'error' && <span className="planner-eq">同步时遇到问题，稍后会自动重试</span>}
        </div>
      ) : (
        <div className="sub">先在左侧边栏输入邮箱登录，才能手动触发同步。</div>
      )}
    </div>
  );
}

export function SettingsView({ settings, runCommand, busy, syncAuthState, lastSyncResult }) {
  const command = (work) => runCommand(() => work(clock()));

  return (
    <div className="settings-view">
      <header className="main-head">
        <div>
          <h1>设置</h1>
          <div className="sub">调整计时参数，或校正累计番茄基数。</div>
        </div>
      </header>

      <div className="card">
        <div className="card-title"><span>计时参数</span></div>
        <MinutesField
          label="专注时长" field="focusMinutes" value={settings.focusMinutes}
          min={5} max={120} command={command} busy={busy}
        />
        <MinutesField
          label="短休时长" field="shortBreakMinutes" value={settings.shortBreakMinutes}
          min={1} max={30} command={command} busy={busy}
        />
        <LongBreakField value={settings.longBreakMinutes} command={command} busy={busy}/>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title"><span>累计番茄基数</span></div>
        <div className="sub" style={{ marginBottom: 12 }}>
          如果你从其他工具带来了历史番茄记录，可以在这里手动校正累计展示基数；不会补录任何专注记录。
        </div>
        <BaselineField value={settings.lifetimePomodoroBaseline} command={command} busy={busy}/>
      </div>

      <SyncCard syncAuthState={syncAuthState} lastSyncResult={lastSyncResult}/>
    </div>
  );
}
