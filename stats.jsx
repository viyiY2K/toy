// Stats view — date-range tabs (日/周/月/年) + date navigator.

// compute task time range from log
const getTaskTimeRange = (taskId, log) => {
  const sorted = [...log].sort((a, b) => hhmmToMin(a.t) - hhmmToMin(b.t));
  const focusEnds = sorted.filter(l =>
    (l.kind === 'focus-end' || l.kind === 'focus-early-end') && l.taskId === taskId
  );
  if (focusEnds.length === 0) return null;

  const first = focusEnds[0];
  const startMin = hhmmToMin(first.t) - (first.dur || 25);
  const startStr = minToHHMM(Math.max(0, startMin));

  // find break-end immediately after the last focus-end for this task
  let lastFocusIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if ((sorted[i].kind === 'focus-end' || sorted[i].kind === 'focus-early-end') && sorted[i].taskId === taskId) {
      lastFocusIdx = i;
    }
  }
  let endStr = focusEnds[focusEnds.length - 1].t;
  for (let i = lastFocusIdx + 1; i < sorted.length; i++) {
    if (sorted[i].kind === 'break-end' || sorted[i].kind === 'long-break-end') {
      endStr = sorted[i].t;
      break;
    }
  }

  return `${startStr}~${endStr}`;
};

// === Date navigator ===
const DateNav = ({ range, date, onPrev, onNext, onClickDate, pickerOpen, onClosePicker, onSelect }) => {
  const fmtLabel = () => {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    if (range === 'day') {
      return `${y}.${String(m+1).padStart(2,'0')}.${String(d).padStart(2,'0')}`;
    }
    if (range === 'week') {
      const mon = new Date(date); mon.setDate(d - ((date.getDay()+6)%7));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const fmt = (dt) => `${dt.getMonth()+1}.${String(dt.getDate()).padStart(2,'0')}`;
      return `${fmt(mon)}~${fmt(sun)}`;
    }
    if (range === 'month') return `${y}年${m+1}月`;
    return `${y}年`;
  };

  return (
    <div className="date-nav">
      <button className="date-nav-btn" onClick={onPrev}><Icon name="arrow-left" size={13}/></button>
      {range === 'year' ? (
        <span className="date-nav-label static">{fmtLabel()}</span>
      ) : (
        <button className="date-nav-label" onClick={onClickDate}>{fmtLabel()}</button>
      )}
      <button className="date-nav-btn" onClick={onNext}><Icon name="arrow-right" size={13}/></button>
      {range !== 'year' && pickerOpen && (
        <DatePickerPopup date={date} range={range} onSelect={onSelect} onClose={onClosePicker}/>
      )}
    </div>
  );
};

const DatePickerPopup = ({ date, range, onSelect, onClose }) => {
  const [year, setYear] = React.useState(date.getFullYear());
  const [month, setMonth] = React.useState(date.getMonth());
  const [day, setDay] = React.useState(date.getDate());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun

  const confirm = () => {
    if (range === 'year') onSelect(new Date(year, 0, 1));
    else if (range === 'month') onSelect(new Date(year, month, 1));
    else onSelect(new Date(year, month, Math.min(day, daysInMonth)));
    onClose();
  };

  return (
    <div className="date-picker-popup" onClick={e => e.stopPropagation()}>
      {/* year row */}
      <div className="dp-year-row">
        <button className="dp-nav-btn" onClick={() => setYear(y => y - 1)}><Icon name="arrow-left" size={12}/></button>
        <span className="dp-year-label">{year}年</span>
        <button className="dp-nav-btn" onClick={() => setYear(y => y + 1)}><Icon name="arrow-right" size={12}/></button>
      </div>

      {range !== 'year' && (
        <div className="dp-months">
          {Array.from({length:12}).map((_,m) => (
            <button key={m} className={`dp-month ${m === month ? 'on' : ''}`}
              onClick={() => { setMonth(m); if (range === 'month') { onSelect(new Date(year, m, 1)); onClose(); } }}>
              {m+1}月
            </button>
          ))}
        </div>
      )}

      {(range === 'day' || range === 'week') && (
        <>
          <div className="dp-weekdays">
            {['日','一','二','三','四','五','六'].map(wd => (
              <span key={wd} className="dp-wd">{wd}</span>
            ))}
          </div>
          <div className="dp-days">
            {Array.from({length: firstDow}).map((_, i) => <span key={`e${i}`}/>)}
            {Array.from({length: daysInMonth}).map((_, i) => (
              <button key={i} className={`dp-day ${i+1 === day ? 'on' : ''}`}
                onClick={() => setDay(i+1)}>
                {i+1}
              </button>
            ))}
          </div>
        </>
      )}

      {range !== 'month' && (
        <div className="dp-footer">
          <button className="btn ghost sm" onClick={onClose}>取消</button>
          <button className="btn primary sm" onClick={confirm}>确认</button>
        </div>
      )}
    </div>
  );
};

