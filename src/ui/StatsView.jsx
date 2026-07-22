import { loadStatsDashboard } from '../data/index';
import {
  chartPoints,
  energyTrendPresentation,
  formatDecimal,
  formatDuration,
  formatRatio,
  formatStatsRange,
  shiftStatsAnchor,
  statsHasRangeActivity,
} from './statsViewModel';

const React = window.React;
const RANGE_OPTIONS = [
  { kind: 'day', label: '日' },
  { kind: 'week', label: '周' },
  { kind: 'month', label: '月' },
];

function SummaryCard({ label, value, detail }) {
  return (
    <div className="stat-card">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {detail && <div className="delta">{detail}</div>}
    </div>
  );
}

function Metric({ label, value, detail = null }) {
  return (
    <div className="stats-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function LineChart({ values, labels, emptyLabel, ariaLabel, min = null, max = null }) {
  const width = 600;
  const height = 110;
  let points = chartPoints(values, width, height);
  if (min !== null && max !== null && max > min) {
    points = values.map((value, index) => value === null ? null : ({
      x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
      y: height - ((value - min) / (max - min)) * height,
    }));
  }
  if (points.every((point) => point === null)) {
    return <div className="stats-chart-empty">{emptyLabel}</div>;
  }
  return (
    <div className="stats-line-chart">
      <svg viewBox={`-8 -8 ${width + 16} ${height + 16}`} role="img" aria-label={ariaLabel}>
        <path className="stats-chart-axis" d={`M0 ${height}H${width}`}/>
        {points.slice(1).map((point, index) => {
          const previous = points[index];
          if (point === null || previous === null) return null;
          return <line key={index} className="stats-chart-line" x1={previous.x} y1={previous.y} x2={point.x} y2={point.y}/>;
        })}
        {points.map((point, index) => point && (
          <circle key={index} className="stats-chart-point" cx={point.x} cy={point.y} r="4">
            <title>{labels[index]}：{values[index]}</title>
          </circle>
        ))}
      </svg>
      <div className="stats-chart-labels">
        <span>{labels[0]}</span>
        {labels.length > 1 && <span>{labels[labels.length - 1]}</span>}
      </div>
    </div>
  );
}

function DailyBars({ days }) {
  const maximum = Math.max(1, ...days.map(({ focus, completeCycles }) =>
    Math.max(focus.validPomodoros, completeCycles)));
  // Every date fits fine at day/week granularity, but a month view packs
  // ~30 columns into one row — showing a label under each one collides into
  // an unreadable strip, so thin them out to roughly 8 evenly spaced labels.
  const labelStep = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div className="stats-bars" aria-label="每日有效番茄与完整循环趋势">
      {days.map((day, index) => {
        const showLabel = index % labelStep === 0 || index === days.length - 1;
        return (
          <div className="stats-bar-day" key={day.appDate} title={`${day.appDate}：${day.focus.validPomodoros} 个有效番茄，${day.completeCycles} 个完整循环`}>
            <div className="stats-bar-pair">
              <i className="standard" style={{ height: `${(day.focus.validPomodoros / maximum) * 100}%` }}/>
              <i className="cycle" style={{ height: `${(day.completeCycles / maximum) * 100}%` }}/>
            </div>
            <span>{showLabel ? day.appDate.slice(5) : ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

function Distribution({ rows }) {
  const maximum = Math.max(1, ...rows.map(({ internal, external }) => internal + external));
  return (
    <div className="stats-distribution">
      {rows.map((row) => (
        <div className="stats-distribution-row" key={row.label}>
          <span>{row.label}</span>
          <div className="stats-distribution-track">
            <i className="internal" style={{ width: `${(row.internal / maximum) * 100}%` }}/>
            <i className="external" style={{ width: `${(row.external / maximum) * 100}%` }}/>
          </div>
          <strong>{row.internal + row.external}</strong>
        </div>
      ))}
    </div>
  );
}

function Section({ title, hint = null, children, className = '' }) {
  return (
    <section className={`card stats-section ${className}`}>
      <div className="card-title"><span>{title}</span>{hint && <small>{hint}</small>}</div>
      {children}
    </section>
  );
}

function Dashboard({ stats }) {
  const { session, tasks, completions, estimates, energy, recovery, interrupts, budget } = stats;
  const skippedTotal = Object.values(session.rest.skipped).reduce((sum, count) => sum + count, 0);
  const taskRows = tasks.filter(({ validFocusInRange, totalSeconds }) =>
    validFocusInRange > 0 || totalSeconds > 0);
  const energyTrend = energyTrendPresentation(session.range.kind, energy);
  const interruptValues = interrupts.dailyTrend.map(({ total }) => total);
  const budgetDays = budget.dailyTrend.filter(({ budgetPomodoros, validPomodoros }) =>
    budgetPomodoros !== null || validPomodoros > 0);
  const dateLabels = session.days.map(({ appDate }) => appDate.slice(5));

  return (
    <>
      {!statsHasRangeActivity({
        focusSeconds: session.focus.totalSeconds,
        restSeconds: session.rest.totalRestSeconds,
        completionCount: completions.total,
        interruptCount: interrupts.summary.total,
        energyCount: energy.timeline.length,
      }) && (
        <div className="stats-empty-range" role="status">这个范围还没有专注、休息、能量、打扰或任务完成记录。</div>
      )}

      <div className="stat-grid stats-summary-grid">
        <SummaryCard label="有效标准番茄" value={session.focus.validPomodoros} detail={`完整循环 ${session.completeCycles}`}/>
        <SummaryCard label="区间总专注时长" value={formatDuration(session.focus.totalSeconds)} detail="standard + extra + discarded"/>
        <SummaryCard label="任务完成" value={completions.total} detail={`番茄 ${completions.pomodoro} · 手动 ${completions.manual}`}/>
        <SummaryCard label="累计完整番茄" value={session.lifetime.totalCompleteCycles} detail={`工具内 ${session.lifetime.inToolCompleteCycles} · 基线 ${session.lifetime.baselineCompleteCycles}`}/>
      </div>

      <div className="stats-two-col">
        <Section title="番茄与循环" hint="Session.actualDuration">
          <DailyBars days={session.days}/>
          <div className="stats-legend"><span className="standard">有效番茄</span><span className="cycle">完整循环</span></div>
          <div className="stats-metric-grid">
            <Metric label="标准 focus" value={formatDuration(session.focus.standardSeconds)}/>
            <Metric label="extraFocus" value={formatDuration(session.focus.extraSeconds)}/>
            <Metric label="discarded focus" value={formatDuration(session.focus.discardedSeconds)}/>
            <Metric label="累计专注时长" value={formatDuration(session.lifetime.focusSeconds)} detail="standard + extra + discarded"/>
          </div>
        </Section>

        <Section title="休息事实" hint={`${session.rest.expectedBreaks} 次应休息`}>
          <div className="stats-metric-grid">
            <Metric label="shortBreak" value={formatDuration(session.rest.shortBreakSeconds)} detail={`${session.rest.completedByType.shortBreak}/${session.rest.expectedByType.shortBreak} 完成 · 主动跳过 ${formatRatio(session.rest.shortBreakExplicitSkipRate)}`}/>
            <Metric label="longBreak" value={formatDuration(session.rest.longBreakSeconds)} detail={`${session.rest.completedByType.longBreak}/${session.rest.expectedByType.longBreak} 完成 · 主动跳过 ${formatRatio(session.rest.longBreakExplicitSkipRate)}`}/>
            <Metric label="extraRest" value={formatDuration(session.rest.extraRestSeconds)}/>
            <Metric label="标准休息完成率" value={formatRatio(session.rest.completionRate)} detail={`${session.rest.standardBreakCompleted} 次完成`}/>
          </div>
          <div className="stats-fact-list">
            <span>跳过 <strong>{skippedTotal}</strong></span>
            <span>缺失 <strong>{session.rest.missingBreaks}</strong></span>
            <span>workEnded 豁免 <strong>{session.rest.workEndedExemptions}</strong></span>
          </div>
          <div className="stats-skip-grid">
            <Metric label="主动跳过" value={session.rest.skipped.explicitSkip} detail={formatRatio(session.rest.explicitSkipRate)}/>
            <Metric label="无响应" value={session.rest.skipped.noResponse} detail={formatRatio(session.rest.noResponseRate)}/>
            <Metric label="错过" value={session.rest.skipped.missed} detail={formatRatio(session.rest.missedRate)}/>
            <Metric label="关闭应用" value={session.rest.skipped.appClosed} detail={formatRatio(session.rest.appClosedRate)}/>
          </div>
        </Section>
      </div>

      <div className="stats-two-col">
        <Section title="能量趋势" hint={`${energy.timeline.length} 条记录`}>
          <LineChart
            values={energyTrend.values}
            labels={energyTrend.labels}
            emptyLabel="这个范围还没有能量记录"
            ariaLabel={session.range.kind === 'day' ? '当日全部能量记录趋势' : '每日能量平均趋势'}
            min={1}
            max={10}
          />
          <div className="stats-energy-points">
            {energyTrend.rows.map((row) => (
              <span key={row.key} title={row.detail}>{row.label} · {formatDecimal(row.value)}</span>
            ))}
          </div>
        </Section>

        <Section title="休息恢复" hint="动态派生，不写回 EnergyRecord">
          <div className="stats-metric-grid">
            <Metric label="短休恢复均值" value={formatDecimal(recovery.shortBreak.averageDelta)} detail={`${recovery.shortBreak.validSampleCount}/${recovery.shortBreak.usageCount} 有效样本`}/>
            <Metric label="长休恢复均值" value={formatDecimal(recovery.longBreak.averageDelta)} detail={`${recovery.longBreak.validSampleCount}/${recovery.longBreak.usageCount} 有效样本`}/>
          </div>
          {recovery.samples.length === 0 ? (
            <div className="stats-chart-empty">需要完整的 focus → break 前后能量关联，才能计算 recoveryDelta。</div>
          ) : (
            <div className="stats-recovery-list">
              {recovery.samples.map((sample) => (
                <div key={sample.breakSessionId}>
                  <span>{sample.type === 'shortBreak' ? '短休' : '长休'}</span>
                  <strong>{sample.delta === null ? '样本缺失' : `${sample.delta > 0 ? '+' : ''}${sample.delta}`}</strong>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="stats-two-col">
        <Section title="打扰" hint="仅关联标准 focus">
          <div className="stats-metric-grid">
            <Metric label="内部打扰" value={interrupts.summary.internal}/>
            <Metric label="外部打扰" value={interrupts.summary.external}/>
            <Metric label="每有效番茄" value={formatDecimal(interrupts.summary.perValidPomodoro)}/>
          </div>
          <LineChart
            values={interruptValues}
            labels={dateLabels}
            emptyLabel="这个范围还没有打扰记录"
            ariaLabel="每日打扰数量趋势"
          />
          <Distribution rows={interrupts.timeDistribution}/>
          <div className="stats-legend"><span className="internal">内部</span><span className="external">外部</span></div>
        </Section>

        <Section title="任务结果" hint="manual 不计预估样本">
          <div className="stats-metric-grid">
            <Metric label="预估准确率" value={formatRatio(estimates.accuracyRate)} detail={`${estimates.sampleCount} 个有效样本`}/>
            <Metric label="准确" value={estimates.accurate}/>
            <Metric label="估大" value={estimates.overestimated}/>
            <Metric label="估小" value={estimates.underestimated}/>
            <Metric label="调整后不准" value={estimates.adjustedInaccurate}/>
          </div>
          {taskRows.length === 0 ? (
            <div className="stats-chart-empty">这个范围还没有关联 Task 的专注记录。</div>
          ) : (
            <div className="stats-task-list">
              {taskRows.map((task) => (
                <div key={task.taskId}>
                  <span>{task.title}</span>
                  <strong>{task.validFocusInRange} 番茄 · {formatDuration(task.totalSeconds)}</strong>
                  <small>standard {formatDuration(task.standardSeconds)} · extra {formatDuration(task.extraSeconds)} · discarded {formatDuration(task.discardedSeconds)} · 历史有效番茄 {task.historicalValidFocus}</small>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="每日预算使用" hint="DayPlan.appDate">
        {budgetDays.length === 0 ? (
          <div className="stats-chart-empty">这个范围没有已保存的预算或有效番茄。</div>
        ) : (
          <div className="stats-budget-days">
            {budgetDays.map((day) => (
              <div key={day.appDate}>
                <span>{day.appDate}</span>
                <strong>{day.validPomodoros} / {day.budgetPomodoros === null ? '未设' : day.budgetPomodoros}</strong>
                <small>{formatRatio(day.usageRate)}</small>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export function StatsView({ currentAppDate }) {
  const [kind, setKind] = React.useState('day');
  const [anchorAppDate, setAnchorAppDate] = React.useState(currentAppDate);
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadStatsDashboard({ kind, anchorAppDate })
      .then((result) => {
        if (active) setStats(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [kind, anchorAppDate, retry]);

  return (
    <div className="stats-view">
      <header className="main-head stats-head">
        <div>
          <h1>统计</h1>
          <div className="sub">由 Task、Session、Event、EnergyRecord 与 DayPlan 实时派生</div>
        </div>
        <div className="stats-date-controls">
          <div className="range-tabs" aria-label="统计范围">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.kind}
                className={`range-tab ${kind === option.kind ? 'on' : ''}`}
                aria-pressed={kind === option.kind}
                onClick={() => setKind(option.kind)}
              >{option.label}</button>
            ))}
          </div>
          <div className="date-nav">
            <button className="date-nav-btn" title="上一个范围" aria-label="上一个范围" onClick={() => setAnchorAppDate((value) => shiftStatsAnchor(value, kind, -1))}>‹</button>
            <button className="date-nav-label" title="回到今天" onClick={() => setAnchorAppDate(currentAppDate)}>
              {stats ? formatStatsRange(stats.session.range) : anchorAppDate}
            </button>
            <button className="date-nav-btn" title="下一个范围" aria-label="下一个范围" onClick={() => setAnchorAppDate((value) => shiftStatsAnchor(value, kind, 1))}>›</button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="card stats-load-error" role="alert">
          <span>统计读取失败：{error}</span>
          <button className="btn sm" onClick={() => setRetry((value) => value + 1)}>重试</button>
        </div>
      ) : loading && stats === null ? (
        <div className="empty">正在读取真实统计…</div>
      ) : stats ? (
        <div className={loading ? 'stats-loading' : ''} aria-busy={loading}>
          <Dashboard stats={stats}/>
        </div>
      ) : null}
    </div>
  );
}
