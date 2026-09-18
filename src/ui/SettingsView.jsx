import {
  getBackupPreferences,
  getCalendarPreferences,
  isGoogleCalendarConfigured,
  peekCalendarQueue,
  MAX_BACKUP_INTERVAL_MINUTES,
  MIN_BACKUP_INTERVAL_MINUTES,
  parseLocalBackup,
  requestMagicLink,
  runSync,
  updateLifetimePomodoroBaseline,
  updateTimerSetting,
} from '../data/index';
import {
  clearPickedBackupDirectory,
  exportBackupToUserFile,
  pickBackupDirectory,
  restoreBackupFromText,
  runAutoBackupOnce,
  setAutoBackupEnabled,
  setAutoBackupIntervalMinutes,
  subscribeBackupRuntime,
} from './backupRuntime';
import {
  canPickBackupDirectory,
  formatBackupStatus,
  suggestedManualBackupFileName,
} from './backupViewModel';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  retryGoogleCalendarWrites,
  setGoogleCalendarWriteEnabled,
  subscribeGoogleCalendarRuntime,
} from './googleCalendarRuntime';
import { formatGoogleCalendarQueue, formatGoogleCalendarStatus } from './googleCalendarViewModel';
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

function LoginForm() {
  const [email, setEmail] = React.useState('');
  const [notice, setNotice] = React.useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setNotice(null);
    const result = await requestMagicLink(email.trim());
    setNotice(result.ok ? '登录链接已发送，去邮箱里点一下' : (result.error ?? '发送失败'));
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="planner-row">
        <input
          type="email"
          required
          placeholder="邮箱登录以同步"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="input boxed"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn sm">发送登录链接</button>
      </form>
      {notice && <div className="sub" style={{ marginTop: 8 }}>{notice}</div>}
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
      </div>
      {authenticated ? (
        <div className="planner-row sync-account-row">
          <input
            type="email"
            aria-label="当前同步邮箱"
            className="input boxed"
            value={syncAuthState.email ?? ''}
            readOnly
          />
          <button
            className="btn sm"
            disabled={manualState === 'syncing'}
            onClick={handleManualSync}
          >{manualState === 'syncing' ? '同步中…' : '立即同步'}</button>
          {manualState === 'done' && <span className="planner-eq sync-result" aria-live="polite">刚刚同步完成</span>}
          {manualState === 'error' && <span className="planner-eq sync-result" role="alert">同步时遇到问题，稍后会自动重试</span>}
        </div>
      ) : (
        <LoginForm/>
      )}
    </div>
  );
}

function BackupCard({ busy, runCommand }) {
  const [prefs, setPrefs] = React.useState(() => getBackupPreferences());
  const [notice, setNotice] = React.useState(null);
  const [confirmingImport, setConfirmingImport] = React.useState(false);
  const [backupBusy, setBackupBusy] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const canPickDirectory = canPickBackupDirectory();
  const locked = busy || backupBusy;

  React.useEffect(() => subscribeBackupRuntime(setPrefs), []);

  const runBackup = async (work) => {
    if (locked) return;
    setBackupBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      if (cause && cause.name === 'AbortError') return;
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBackupBusy(false);
      setPrefs(getBackupPreferences());
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title"><span>本地备份</span></div>
      <div className="sub" style={{ marginBottom: 12 }}>
        数据只存在当前这个浏览器。导出一份文件后，换浏览器、换电脑或清理站点数据时可以再导回来。
      </div>

      <div className="backup-actions">
        <button
          type="button"
          className="btn sm"
          disabled={locked}
          onClick={() => runBackup(async () => {
            const outcome = await exportBackupToUserFile(suggestedManualBackupFileName());
            if (outcome !== 'cancelled') setNotice('已导出当前数据');
          })}
        >导出数据</button>
        <button
          type="button"
          className="btn sm"
          disabled={locked}
          onClick={() => {
            setConfirmingImport(false);
            fileInputRef.current?.click();
          }}
        >从备份恢复</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            runBackup(async () => {
              const jsonText = await file.text();
              parseLocalBackup(jsonText);
              setConfirmingImport({ jsonText, name: file.name });
            });
          }}
        />
      </div>

      {confirmingImport && (
        <div className="backup-confirm" role="alert">
          <div>恢复「{confirmingImport.name}」会覆盖当前浏览器里的全部数据，而且不能撤销。</div>
          <div className="backup-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn sm danger"
              disabled={locked}
              onClick={() => runBackup(async () => {
                const result = await runCommand(() => restoreBackupFromText(confirmingImport.jsonText));
                if (!result) return;
                setConfirmingImport(false);
                setNotice('已从备份恢复');
              })}
            >确认覆盖</button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={locked}
              onClick={() => setConfirmingImport(false)}
            >取消</button>
          </div>
        </div>
      )}

      <div className="planner-row" style={{ marginTop: 12 }}>
        <span className="planner-l">自动备份</span>
        <div className="range-tabs" role="radiogroup" aria-label="自动备份">
          <button
            type="button"
            role="radio"
            aria-checked={!prefs.enabled}
            className={`range-tab ${prefs.enabled ? '' : 'on'}`}
            disabled={locked || !canPickDirectory}
            onClick={() => {
              if (!prefs.enabled) return;
              setAutoBackupEnabled(false);
              setPrefs(getBackupPreferences());
            }}
          >关闭</button>
          <button
            type="button"
            role="radio"
            aria-checked={prefs.enabled}
            className={`range-tab ${prefs.enabled ? 'on' : ''}`}
            disabled={locked || !canPickDirectory}
            onClick={() => runBackup(async () => {
              if (!prefs.directoryName) await pickBackupDirectory();
              else setAutoBackupEnabled(true);
              setPrefs(getBackupPreferences());
            })}
          >开启</button>
        </div>
      </div>

      <div className="planner-row">
        <label className="planner-l" htmlFor="settings-backup-interval">备份间隔</label>
        <input
          id="settings-backup-interval"
          key={prefs.intervalMinutes}
          className="input boxed mono"
          type="number"
          min={MIN_BACKUP_INTERVAL_MINUTES}
          max={MAX_BACKUP_INTERVAL_MINUTES}
          step="1"
          defaultValue={prefs.intervalMinutes}
          disabled={locked || !canPickDirectory}
          style={{ width: 80 }}
          onBlur={(event) => {
            const next = Number(event.currentTarget.value);
            if (
              !Number.isInteger(next)
              || next < MIN_BACKUP_INTERVAL_MINUTES
              || next > MAX_BACKUP_INTERVAL_MINUTES
              || next === prefs.intervalMinutes
            ) {
              event.currentTarget.value = String(prefs.intervalMinutes);
              return;
            }
            setAutoBackupIntervalMinutes(next);
            setPrefs(getBackupPreferences());
          }}
        />
        <span className="planner-eq">分钟（{MIN_BACKUP_INTERVAL_MINUTES}–{MAX_BACKUP_INTERVAL_MINUTES}）</span>
      </div>

      <div className="planner-row">
        <span className="planner-l">备份文件夹</span>
        <span className="planner-eq" style={{ flex: 1 }}>
          {prefs.directoryName ? `当前：${prefs.directoryName}` : '还没选择'}
        </span>
        <button
          type="button"
          className="btn sm"
          disabled={locked || !canPickDirectory}
          onClick={() => runBackup(async () => {
            await pickBackupDirectory();
            setPrefs(getBackupPreferences());
          })}
        >选择文件夹</button>
        {prefs.directoryName && (
          <button
            type="button"
            className="btn sm ghost"
            disabled={locked}
            onClick={() => runBackup(async () => {
              await clearPickedBackupDirectory();
              setPrefs(getBackupPreferences());
            })}
          >清除</button>
        )}
      </div>

      {prefs.enabled && prefs.directoryName && (
        <div className="backup-actions">
          <button
            type="button"
            className="btn sm"
            disabled={locked}
            onClick={() => runBackup(async () => {
              const result = await runAutoBackupOnce();
              setPrefs(getBackupPreferences());
              if (result.ok) setNotice('已写入自动备份文件');
            })}
          >立即备份到该文件夹</button>
        </div>
      )}

      <div className="sub" style={{ marginTop: 12 }}>
        <div>{formatBackupStatus(prefs, { canPickDirectory })}</div>
        {canPickDirectory && (
          <div style={{ marginTop: 6 }}>
            自动备份会覆盖文件夹里的同一份文件；想留存某一刻的副本，请用上面的导出。
          </div>
        )}
      </div>
      {notice && <div className="sub" style={{ marginTop: 8 }}>{notice}</div>}
    </div>
  );
}

