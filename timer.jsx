// Timer view: focus/break circle, interrupts, early-break flow, post-pomo state log.

const TimerView = ({ state, setState }) => {
  const { timer, settings, urgent, restSuggestions } = state;
  const today = (state.tasks || []).filter((t) => t.bucket === 'today');
  const restPools = restSuggestions || REST_SUGGESTIONS;
  const task = today.find((t) => t.id === timer.currentTaskId);
  const totalSec = (timer.mode === 'focus' ? settings.focusMin :
    timer.mode === 'short' ? settings.shortMin :
    settings.longMin) * 60;
  const remaining = Math.max(0, totalSec - timer.elapsed);
  const progress = timer.elapsed / totalSec;

  const [modal, setModal] = React.useState(null);
  const [pendingEnergy, setPendingEnergy] = React.useState(null);
  const [restPick, setRestPick] = React.useState(null);
  const [actualRest, setActualRest] = React.useState(null);
  const [restPickerOpen, setRestPickerOpen] = React.useState(false);
  const [addingRest, setAddingRest] = React.useState(false);
  const [newRestName, setNewRestName] = React.useState('');
  const [newUrgent, setNewUrgent] = React.useState('');
  const [interruptPulse, setInterruptPulse] = React.useState({ internal: false, external: false });
  const [newSubtaskName, setNewSubtaskName] = React.useState('');
  const [addingSubtask, setAddingSubtask] = React.useState(false);

  // tick
  React.useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => {
      setState((s) => {
        const dur = (s.timer.mode === 'focus' ? s.settings.focusMin :
          s.timer.mode === 'short' ? s.settings.shortMin :
          s.settings.longMin) * 60;
        if (s.timer.elapsed + 1 >= dur) {
          return { ...s, timer: { ...s.timer, elapsed: dur, running: false }, __segmentJustEnded: s.timer.mode };
        }
        return { ...s, timer: { ...s.timer, elapsed: s.timer.elapsed + 1 } };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timer.running]);

  // segment end → open the right modal
  React.useEffect(() => {
    if (state.__segmentJustEnded === 'focus') {
      setModal('state-record');
      setState((s) => { const { __segmentJustEnded, ...rest } = s; return rest; });
    } else if (state.__segmentJustEnded === 'short' || state.__segmentJustEnded === 'long') {
      setModal('rest-recover');
      setState((s) => { const { __segmentJustEnded, ...rest } = s; return rest; });
    }
  }, [state.__segmentJustEnded]);

  // === actions ===
  const toggleRun = () => {
    if (!timer.running) {
      const focusLogs = state.log.filter(l => ['focus-end','focus-early-end','focus-discarded','energy-check','break-end','long-break-end'].includes(l.kind));
      const last = focusLogs[focusLogs.length - 1];
      const nowMin = (() => { const d = new Date(); return d.getHours()*60 + d.getMinutes(); })();
      let needsCheck = false;
      if (!last) needsCheck = true;
      else { const gap = nowMin - hhmmToMin(last.t); if (gap > 60) needsCheck = true; }
      if (needsCheck && timer.mode === 'focus' && timer.elapsed === 0) {
        setPendingEnergy(null);
        setModal('energy-check');
        return;
      }
    }
    setState((s) => ({ ...s, timer: { ...s.timer, running: !s.timer.running,
      sessionStartedAt: s.timer.sessionStartedAt || Date.now() } }));
  };

  const commitEnergyCheck = () => {
    if (pendingEnergy == null) return;
    setState((s) => ({
      ...s,
      log: [...s.log, { t: nowHM(), kind: 'energy-check', energy: pendingEnergy }],
      timer: { ...s.timer, running: true, sessionStartedAt: s.timer.sessionStartedAt || Date.now() }
    }));
    setPendingEnergy(null);
    setModal(null);
  };

  const interrupt = (kind) => {
    if (!task) return;
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === timer.currentTaskId ?
        { ...t, interrupts: { ...t.interrupts, [kind]: t.interrupts[kind] + 1 } } : t),
      log: [...s.log, { t: nowHM(), kind: `interrupt-${kind}`, taskId: timer.currentTaskId }]
    }));
    setInterruptPulse((p) => ({ ...p, [kind]: true }));
    setTimeout(() => setInterruptPulse((p) => ({ ...p, [kind]: false })), 600);
  };

  const skipToEnd = () => {
    setState((s) => ({ ...s, timer: { ...s.timer, elapsed: Math.max(s.timer.elapsed, totalSec - 3) } }));
  };

  // simplified early break: single confirmation modal
  const requestEarlyBreak = () => {
    if (timer.mode !== 'focus') {
      setState((s) => ({ ...s, timer: { ...s.timer, elapsed: totalSec - 2 } }));
      return;
    }
    setState((s) => ({ ...s, timer: { ...s.timer, running: false } }));
    setModal('early-break-confirm');
  };

  const commitDiscardPomo = () => {
    const stamp = nowHM();
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task?.id
        ? {
          ...t,
          cancelledPomos: (t.cancelledPomos || 0) + 1,
          pomoEvents: appendPomoEvent(t, 'cancelled', { t: stamp }),
        } : t),
      timer: { ...s.timer, mode: 'focus', elapsed: 0, running: false },
      log: [...s.log, { t: stamp, kind: 'focus-discarded', taskId: task?.id }]
    }));
    setModal(null);
  };

  // record energy + transition to break (not started) or task-finished
  const commitStateRecord = () => {
    if (pendingEnergy == null) return;
    const stamp = nowHM();
    const updatedCompleted = (task?.completed || 0) + 1;
    const sumEst = (task?.estimates || []).reduce((a, b) => a + b, 0);
    const reachedEst = updatedCompleted >= sumEst;

    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task?.id
        ? {
          ...t,
          completed: updatedCompleted,
          pomoEvents: appendPomoEvent(t, 'done', { t: stamp }),
        } : t),
      log: [...s.log, { t: stamp, kind: 'focus-end', taskId: task?.id, energy: pendingEnergy, dur: settings.focusMin }]
    }));
    setPendingEnergy(null);

    // set up break mode but do NOT auto-start — user clicks to begin
    const goLong = timer.round >= 4;
    setState((s) => ({
      ...s,
      timer: { ...s.timer, mode: goLong ? 'long' : 'short', elapsed: 0, running: false }
    }));
    const pool = restPools[goLong ? 'long' : 'short'];
    setRestPick(pool[Math.floor(Math.random() * pool.length)]);

    if (reachedEst) {
      setModal('task-finished');
    } else {
      setModal(null);
    }
  };

  const commitRecovery = () => {
    if (pendingEnergy == null) return;
    const restName = actualRest || restPick;
    setState((s) => ({
      ...s,
      log: [...s.log, { t: nowHM(), kind: timer.mode === 'long' ? 'long-break-end' : 'break-end',
        energy: pendingEnergy, suggestion: restName,
        suggested: restPick, swapped: actualRest && actualRest !== restPick ? true : false }],
      timer: { ...s.timer, mode: 'focus', elapsed: 0, running: false,
        round: timer.mode === 'long' ? 1 : Math.min(4, s.timer.round + 1) }
    }));
    setPendingEnergy(null);
    setRestPick(null);
    setActualRest(null);
    setRestPickerOpen(false);
    setModal(null);
  };

  const markTaskDone = () => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task?.id
        ? { ...t, status: 'done', finishedAt: nowHM(), completedDate: new Date().toISOString().slice(0,10) } : t)
    }));
    const next = today.find((t) => t.id !== task?.id && t.status === 'active');
    if (next) {
      setState((s) => ({ ...s, timer: { ...s.timer, currentTaskId: next.id, mode: 'focus', elapsed: 0, running: false } }));
    }
    setModal(null);
  };

  // mark done from rest-recover modal (combines task done + proceed to next focus)
  const markDoneFromRest = () => {
    if (pendingEnergy == null) return;
    const restName = actualRest || restPick;
    setState((s) => {
      const next = s.tasks.find(t => t.bucket === 'today' && t.id !== task?.id && t.status === 'active');
      return {
        ...s,
        tasks: s.tasks.map((t) => t.id === task?.id
          ? { ...t, status: 'done', finishedAt: nowHM(), completedDate: new Date().toISOString().slice(0,10) } : t),
        log: [...s.log, { t: nowHM(), kind: timer.mode === 'long' ? 'long-break-end' : 'break-end',
          energy: pendingEnergy, suggestion: restName }],
        timer: { ...s.timer, mode: 'focus', elapsed: 0, running: false,
          round: timer.mode === 'long' ? 1 : Math.min(4, s.timer.round + 1),
          currentTaskId: next?.id || s.timer.currentTaskId }
      };
    });
    setPendingEnergy(null);
    setRestPick(null);
    setActualRest(null);
    setRestPickerOpen(false);
    setModal(null);
  };

  const continueTask = (extra) => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task?.id ? { ...t, estimates: [...t.estimates, extra] } : t)
    }));
    setModal(null);
  };

  const splitTask = () => {
    if (!task) return;
    const stamp = nowHM();
    setState((s) => {
      const t = s.tasks.find((x) => x.id === task.id);
      if (!t) return s;
      const splitName = t.name.endsWith(' | 待拆分') ? t.name : `${t.name} | 待拆分`;
      const listTask = makeTask({
        ...t,
        name: splitName,
        bucket: 'list',
        status: 'active',
        completed: 0,
        cancelledPomos: 0,
        pomoEvents: [],
        interrupts: { internal: 0, external: 0 },
        finishedAt: null,
        completedDate: null,
      });
      const others = s.tasks.filter((x) => x.id !== t.id);
      const next = others.find((x) => x.bucket === 'today' && x.status === 'active');
      return {
        ...s,
        tasks: [...others, listTask],
        log: [...s.log, { t: stamp, kind: 'task-split', taskId: task.id }],
        timer: { ...s.timer, currentTaskId: next?.id || null, elapsed: 0, running: false, mode: 'focus' },
      };
    });
    setModal(null);
  };

  const addUrgent = () => {
    if (!newUrgent.trim()) return;
    setState((s) => ({ ...s, urgent: [...s.urgent, { id: uid(), name: newUrgent.trim() }] }));
    setNewUrgent('');
  };
  const moveUrgent = (id, to) => {
    setState((s) => {
      const item = s.urgent.find((u) => u.id === id);
      if (!item) return s;
      const remaining = s.urgent.filter((u) => u.id !== id);
      if (to === 'today') return { ...s, urgent: remaining, tasks: [...s.tasks, makeTask({ name: item.name, bucket: 'today' })] };
      return { ...s, urgent: remaining };
    });
  };

  // subtask toggle — single source of truth (tasks)
  const toggleSubtask = (stId, checked) => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task?.id ? {
        ...t,
        subtasks: t.subtasks.map((st) =>
          st.id === stId
            ? { ...st, done: checked, doneAt: checked ? (st.doneAt || nowHM()) : null }
            : st
        )
      } : t),
    }));
  };

  const deleteSubtask = (stId) => {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task?.id ? {
        ...t, subtasks: t.subtasks.filter((st) => st.id !== stId)
      } : t)
    }));
  };

  const addSubtask = () => {
    const name = newSubtaskName.trim();
    if (!name || !task) return;
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === task.id ? {
        ...t, subtasks: [...t.subtasks, makeSubtask(name)]
      } : t)
    }));
    setNewSubtaskName('');
    setAddingSubtask(false);
  };

  React.useEffect(() => {
    if (modal === 'rest-recover' && !restPick) {
      const pool = restPools[timer.mode === 'long' ? 'long' : 'short'];
      setRestPick(pool[Math.floor(Math.random() * pool.length)]);
    }
  }, [modal]);

  // === render ===
  const circumference = 2 * Math.PI * 170;
  const dash = circumference * (1 - progress);

  const finishedPomoCount = state.log.filter(l => isDonePomoLog(l.kind) || isCancelledPomoLog(l.kind)).length;
  const currentPomo = timer.mode === 'focus' ? finishedPomoCount + 1 : finishedPomoCount;
  const roundNum = Math.max(1, Math.ceil(currentPomo / 4));
  const posInRound = ((currentPomo - 1) % 4) + 1;

  const activeTasks = today.filter((t) => t.status === 'active');
  const doneTasks = today.filter((t) => t.status === 'done');

  const currentSubtasks = task?.subtasks || [];
  const pendingSubtasks = currentSubtasks.filter(st => !st.done);
  const completedSubtasks = currentSubtasks.filter(st => st.done);

  return (
    <div>
      <div className="main-head">
        <div>
          <h1>计时</h1>
          <div className="sub">第 {currentPomo} 个番茄 · 第 {roundNum} 轮 · {timer.mode === 'focus' ? '专注中' : timer.mode === 'short' ? '短休息' : '长休息'}</div>
        </div>
        <div className="right">
          <button className="btn ghost sm" onClick={skipToEnd} title="演示：跳到段末">
            <Icon name="skip" size={14} /> 跳到段末
          </button>
        </div>
      </div>

      <div className="timer-stage">
        <div className="timer-main">
          <div className="timer-task">
            <div className="label" style={{display:'flex', alignItems:'center', justifyContent:'center', gap:14}}>
              {timer.mode === 'focus' ? (
                <>
                  <span>当前任务</span>
                  {task && (
                    <span style={{display:'inline-flex', alignItems:'center', gap:6, color:'var(--muted)', letterSpacing:0, textTransform:'none'}}
                      title={`预估 ${task.estimates.reduce((a,b)=>a+b,0)} 个番茄 · 已完成 ${task.completed}`}>
                      <span className="mono" style={{fontSize:11}}>{task.completed}/{task.estimates.reduce((a,b)=>a+b,0)}</span>
                      <PomoMarkers estimates={task.estimates} completed={task.completed} cancelled={task.cancelledPomos || 0} events={task.pomoEvents} />
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span>这次试试</span>
                  <button className="break-suggest-shuffle" title="换一个建议"
                    onClick={() => {
                      const pool = restPools[timer.mode === 'long' ? 'long' : 'short'];
                      setRestPick(pool[Math.floor(Math.random() * pool.length)]);
                    }}
                    style={{width:24, height:24}}>
                    <Icon name="shuffle" size={12}/>
                  </button>
                </>
              )}
            </div>
            <div className="name">
              {timer.mode === 'focus'
                ? (task ? task.name : '— 未选择任务 —')
                : (restPick || '休息一下')}
            </div>
          </div>

          <div className="timer-circle" onClick={toggleRun} style={{cursor:'pointer'}}
            title={timer.running ? '点击暂停' : (timer.elapsed === 0 ? '点击开始' : '点击继续')}>
            <svg width="360" height="360" viewBox="0 0 360 360">
              <circle cx="180" cy="180" r="170" fill="none" stroke="var(--line)" strokeWidth="2" />
              <circle cx="180" cy="180" r="170" fill="none"
                stroke={timer.mode === 'focus' ? 'var(--accent)' : 'oklch(0.55 0.07 145)'}
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={dash}
                strokeLinecap="round"
                transform="rotate(-90 180 180)"
                style={{ transition: 'stroke-dashoffset 1s linear' }} />
            </svg>
            <div className="timer-readout">
              <div className="digits">{fmtMMSS(remaining)}</div>
              <div className="mode">{timer.mode === 'focus' ? 'FOCUS' : timer.mode === 'short' ? 'BREAK · 5 MIN' : 'LONG BREAK · 20 MIN'}</div>
              {!timer.running && (
                <div style={{marginTop:10, fontSize:11, color:'var(--muted-2)', letterSpacing:'.1em'}}>
                  {timer.elapsed === 0 ? '点击开始' : '点击继续'}
                </div>
              )}
            </div>
          </div>

          <div className="timer-round-dots">
            {[1, 2, 3, 4].map((n) =>
              <div key={n} className={`d ${n < posInRound ? 'done' : n === posInRound ? 'now' : ''}`} />
            )}
          </div>
        </div>

        {/* === side panel === */}
        <div className="timer-aside">
          <div className="timer-side-actions">
            <button className="side-action" onClick={requestEarlyBreak}
              title={timer.mode === 'focus' ? '提早休息' : '结束休息'}>
              <Icon name="coffee" size={22}/>
            </button>
            <button className={`side-action ${interruptPulse.internal ? 'pulse' : ''}`}
              onClick={() => interrupt('internal')} title="内部打扰（走神 / 自我打断）"
              disabled={!task}>
              <Icon name="brain" size={22}/>
              {(task?.interrupts.internal ?? 0) > 0 && <span className="side-count">{task.interrupts.internal}</span>}
            </button>
            <button className={`side-action ${interruptPulse.external ? 'pulse' : ''}`}
              onClick={() => interrupt('external')} title="外部打扰（消息 / 找人 / 噪音）"
              disabled={!task}>
              <Icon name="bell" size={22}/>
              {(task?.interrupts.external ?? 0) > 0 && <span className="side-count">{task.interrupts.external}</span>}
            </button>
          </div>

          <div className="card urgent-card">
            <div className="card-title">
              <span><Icon name="urgent" size={12} /> &nbsp;计划外紧急</span>
              <span style={{ color: 'var(--muted-2)' }}>{urgent.length > 0 ? `${urgent.length} 条已记录` : '—'}</span>
            </div>
            <div className="urgent-quick-add">
              <input className="input boxed" placeholder="临时冒出来的事，回车记下来…" value={newUrgent}
                onChange={(e) => setNewUrgent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addUrgent()} />
            </div>
            <div style={{fontSize: 11, color: 'var(--muted-2)', marginTop: 6, lineHeight: 1.5}}>
              番茄结束，记得到清单中处理。
            </div>
          </div>

          {/* current task subtasks */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div className="card-title" style={{ marginBottom: 8 }}>
              <span>当前子任务</span>
              {task && (
                <button className="icon-btn" onClick={() => { setAddingSubtask(v => !v); setNewSubtaskName(''); }} title="添加子任务">
                  <Icon name="plus" size={12}/>
                </button>
              )}
            </div>

            {task ? (
              <div className="subtasks-section">
                {pendingSubtasks.map((st) => (
                  <label key={st.id || st.name} className="subtask-item">
                    <input type="checkbox" checked={false}
                      onChange={(e) => toggleSubtask(st.id, e.target.checked)}
                      style={{accentColor: 'var(--accent)'}}/>
                    <span style={{flex:1}}>{st.name || st}</span>
                    <button className="subtask-del-btn"
                      onClick={(e) => { e.preventDefault(); deleteSubtask(st.id); }}
                      title="删除">
                      <Icon name="x" size={11}/>
                    </button>
                  </label>
                ))}
                {addingSubtask && (
                  <input className="input boxed" autoFocus placeholder="新子任务，回车添加…"
                    value={newSubtaskName}
                    onChange={e => setNewSubtaskName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addSubtask();
                      if (e.key === 'Escape') { setAddingSubtask(false); setNewSubtaskName(''); }
                    }}
                    style={{fontSize:12, padding:'4px 8px', marginTop:4}}/>
                )}
                {completedSubtasks.length > 0 && (
                  <div className="subtask-completed-list">
                    {completedSubtasks.map((st) => (
                      <label key={st.id || st.name} className="subtask-completed-item">
                        <input type="checkbox" checked={true}
                          onChange={() => toggleSubtask(st.id, false)}
                          style={{position:'absolute', opacity:0, width:0, height:0}}/>
                        <span className="subtask-completed-name">{st.name || st}</span>
                        {st.doneAt && <span className="mono subtask-completed-time">{st.doneAt}</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty" style={{ padding: '8px 0' }}>先选择一个今日任务。</div>
            )}
          </div>

          {/* 今日待办 card */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div className="card-title" style={{ marginBottom: 8 }}>今日待办</div>

            {activeTasks.length === 0 && doneTasks.length === 0 ? (
              <div className="empty" style={{ padding: '8px 0' }}>今日清单为空。</div>
            ) : (
              <div className="timer-today-list">
                {activeTasks.map((t) => {
                  const est = t.estimates.reduce((a, b) => a + b, 0);
                  const isCurrent = t.id === timer.currentTaskId;
                  return (
                    <button key={t.id}
                      className={`timer-today-item ${isCurrent ? 'current' : ''}`}
                      onClick={() => setState((s) => {
                        const item = s.tasks.find(x => x.id === t.id);
                        const others = s.tasks.filter(x => x.id !== t.id);
                        return { ...s, tasks: [item, ...others],
                          timer: { ...s.timer, currentTaskId: t.id, elapsed: 0, mode: 'focus', running: false } };
                      })}
                      title={isCurrent ? '当前任务' : '切换到该任务（置顶）'}>
                      <span className="timer-today-name">{t.name}</span>
                      <span className="timer-today-pomo mono" style={{display:'inline-flex', alignItems:'center', gap:4}}>
                        <PomoMarkers estimates={t.estimates} completed={t.completed} cancelled={t.cancelledPomos || 0} events={t.pomoEvents}/>
                      </span>
                    </button>
                  );
                })}

                {doneTasks.length > 0 && (
                  <>
                    <div style={{height:1, background:'var(--line)', margin:'4px 0'}}/>
                    {doneTasks.map((t) => (
                      <div key={t.id} className="timer-today-item timer-today-done">
                        <span className="timer-today-name" style={{textDecoration:'line-through', color:'var(--muted-2)'}}>{t.name}</span>
                        <span className="mono" style={{fontSize:10, color:'var(--muted-2)'}}>{t.finishedAt}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === MODALS === */}
      {modal === 'energy-check' &&
        <Modal onClose={() => setModal(null)}>
          <h2>记一下当前的能量</h2>
          <div className="sub">
            {state.log.length === 0 ? '开启今天的第一个番茄前，先感受一下自己。' : '距离上一段过去有一会儿了，先校准一下能量。'}
          </div>
          <div style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>能量状态</div>
          <div style={{ marginTop: 8 }}>
            <Bar10 value={pendingEnergy} onChange={setPendingEnergy} lowLabel="耗尽 / 涣散" highLabel="充满 / 清晰" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
            <button className="btn ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn primary" disabled={pendingEnergy == null} onClick={commitEnergyCheck}>
              开始 <Icon name="arrow-right" size={12} />
            </button>
          </div>
        </Modal>
      }

      {modal === 'state-record' &&
        <Modal onClose={() => {}}>
          <h2>这一段感觉如何？</h2>
          <div className="sub">完成 1 个番茄 · {task?.name}</div>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>能量状态</div>
          <div style={{ marginTop: 8 }}>
            <Bar10 value={pendingEnergy} onChange={setPendingEnergy} lowLabel="耗尽 / 涣散" highLabel="充满 / 清晰" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
            <button className="btn primary" disabled={pendingEnergy == null} onClick={commitStateRecord}>
              开始 {timer.round >= 4 ? '长' : '短'}休息 <Icon name="arrow-right" size={12} />
            </button>
          </div>
        </Modal>
      }

      {modal === 'rest-recover' &&
        <Modal onClose={() => {}}>
          <h2>休息得怎么样？</h2>
          <div className="sub">{timer.mode === 'long' ? '长休息 20 分钟' : '短休息 5 分钟'}</div>
          <div className="rest-suggest">
            <div style={{flex:1}}>
              <div className="label">{actualRest ? '实际做了' : '建议的'}</div>
              <div className="name">{actualRest || restPick}</div>
            </div>
            <button className="btn ghost sm" onClick={() => setRestPickerOpen(v => !v)}>
              {actualRest ? '改一下' : '不是这个'} <Icon name="chevron" size={11}/>
            </button>
          </div>
          {restPickerOpen && (
            <div className="rest-picker">
              {addingRest ? (
                <div className="rest-picker-add">
                  <input className="input boxed" autoFocus
                    placeholder={timer.mode === 'long' ? '新的长休息项目…' : '新的短休息项目…'}
                    value={newRestName}
                    onChange={e => setNewRestName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newRestName.trim()) {
                        const mode = timer.mode === 'long' ? 'long' : 'short';
                        const name = newRestName.trim();
                        setState(s => ({ ...s, restSuggestions: {
                          ...s.restSuggestions,
                          [mode]: [...(s.restSuggestions?.[mode] || REST_SUGGESTIONS[mode]), name],
                        }}));
                        setActualRest(name);
                        setNewRestName('');
                        setAddingRest(false);
                        setRestPickerOpen(false);
                      } else if (e.key === 'Escape') {
                        setAddingRest(false);
                        setNewRestName('');
                      }
                    }}/>
                  <button className="icon-btn" onClick={() => { setAddingRest(false); setNewRestName(''); }}>
                    <Icon name="x" size={13}/>
                  </button>
                </div>
              ) : (
                <button className="rest-picker-item add"
                  onClick={() => setAddingRest(true)} title="添加一个新的休息项目">
                  <Icon name="plus" size={12}/> 添加
                </button>
              )}
              {restPools[timer.mode === 'long' ? 'long' : 'short'].map(name => (
                <button key={name}
                  className={`rest-picker-item ${(actualRest || restPick) === name ? 'on' : ''}`}
                  onClick={() => { setActualRest(name === restPick ? null : name); setRestPickerOpen(false); }}>
                  {name}
                </button>
              ))}
              {actualRest && (
                <button className="rest-picker-item ghost"
                  onClick={() => { setActualRest(null); setRestPickerOpen(false); }}>
                  ↩ 还是用建议的「{restPick}」
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 16 }}>能量状态</div>
          <div style={{ marginTop: 8 }}>
            <Bar10 value={pendingEnergy} onChange={setPendingEnergy} lowLabel="耗尽 / 涣散" highLabel="充满 / 清晰" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 22 }}>
            <button className="btn" disabled={pendingEnergy == null || !task || task.status === 'done'}
              onClick={markDoneFromRest}>
              <Icon name="check" size={12}/> 任务完成
            </button>
            <button className="btn primary" disabled={pendingEnergy == null} onClick={commitRecovery}>
              进入下一段 <Icon name="arrow-right" size={12} />
            </button>
          </div>
        </Modal>
      }

      {modal === 'early-break-confirm' &&
        <Modal onClose={() => { setState(s => ({ ...s, timer: { ...s.timer, running: true } })); setModal(null); }}>
          <h2>结束这个番茄？</h2>
          <div className="sub">作废将记录一个废弃番茄（⛝），计时重置为 {settings.focusMin} 分钟。</div>
          {task && (
            <div style={{margin:'14px 0', padding:'12px 14px', background:'var(--accent-soft)', borderRadius:'var(--r-sm)', fontSize:13}}>
              <PomoMarkers estimates={task.estimates} completed={task.completed} cancelled={(task.cancelledPomos||0)+1} events={appendPomoEvent(task, 'cancelled')}/>
              <span style={{color:'var(--muted)', marginLeft:8, fontSize:12}}>预览作废后的进度</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button className="btn" onClick={() => {
              setState(s => ({ ...s, timer: { ...s.timer, running: true } }));
              setModal(null);
            }}>继续专注</button>
            <button className="btn primary" onClick={commitDiscardPomo}>作废此番茄</button>
          </div>
        </Modal>
      }

      {modal === 'task-finished' && task &&
        <Modal onClose={() => setModal(null)}>
          <h2>预估的番茄都做完了。</h2>
          <div className="sub">{task.name} · 完成 {task.completed} / 预估 {task.estimates.reduce((a, b) => a + b, 0)}</div>
          <p style={{ marginTop: 14, color: 'var(--ink-2)' }}>这件事完成了吗？</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            {task.estimates.length < 3 &&
              <button className="btn" onClick={() => setModal('next-estimate')}>
                没完成，继续
              </button>
            }
            {task.estimates.length >= 3 &&
              <button className="btn" onClick={splitTask} title="任务过大，放回活动清单并标注「待拆分」">
                <Icon name="split" size={12} /> 需要拆分任务
              </button>
            }
            <button className="btn primary" onClick={markTaskDone}>
              <Icon name="check" size={12} /> 任务完成
            </button>
          </div>
        </Modal>
      }

      {modal === 'next-estimate' && task &&
        <NextEstimateModal task={task} onClose={() => setModal(null)} onCommit={(n) => continueTask(n)} />
      }
    </div>
  );
};

const NextEstimateModal = ({ task, onClose, onCommit }) => {
  const [n, setN] = React.useState(1);
  const attempt = task.estimates.length + 1;
  return (
    <Modal onClose={onClose}>
      <h2>第 {attempt} 次预估 还需要几个番茄？</h2>
      <div className="sub">{task.name} · 已完成 {task.completed} 个</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '22px 0' }}>
        <button className="icon-btn" onClick={() => setN(Math.max(1, n - 1))}><Icon name="minus" size={14} /></button>
        <div className="mono" style={{ fontSize: 40, letterSpacing: '-.02em' }}>{n}</div>
        <button className="icon-btn" onClick={() => setN(Math.min(5, n + 1))}><Icon name="plus" size={14} /></button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginBottom: 14 }}>
        将以 {attempt === 2 ? '○●' : '△▲'} 标记本轮番茄 · 这是「低估」记录
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => onCommit(n)}>确认并继续</button>
      </div>
    </Modal>
  );
};

const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

Object.assign(window, { TimerView });
