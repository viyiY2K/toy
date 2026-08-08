import {
  detectRecoveryInterval,
  loadCurrentTimerViews,
  isSyncConfigured,
  getAuthState,
  onAuthStateChange,
  requestMagicLink,
  runSync,
  onSyncStateChange,
} from '../data/index';
import { ActivitiesView } from './ActivitiesView';
import { Icon } from './Icon';
import { SettingsView } from './SettingsView';
import { StatsView } from './StatsView';
import { TimerView } from './TimerView';
import { APP_VERSION } from './version';
import { SYNC_POLL_INTERVAL_MS, formatSyncStatusText } from './syncViewModel';
import {
  shouldDetectAppReopened,
  pageForTimerSnapshot,
  shouldPromptOnReturn,
  shouldRecoverAfterHidden,
} from './timerViewModel';

const React = window.React;

function clock() {
  return {
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function NavButton({ icon, label, active = false, disabled = false, badge = null, onClick }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} size={15}/> {label}
      </span>
      {badge != null && <span className="badge">{badge}</span>}
    </button>
  );
}

export function App() {
  const [snapshot, setSnapshot] = React.useState(null);
  const [page, setPage] = React.useState('timer');
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [returnEnergyPrompt, setReturnEnergyPrompt] = React.useState(false);
  const [timerLifecyclePaused, setTimerLifecyclePaused] = React.useState(false);
  const hiddenAt = React.useRef(null);
  const initialLoad = React.useRef(true);
  const runtimeSessionIds = React.useRef(new Set());

  const reload = React.useCallback(async ({ detectSource = null } = {}) => {
    let next = await loadCurrentTimerViews(clock());
    if (
      detectSource !== null
      && shouldDetectAppReopened(
        next.activeSession,
        next.pendingRecovery,
        runtimeSessionIds.current,
      )
    ) {
      await detectRecoveryInterval({ ...clock(), source: detectSource });
      next = await loadCurrentTimerViews(clock());
    }
    setSnapshot(next);
    setPage((currentPage) => pageForTimerSnapshot(currentPage, next.pendingRecovery));
    if (initialLoad.current) {
      if (next.preFocusEnergySource === 'beforeFocus') setReturnEnergyPrompt(true);
      initialLoad.current = false;
    }
  }, []);

  React.useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        setTimerLifecyclePaused(true);
        return;
      }
      const visibleAt = Date.now();
      const hiddenAtMs = hiddenAt.current;
      hiddenAt.current = null;
      if (shouldRecoverAfterHidden(
        snapshot?.activeSession ?? null,
        snapshot?.pendingRecovery ?? null,
        runtimeSessionIds.current,
        hiddenAtMs,
        visibleAt,
      )) {
        setBusy(true);
        setError(null);
        try {
          await detectRecoveryInterval({ ...clock(), source: 'systemRecovered' });
          await reload();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(false);
          setTimerLifecyclePaused(false);
        }
        return;
      }
      const longBreakMinutes = snapshot?.taskViews.settings.longBreakMinutes ?? 15;
      if (shouldPromptOnReturn(hiddenAtMs, visibleAt, longBreakMinutes)) {
        setReturnEnergyPrompt(true);
      }
      setTimerLifecyclePaused(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [reload, snapshot]);

  React.useEffect(() => {
    reload({ detectSource: 'appReopened' })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  }, [reload]);

  // 多端同步（S7）：完全独立于上面的计时器/恢复逻辑，未配置 Supabase 时这整段直接跳过，
  // 不影响纯本地使用。未登录时只订阅登录状态、不发任何同步请求——本地记录的 user_id
  // 靠 auth.uid() 填充，匿名请求写不进任何数据，只会白白触发一次注定失败的网络请求。
  // 登录后：立即同步一次 + 5 分钟轮询；每轮同步跑完后触发 reload() 让刚下载回来的数据
  // 在界面上生效。
  const [syncAuthState, setSyncAuthState] = React.useState({ status: 'unconfigured', email: null });
  const [lastSyncResult, setLastSyncResult] = React.useState(null);
  const [magicLinkEmail, setMagicLinkEmail] = React.useState('');
  const [magicLinkNotice, setMagicLinkNotice] = React.useState(null);

  React.useEffect(() => {
    if (!isSyncConfigured()) return undefined;

    let cancelled = false;
    getAuthState().then((state) => {
      if (!cancelled) setSyncAuthState(state);
    });
    const unsubscribeAuth = onAuthStateChange((state) => setSyncAuthState(state));

    return () => {
      cancelled = true;
      unsubscribeAuth();
    };
  }, []);

  React.useEffect(() => {
    if (syncAuthState.status !== 'authenticated') return undefined;

    const unsubscribeSync = onSyncStateChange((result) => {
      setLastSyncResult(result);
      reload().catch(() => {});
    });

    const triggerSync = () => runSync(clock().now, clock().timezone).catch(() => {});
    triggerSync();
    const intervalId = setInterval(triggerSync, SYNC_POLL_INTERVAL_MS);

    return () => {
      unsubscribeSync();
      clearInterval(intervalId);
    };
  }, [syncAuthState.status, reload]);

  const handleRequestMagicLink = async (event) => {
    event.preventDefault();
    setMagicLinkNotice(null);
    const result = await requestMagicLink(magicLinkEmail.trim());
    setMagicLinkNotice(result.ok ? '登录链接已发送，去邮箱里点一下' : (result.error ?? '发送失败'));
  };

  const runCommand = async (work, onSuccess = null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result !== undefined && onSuccess) onSuccess(result);
      await reload();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const listTaskCount = snapshot?.taskViews.activeTasks.length ?? 0;
  const runningFocusTaskId = snapshot?.activeSession?.type === 'focus'
    && snapshot.activeSession.status === 'active'
    ? snapshot.activeTask?.id ?? null
    : null;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"/>
          <div>
            <span className="brand-title">
              番茄<span className="brand-badge">Beta</span>
              <span className="brand-version">v{APP_VERSION}</span>
            </span>
            <small>觉察 · 计划</small>
          </div>
        </div>
        <nav className="nav">
          <NavButton
            icon="clock"
            label="计时"
            active={page === 'timer'}
            onClick={() => setPage('timer')}
          />
          <NavButton
            icon="list"
            label="清单"
            active={page === 'activities'}
            badge={listTaskCount || null}
            onClick={() => setPage('activities')}
          />
          <NavButton
            icon="chart"
            label="统计"
            active={page === 'stats'}
            onClick={() => setPage('stats')}
          />
          <NavButton
            icon="settings"
            label="设置"
            active={page === 'settings'}
            onClick={() => setPage('settings')}
          />
        </nav>
        <div className="sidebar-footer">
          {snapshot && (
            <div style={{ fontSize: 11, lineHeight: 1.6 }}>
              <div><span style={{ color: 'var(--ink-2)' }}>{snapshot.taskViews.appDate}</span></div>
              <div>
                专注 {snapshot.taskViews.settings.focusMinutes} · 短休 {snapshot.taskViews.settings.shortBreakMinutes} · 长休 {snapshot.taskViews.settings.longBreakMinutes}
              </div>
            </div>
          )}
          {formatSyncStatusText(syncAuthState.status, lastSyncResult) && (
            <div style={{ fontSize: 11, lineHeight: 1.6, marginTop: 8, color: 'var(--ink-2)' }}>
              {formatSyncStatusText(syncAuthState.status, lastSyncResult)}
              {syncAuthState.status === 'authenticated' && syncAuthState.email && (
                <span> · {syncAuthState.email}</span>
              )}
            </div>
          )}
          {syncAuthState.status === 'unauthenticated' && (
            <form onSubmit={handleRequestMagicLink} style={{ marginTop: 8, display: 'flex', gap: 4 }}>
              <input
                type="email"
                required
                placeholder="邮箱登录以同步"
                value={magicLinkEmail}
                onChange={(event) => setMagicLinkEmail(event.target.value)}
                className="input boxed"
                style={{ fontSize: 11, width: 0, flex: 1, minWidth: 0 }}
              />
              <button type="submit" className="btn ghost sm">
                发送
              </button>
            </form>
          )}
          {magicLinkNotice && (
            <div style={{ fontSize: 11, lineHeight: 1.6, marginTop: 4, color: 'var(--ink-2)' }}>
              {magicLinkNotice}
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        {error && <div className="card" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
        {!snapshot ? (
          <div className="loading-note" role="status">正在初始化当前产品日…</div>
        ) : page === 'timer' ? (
          <TimerView
            snapshot={snapshot}
            runCommand={runCommand}
            busy={busy}
            returnEnergyPrompt={returnEnergyPrompt}
            onReturnEnergyRecorded={() => setReturnEnergyPrompt(false)}
            runtimeSessionIds={runtimeSessionIds.current}
            onSessionStarted={(sessionId) => runtimeSessionIds.current.add(sessionId)}
            onRecoveryResolved={(sessionId) => runtimeSessionIds.current.delete(sessionId)}
            timerLifecyclePaused={timerLifecyclePaused}
          />
        ) : page === 'stats' ? (
          <StatsView currentAppDate={snapshot.taskViews.appDate}/>
        ) : page === 'settings' ? (
          <SettingsView
            settings={snapshot.taskViews.settings}
            runCommand={runCommand}
            busy={busy}
          />
        ) : (
          <ActivitiesView
            views={snapshot.taskViews}
            runCommand={runCommand}
            busy={busy}
            runningFocusTaskId={runningFocusTaskId}
          />
        )}
      </main>
    </div>
  );
}