const StatsView = ({ state }) => {
  const [range, setRange] = React.useState('day');
  const [selDate, setSelDate] = React.useState(new Date());
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const { settings, log } = state;
  const today = (state.tasks || []).filter(t => t.bucket === 'today');

  const focusSessions = log.filter(l => l.kind === 'focus-end' || l.kind === 'focus-early-end').length;
  const focusEnded = log.filter(l => l.kind === 'focus-end').length;
  const earlyEnded = log.filter(l => l.kind === 'focus-early-end').length;
  const focusMin = focusEnded * settings.focusMin
    + log.filter(l => l.kind === 'focus-early-end').reduce((a,l) => a + (l.dur||0), 0);
  const pomosToday = Math.floor(focusMin / settings.focusMin);
  const lifetimeTotal = (settings.lifetimePomos || 0) + pomosToday;

  const interrupts = today.reduce((a,t) => ({
    internal: a.internal + t.interrupts.internal,
    external: a.external + t.interrupts.external,
  }), {internal:0, external:0});

  const shiftDate = (dir) => {
    const d = new Date(selDate);
    if (range === 'day')   d.setDate(d.getDate() + dir);
    else if (range === 'week')  d.setDate(d.getDate() + dir * 7);
    else if (range === 'month') d.setMonth(d.getMonth() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    setSelDate(d);
  };

  return (
    <div>
      <div className="main-head stats-head">
        <div className="stats-date-controls">
          <div className="range-tabs">
            {[['day','日'],['week','周'],['month','月'],['year','年']].map(([k, label]) => (
              <button key={k} className={`range-tab ${range === k ? 'on' : ''}`}
                onClick={() => { setRange(k); setPickerOpen(false); }}>
                {label}
              </button>
            ))}
          </div>
          <DateNav range={range} date={selDate}
            onPrev={() => shiftDate(-1)}
            onNext={() => shiftDate(1)}
            onClickDate={() => setPickerOpen(v => !v)}
            pickerOpen={pickerOpen}
            onClosePicker={() => setPickerOpen(false)}
            onSelect={(d) => { setSelDate(d); setPickerOpen(false); }}
          />
        </div>
        <div className="stats-total">
          <h1>累积番茄 <span className="mono" style={{color:'var(--accent-ink)'}}>{lifetimeTotal}</span> 个</h1>
        </div>
        {pickerOpen && (
          <div className="picker-overlay" onClick={() => setPickerOpen(false)}/>
        )}
      </div>

      {range === 'day' && (
        <DailyStats state={state} pomosToday={pomosToday} focusMin={focusMin} focusSessions={focusSessions}
          earlyEnded={earlyEnded} interrupts={interrupts}/>
      )}
      {range === 'week'  && <WeekStats  state={state} />}
      {range === 'month' && <MonthStats state={state} />}
      {range === 'year'  && <YearStats  state={state} />}
    </div>
  );
};

const DailyStats = ({ state, pomosToday, focusMin, focusSessions, earlyEnded, interrupts }) => {
  const { log } = state;
  const today = (state.tasks || []).filter(t => t.bucket === 'today');

  const completed = today.filter(t => t.status === 'done');
  const onTarget = completed.filter(t => {
    const est = t.estimates.reduce((a,b)=>a+b,0);
    return t.estimates.length === 1 && t.completed === est;
  });
  const deviated = completed.filter(t => !onTarget.includes(t));

  return (
    <div>
      <div className="daily-completed-grid">
        <div className="card">
          <div className="card-title">
            <span>预估准确</span>
            <span className="kan-count">{onTarget.length}</span>
          </div>
          {onTarget.length === 0 && <div className="empty">还没有踩准预估的任务。</div>}
          {onTarget.map(t => (
            <CompletedRow key={t.id} task={t} log={log}/>
          ))}
        </div>
        <div className="card">
          <div className="card-title">
            <span>预估偏差</span>
            <span className="kan-count">{deviated.length}</span>
          </div>
          {deviated.length === 0 && <div className="empty">今天的预估都还稳。</div>}
          {deviated.map(t => (
            <CompletedRow key={t.id} task={t} log={log} showDeviation />
          ))}
        </div>
      </div>

      <div className="stat-grid" style={{marginTop: 22}}>
        <div className="stat-card">
          <div className="l">专注次数</div>
          <div className="v">{focusSessions}<span className="unit">次</span></div>
          <div className="delta">含 {earlyEnded} 次提早结束</div>
        </div>
        <div className="stat-card">
          <div className="l">专注时长</div>
          <div className="v">{focusMin}<span className="unit">min</span></div>
          <div className="delta">≈ {(focusMin/60).toFixed(1)} 小时</div>
          <div className="delta">≈ {pomosToday} 个番茄</div>
        </div>
        <div className="stat-card">
          <div className="l">应对打扰</div>
          <div className="v">{interrupts.internal + interrupts.external}<span className="unit">次</span></div>
          <div className="delta">内 {interrupts.internal} · 外 {interrupts.external}</div>
        </div>
        <div className="stat-card">
          <div className="l">本日番茄</div>
          <div className="v">{pomosToday}<span className="unit">个</span></div>
        </div>
      </div>

      <EnergyChart log={log} />

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 18, marginTop: 18}}>
        <RestRecap log={log}/>
        <InterruptDistribution today={today}/>
      </div>
    </div>
  );
};