function GoogleCalendarCard() {
  const configured = isGoogleCalendarConfigured();
  const [prefs, setPrefs] = React.useState(() => getCalendarPreferences());
  const [queueLength, setQueueLength] = React.useState(() => peekCalendarQueue().length);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);

  React.useEffect(() => subscribeGoogleCalendarRuntime((next) => {
    setPrefs(next);
    setQueueLength(peekCalendarQueue().length);
  }), []);

  const run = async (work) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setPrefs(getCalendarPreferences());
      setQueueLength(peekCalendarQueue().length);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title"><span>Google 日历</span></div>
      <div className="sub" style={{ marginBottom: 12 }}>
        连上之后，每次专注结束或中途作废，都会按每件事的实际投入时间写入专用日历「番茄专注」。休息不写，合并番茄也不会写成一整块。
      </div>

      <div className="backup-actions">
        {prefs.connected ? (
          <>
            {(prefs.lastError || queueLength > 0) && (
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => run(retryGoogleCalendarWrites)}
              >立即重试</button>
            )}
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy}
              onClick={() => run(disconnectGoogleCalendar)}
            >断开</button>
          </>
        ) : (
          <button
            type="button"
            className="btn sm"
            disabled={busy || !configured}
            onClick={() => run(connectGoogleCalendar)}
          >连接 Google 日历</button>
        )}
      </div>

      {prefs.connected && (
        <div className="planner-row" style={{ marginTop: 12 }}>
          <span className="planner-l">结束后写入</span>
          <div className="range-tabs" role="radiogroup" aria-label="结束后写入日历">
            <button
              type="button"
              role="radio"
              aria-checked={!prefs.enabled}
              className={`range-tab ${prefs.enabled ? '' : 'on'}`}
              disabled={busy}
              onClick={() => setGoogleCalendarWriteEnabled(false)}
            >暂停</button>
            <button
              type="button"
              role="radio"
              aria-checked={prefs.enabled}
              className={`range-tab ${prefs.enabled ? 'on' : ''}`}
              disabled={busy}
              onClick={() => setGoogleCalendarWriteEnabled(true)}
            >自动写</button>
          </div>
        </div>
      )}

      <div className="sub" style={{ marginTop: 12 }}>
        <div>{formatGoogleCalendarStatus(prefs, { configured })}</div>
        {formatGoogleCalendarQueue(queueLength) && (
          <div style={{ marginTop: 6 }}>{formatGoogleCalendarQueue(queueLength)}</div>
        )}
      </div>
      {notice && <div className="sub" style={{ marginTop: 8 }}>{notice}</div>}
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
          <div className="sub">调整计时参数，校正累计番茄基数，备份本地数据，或把专注写入 Google 日历。</div>
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

      <BackupCard busy={busy} runCommand={runCommand}/>

      <GoogleCalendarCard/>
    </div>
  );
}
