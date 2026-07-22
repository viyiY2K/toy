import { detectRecoveryInterval, loadCurrentTimerViews } from '../data/index';
import { ActivitiesView } from './ActivitiesView';
import { Icon } from './Icon';
import { StatsView } from './StatsView';
import { TimerView } from './TimerView';
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
  const [page, setPage] = React.useState('activities');
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
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"/>
          <div>番茄<small>觉察 · 计划</small></div>
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
        </nav>
        <div className="sidebar-footer">
          <button className="btn ghost sm" disabled style={{ padding: '4px 0' }}>
            Phase 1 数据层
          </button>
          {snapshot && (
            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6 }}>
              <div><span style={{ color: 'var(--ink-2)' }}>{snapshot.taskViews.appDate}</span></div>
              <div>
                {snapshot.taskViews.settings.focusMinutes}–{snapshot.taskViews.settings.shortBreakMinutes} · 长休 {snapshot.taskViews.settings.longBreakMinutes}
              </div>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        {error && <div className="card" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
        {!snapshot ? (
          <div className="empty">正在初始化当前产品日…</div>
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
        ) : (
          <ActivitiesView views={snapshot.taskViews} runCommand={runCommand} busy={busy}/>
        )}
      </main>
    </div>
  );
}