const CompletedRow = ({ task, log, showDeviation }) => {
  const timeRange = getTaskTimeRange(task.id, log);

  return (
    <div className="completed-row">
      <div>
        <div className="completed-name">{task.name}</div>
        <div className="completed-meta">
          <PomoMarkers estimates={task.estimates} completed={task.completed} cancelled={task.cancelledPomos || 0} events={task.pomoEvents}/>
          <span className="chip"><Icon name="brain" size={10}/> {task.interrupts.internal}</span>
          <span className="chip">
            <Icon name="bell" size={10}/> {task.interrupts.external}
            {timeRange && <span style={{marginLeft:6, color:'var(--muted-2)', fontFamily:'JetBrains Mono,monospace', fontSize:10}}>{timeRange}</span>}
          </span>
        </div>
      </div>
    </div>
  );
};

// === Energy curve — no gap shading ===
const EnergyChart = ({ log }) => {
  const points = log
    .filter(l => l.energy != null && l.t)
    .map(l => ({
      t: hhmmToMin(l.t),
      v: l.energy,
      kind: l.kind === 'focus-end' || l.kind === 'focus-early-end' ? 'focus'
          : l.kind === 'energy-check' ? 'check'
          : 'rest',
    }))
    .sort((a,b) => a.t - b.t);

  // group into segments separated by >60min gaps
  const segments = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0 || points[i].t - points[i-1].t <= 60) {
      cur.push(points[i]);
    } else {
      if (cur.length) segments.push(cur);
      cur = [points[i]];
    }
  }
  if (cur.length) segments.push(cur);

  const W = 800, H = 220, pad = { l: 36, r: 20, t: 20, b: 36 };
  const xMin = points.length ? Math.min(...points.map(p => p.t)) - 30 : 9*60;
  const xMax = points.length ? Math.max(...points.map(p => p.t)) + 30 : 18*60;
  const xScale = (t) => pad.l + (t - xMin) / (xMax - xMin) * (W - pad.l - pad.r);
  const yScale = (v) => H - pad.b - ((v - 1) / 9) * (H - pad.t - pad.b);

  const colorFor = (k) => k === 'focus' ? 'var(--accent)' : k === 'check' ? 'var(--ink-2)' : 'oklch(0.55 0.07 145)';

  return (
    <div className="energy-chart">
      <div className="card-title">
        <span>能量曲线</span>
        <span style={{display:'inline-flex', gap:14, color:'var(--muted)', fontSize:11, letterSpacing:0}}>
          <span><span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'var(--accent)', marginRight:6}}/>专注后</span>
          <span><span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'oklch(0.55 0.07 145)', marginRight:6}}/>休息后</span>
          <span><span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'var(--ink-2)', marginRight:6}}/>校准</span>
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:'block', overflow:'visible'}}>
        {[1,5,10].map(v => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--line)" strokeDasharray="2 3"/>
            <text x={pad.l - 8} y={yScale(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="JetBrains Mono">{v}</text>
          </g>
        ))}
        {Array.from({length: Math.floor((xMax - xMin)/60) + 1}).map((_, i) => {
          const t = Math.floor(xMin/60)*60 + i*60;
          if (t < xMin || t > xMax) return null;
          return (
            <g key={i}>
              <line x1={xScale(t)} x2={xScale(t)} y1={H - pad.b} y2={H - pad.b + 4} stroke="var(--muted-2)"/>
              <text x={xScale(t)} y={H - pad.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="JetBrains Mono">
                {minToHHMM(t)}
              </text>
            </g>
          );
        })}
        {/* lines per segment (no gap shading) */}
        {segments.map((seg, i) => {
          if (seg.length < 2) return null;
          const path = seg.map((p, j) => `${j === 0 ? 'M' : 'L'} ${xScale(p.t)} ${yScale(p.v)}`).join(' ');
          return <path key={`seg-${i}`} d={path} fill="none" stroke="var(--ink-2)" strokeWidth="1.5"/>;
        })}
        {points.map((p, i) => (
          <circle key={i} cx={xScale(p.t)} cy={yScale(p.v)} r="5"
            fill={colorFor(p.kind)} stroke="var(--paper)" strokeWidth="2"/>
        ))}
      </svg>
    </div>
  );
};

