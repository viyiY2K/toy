// Root app: nav + view router.

const App = () => {
  const [state, setState] = React.useState(() => migratePomoState(INITIAL));
  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem('pomo-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.__v === INITIAL.__v) setState(migratePomoState(parsed));
      }
    } catch(e){}
  }, []);
  React.useEffect(() => {
    try { sessionStorage.setItem('pomo-state', JSON.stringify(state)); } catch(e){}
  }, [state]);

  const setView = (v) => setState(s => ({ ...s, view: v }));

  const reset = () => {
    if (confirm('恢复演示数据？所有改动都会丢失。')) {
      sessionStorage.removeItem('pomo-state');
      setState(migratePomoState(INITIAL));
    }
  };

  const listTaskCount = (state.tasks || []).reduce((a, t) => t.bucket === 'list' ? a + 1 + t.subtasks.length : a, 0);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"/>
          <div>
            番茄
            <small>觉察 · 计划</small>
          </div>
        </div>
        <nav className="nav">
          <NavBtn icon="clock"    label="计时"  active={state.view === 'timer'}      onClick={() => setView('timer')}
            badge={state.timer.running ? fmtMMSS(((state.timer.mode==='focus'?state.settings.focusMin:state.timer.mode==='short'?state.settings.shortMin:state.settings.longMin)*60) - state.timer.elapsed) : null}/>
          <NavBtn icon="list"     label="清单"  active={state.view === 'activities'} onClick={() => setView('activities')}
            badge={listTaskCount || null}/>
          <NavBtn icon="chart"    label="统计"  active={state.view === 'stats'}      onClick={() => setView('stats')}/>
        </nav>
        <div className="sidebar-footer">
          <button className="btn ghost sm" onClick={reset} style={{padding:'4px 0'}}>
            <Icon name="history" size={12}/> 重置演示
          </button>
          <div style={{marginTop:10, fontSize:11, lineHeight:1.6}}>
            <div>
              {(() => {
                const finished = state.log.filter(l => isDonePomoLog(l.kind) || isCancelledPomoLog(l.kind)).length;
                const cur = state.timer.mode === 'focus' ? finished + 1 : finished;
                return <span style={{color:'var(--ink-2)'}}>第 {cur} 个 · 第 {Math.max(1, Math.ceil(cur / 4))} 轮</span>;
              })()}
            </div>
            <div>{state.settings.focusMin}–{state.settings.shortMin} · 长休 {state.settings.longMin}</div>
          </div>
        </div>
      </aside>
      <main className="main">
        {state.view === 'timer'      && <TimerView      state={state} setState={setState}/>}
        {state.view === 'activities' && <ActivitiesView state={state} setState={setState}/>}
        {state.view === 'stats'      && <StatsView      state={state} setState={setState}/>}
      </main>
    </div>
  );
};

const NavBtn = ({ icon, label, active, onClick, badge }) => (
  <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
    <span style={{display:'inline-flex', alignItems:'center', gap:10}}>
      <Icon name={icon} size={15}/> {label}
    </span>
    {badge != null && <span className="badge">{badge}</span>}
  </button>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