const RestRecap = ({ log }) => {
  const sorted = log.filter(l => l.energy != null).slice().sort((a,b) => hhmmToMin(a.t) - hhmmToMin(b.t));
  const rests = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if ((cur.kind === 'break-end' || cur.kind === 'long-break-end') && cur.suggestion) {
      const prev = sorted[i-1];
      const delta = prev ? cur.energy - prev.energy : 0;
      rests.push({ name: cur.suggestion, delta, energy: cur.energy });
    }
  }

  const grouped = {};
  rests.forEach(r => {
    if (!grouped[r.name]) grouped[r.name] = { name: r.name, deltas: [] };
    grouped[r.name].deltas.push(r.delta);
  });
  const items = Object.values(grouped).map(g => ({
    name: g.name,
    avg: g.deltas.reduce((a,b)=>a+b,0) / g.deltas.length,
    count: g.deltas.length,
  })).sort((a,b) => b.avg - a.avg || b.count - a.count);

  return (
    <div className="card">
      <div className="card-title">今日休息回顾</div>
      {items.length === 0 ? (
        <div className="empty">还没记录休息回血。</div>
      ) : (
        <>
          <div style={{fontSize:13, color:'var(--ink-2)', marginBottom:14, lineHeight:1.55}}>
            一共 <span className="mono">{rests.length}</span> 次休息，
            最回血的是 <span style={{color:'var(--accent-ink)'}}>「{items[0].name}」</span>
            <span className="mono" style={{color:'var(--muted)', marginLeft:4}}>
              ({items[0].avg >= 0 ? '+' : ''}{items[0].avg.toFixed(1)})
            </span>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:4}}>
            {items.map(it => {
              const isPos = it.avg > 0, isNeg = it.avg < 0;
              return (
                <div key={it.name} className="recap-row">
                  <span className="recap-name">{it.name}</span>
                  <span className={`recap-delta ${isPos ? 'pos' : isNeg ? 'neg' : ''} mono`}>
                    {isPos ? '+' : ''}{it.avg.toFixed(1)}
                  </span>
                  <span className="mono recap-count">×{it.count}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const InterruptDistribution = ({ today }) => {
  const maxTotal = Math.max(...today.map(x => x.interrupts.internal + x.interrupts.external), 1);
  const withInterrupts = today.filter(t => t.interrupts.internal + t.interrupts.external > 0);
  return (
    <div className="card">
      <div className="card-title">各任务打扰分布</div>
      {withInterrupts.length === 0 && <div className="empty">今天还没记录到打扰。</div>}
      {withInterrupts.map(t => (
        <div key={t.id} style={{padding:'10px 0', borderBottom:'1px dashed var(--line)'}}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13}}>
            <span>{t.name}</span>
            <span style={{color:'var(--muted)'}} className="mono">{t.interrupts.internal} 内 · {t.interrupts.external} 外</span>
          </div>
          <div style={{display:'flex', gap:2, height:6, marginTop:8, borderRadius:3, overflow:'hidden', background:'var(--line-2)'}}>
            <div style={{width: `${(t.interrupts.internal/maxTotal)*100}%`, background:'var(--accent)'}}/>
            <div style={{width: `${(t.interrupts.external/maxTotal)*100}%`, background:'var(--ink-2)'}}/>
          </div>
        </div>
      ))}
    </div>
  );
};

const RangeStats = ({ title, samples, focusUnit }) => {
  const max = Math.max(...samples.map(s => s.pomos), 1);
  const total = samples.reduce((a,s) => a + s.pomos, 0);
  const avg = total / samples.length;
  return (
    <div>
      <div className="stat-grid" style={{marginTop: 6}}>
        <div className="stat-card">
          <div className="l">{title} 总番茄</div>
          <div className="v">{total}<span className="unit">个</span></div>
          <div className="delta">≈ {Math.round(total * 25 / 60)} 小时</div>
        </div>
        <div className="stat-card">
          <div className="l">日均</div>
          <div className="v">{avg.toFixed(1)}<span className="unit">个</span></div>
        </div>
        <div className="stat-card">
          <div className="l">最高单日</div>
          <div className="v">{max}<span className="unit">个</span></div>
        </div>
        <div className="stat-card">
          <div className="l">{focusUnit} 数</div>
          <div className="v">{samples.length}</div>
        </div>
      </div>
      <div className="card" style={{marginTop:22}}>
        <div className="card-title">每{focusUnit}番茄分布</div>
        <div className="bars-chart">
          {samples.map((s, i) => (
            <div key={i} className="bar-col" title={`${s.label} · ${s.pomos} 个`}>
              <div className="bar-track">
                <div className="bar-fill" style={{height: `${(s.pomos / max) * 100}%`}}/>
              </div>
              <div className="bar-label mono">{s.label}</div>
              <div className="bar-num mono">{s.pomos}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const WeekStats = () => {
  const samples = [
    { label: '一', pomos: 6 },{ label: '二', pomos: 9 },{ label: '三', pomos: 8 },
    { label: '四', pomos: 4 },{ label: '五', pomos: 11 },{ label: '六', pomos: 3 },
    { label: '日', pomos: 0 },
  ];
  return <RangeStats title="本周" samples={samples} focusUnit="日"/>;
};
const MonthStats = () => {
  const samples = Array.from({length: 30}, (_, i) => ({
    label: i + 1, pomos: Math.max(0, Math.round(7 + Math.sin(i / 3) * 4 + (i % 7 === 6 ? -4 : 0))),
  }));
  return <RangeStats title="本月" samples={samples} focusUnit="日"/>;
};
const YearStats = () => {
  const samples = ['一','二','三','四','五','六','七','八','九','十','十一','十二']
    .map((m, i) => ({ label: m, pomos: 80 + Math.round(Math.sin(i / 2) * 40) }));
  return <RangeStats title="本年" samples={samples} focusUnit="月"/>;
};

Object.assign(window, { StatsView, RestRecap, EnergyChart });
