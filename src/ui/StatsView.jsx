import { loadStatsDashboard } from '../data/index';
import {
  chartPoints,
  durationParts,
  energyTrendPresentation,
  formatDecimal,
  formatDuration,
  formatRatio,
  formatStatsRange,
  shiftStatsAnchor,
  statsHasRangeActivity,
  timerSettingChangeNotice,
} from './statsViewModel';

const React = window.React;
const RANGE_OPTIONS = [
  { kind: 'day', label: '日' },
  { kind: 'week', label: '周' },
  { kind: 'month', label: '月' },
];

// 数字走 mono 主字号，单位降一档灰字——否则「0 分钟」里的「分钟」
// 在 46px 的 KPI 卡里比卡片标签还抢眼，一页几十个时长全在喊。
function Duration({ seconds }) {
  return (
    <>
      {durationParts(seconds).map(({ value, unit }) => (
        <span className="duration-part" key={unit}>{value}<span className="unit">{unit}</span></span>
      ))}
    </>
  );
}

function SummaryCard({ label, value, detail }) {
  return (
    <div className="stat-card">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {detail && <div className="delta">{detail}</div>}
    </div>
  );
}

// 明细区统一用这一种行式排版：名目在左、数值右对齐、补充说明缩在名目下面。
// 原先的 2×2 田字格把每个数字装进带边框的方格里，五张卡各来一套，
// 整页读起来像五张挨着的表格——密度没降下来，节奏全靠边框硬切。
function Rows({ children }) {
  return <div className="stats-rows">{children}</div>;
}

function Row({ label, value, detail = null, title = null }) {
  return (
    <div className="stats-row" title={title ?? undefined}>
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
  // 逐日趋势图在日视图里退化成「一根柱 / 一个点」，除了占版面没有任何信息；
  // 反过来，日内能量点在周/月视图里是 7~31 个芯片，和上面那条折线讲同一件事。
  // 所以按范围只画对这个范围成立的那张图。
  const isDay = session.range.kind === 'day';
  const settingChangeNotice = timerSettingChangeNotice(session.range.kind, session.timerSettingChanges);

  return (
    <>
      {!statsHasRangeActivity({
        focusSeconds: session.focus.totalSeconds,
        restSeconds: session.rest.totalRestSeconds,
        completionCount: completions.total,
        interruptCount: interrupts.summary.total,
        energyCount: energy.timeline.length,
      }) && (
        <div className="stats-empty-range" role="status">这段时间还没有可统计的活动。</div>
      )}

      {settingChangeNotice && (
        <div className="stats-notice" role="note">
          <div className="stats-notice-lines">
            {settingChangeNotice.lines.map((line, index) => <div key={index}>{line}</div>)}
          </div>
          <div className="stats-notice-caveat">{settingChangeNotice.caveat}</div>
        </div>
      )}

      <div className="stat-grid stats-summary-grid">
        <SummaryCard label="有效番茄" value={session.focus.validPomodoros} detail={`完整循环 ${session.completeCycles}`}/>
        <SummaryCard label="总专注时长" value={<Duration seconds={session.focus.totalSeconds}/>} detail="含加时与中途作废"/>
        <SummaryCard label="任务完成" value={completions.total} detail={`番茄 ${completions.pomodoro} · 手动 ${completions.manual}`}/>
        <SummaryCard label="累计完整番茄" value={session.lifetime.totalCompleteCycles} detail={`本工具 ${session.lifetime.inToolCompleteCycles} · 之前累计 ${session.lifetime.baselineCompleteCycles}`}/>
      </div>

      {/* 第二层：趋势。这一页 3 秒内要回答的是「我这段时间怎么样」，
          能回答它的只有概览数字和这两张图，所以它们独占一层、保持主卡片质感。 */}
      <div className={`stats-two-col ${isDay ? 'stats-trend-solo' : ''}`}>
        {!isDay && (
          <Section title="番茄与循环" hint="每日有效番茄与完整循环">
            <DailyBars days={session.days}/>
            <div className="stats-legend"><span className="standard">有效番茄</span><span className="cycle">完整循环</span></div>
          </Section>
        )}

        <Section title="能量趋势" hint={`${energy.timeline.length} 条记录`}>
          <LineChart
            values={energyTrend.values}
            labels={energyTrend.labels}
            emptyLabel="这段时间还没有能量记录"
            ariaLabel={isDay ? '当日全部能量记录趋势' : '每日能量平均趋势'}
            min={1}
            max={10}
          />
          {isDay && (
            <div className="stats-energy-points">
              {energyTrend.rows.map((row) => (
                <span key={row.key} title={row.detail}>{row.label} · {formatDecimal(row.value)}</span>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* 第三层：明细。数字一个不少，但整体降一级——去掉纸面底色与投影，
          只留发丝边框，读作「想细看时再看」而不是和上面平起平坐。 */}
      <h2 className="stats-group-head">明细</h2>

      <div className="stats-two-col stats-detail-grid">
        <Section className="stats-section--muted" title="专注构成" hint="按实际计时时长">
          <Rows>
            <Row label="标准番茄" value={<Duration seconds={session.focus.standardSeconds}/>}/>
            <Row label="加时专注" value={<Duration seconds={session.focus.extraSeconds}/>}/>
            <Row label="中途作废" value={<Duration seconds={session.focus.discardedSeconds}/>}/>
            <Row label="累计专注时长" value={<Duration seconds={session.lifetime.focusSeconds}/>} detail="含加时与中途作废"/>
          </Rows>
        </Section>

        <Section className="stats-section--muted" title="休息" hint={`应休息 ${session.rest.expectedBreaks} 次`}>
          <Rows>
            <Row label="短休" value={<Duration seconds={session.rest.shortBreakSeconds}/>} detail={`${session.rest.completedByType.shortBreak}/${session.rest.expectedByType.shortBreak} 完成 · 主动跳过 ${formatRatio(session.rest.shortBreakExplicitSkipRate)}`}/>
            <Row label="长休" value={<Duration seconds={session.rest.longBreakSeconds}/>} detail={`${session.rest.completedByType.longBreak}/${session.rest.expectedByType.longBreak} 完成 · 主动跳过 ${formatRatio(session.rest.longBreakExplicitSkipRate)}`}/>
            <Row label="额外休息" value={<Duration seconds={session.rest.extraRestSeconds}/>}/>
            <Row label="标准休息完成率" value={formatRatio(session.rest.completionRate)} detail={`${session.rest.standardBreakCompleted} 次完成`}/>
            <Row
              label="跳过"
              value={skippedTotal}
              detail={`主动 ${session.rest.skipped.explicitSkip} · 没理提醒 ${session.rest.skipped.noResponse} · 错过 ${session.rest.skipped.missed} · 关闭应用 ${session.rest.skipped.appClosed}`}
              title={`占跳过的比例：主动 ${formatRatio(session.rest.explicitSkipRate)} · 没理提醒 ${formatRatio(session.rest.noResponseRate)} · 错过 ${formatRatio(session.rest.missedRate)} · 关闭应用 ${formatRatio(session.rest.appClosedRate)}`}
            />
            <Row label="未收尾" value={session.rest.missingBreaks}/>
            <Row label="收工免休" value={session.rest.workEndedExemptions}/>
          </Rows>
        </Section>

        <Section className="stats-section--muted" title="休息恢复" hint="按休息前后的能量记录计算">
          <Rows>
            <Row label="短休恢复均值" value={formatDecimal(recovery.shortBreak.averageDelta)} detail={`${recovery.shortBreak.validSampleCount}/${recovery.shortBreak.usageCount} 有效样本`}/>
            <Row label="长休恢复均值" value={formatDecimal(recovery.longBreak.averageDelta)} detail={`${recovery.longBreak.validSampleCount}/${recovery.longBreak.usageCount} 有效样本`}/>
          </Rows>
          {recovery.samples.length === 0 ? (
            <div className="stats-chart-empty">休息前后各要有一次能量记录，才能算出恢复了多少。</div>
          ) : (
            <div className="stats-recovery-list">
              <p className="stats-sub-head">逐次恢复</p>
              {recovery.samples.map((sample) => (
                <div key={sample.breakSessionId}>
                  <span>{sample.type === 'shortBreak' ? '短休' : '长休'}</span>
                  <strong>{sample.delta === null ? '缺记录' : `${sample.delta > 0 ? '+' : ''}${sample.delta}`}</strong>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section className="stats-section--muted" title="打扰" hint="只统计标准番茄内发生的">
          <Rows>
            <Row label="内部打扰" value={interrupts.summary.internal}/>
            <Row label="外部打扰" value={interrupts.summary.external}/>
            <Row label="每个有效番茄平均" value={formatDecimal(interrupts.summary.perValidPomodoro)}/>
          </Rows>
          {!isDay && (
            <LineChart
              values={interruptValues}
              labels={dateLabels}
              emptyLabel="这段时间还没有打扰记录"
              ariaLabel="每日打扰数量趋势"
            />
          )}
          <Distribution rows={interrupts.timeDistribution}/>
          <div className="stats-legend"><span className="internal">内部</span><span className="external">外部</span></div>
        </Section>

        <Section className="stats-section--muted" title="任务结果" hint="手动完成的任务不计入准确率">
          <Rows>
            <Row
              label="预估准确率"
              value={formatRatio(estimates.accuracyRate)}
              detail={`准确 ${estimates.accurate} · 估大 ${estimates.overestimated} · 估小 ${estimates.underestimated}`}
            />
            <Row label="有效样本" value={estimates.sampleCount}/>
            <Row label="改过预估仍不准" value={estimates.adjustedInaccurate}/>
          </Rows>
          {taskRows.length === 0 ? (
            <div className="stats-chart-empty">这段时间还没有归到具体任务的专注记录。</div>
          ) : (
            <div className="stats-task-list">
              <p className="stats-sub-head">这段时间的任务</p>
              {taskRows.map((task) => (
                <div key={task.taskId}>
                  <span>{task.title}</span>
                  <strong>{task.validFocusInRange} 番茄 · {formatDuration(task.totalSeconds)}</strong>
                  <small>标准 {formatDuration(task.standardSeconds)} · 加时 {formatDuration(task.extraSeconds)} · 作废 {formatDuration(task.discardedSeconds)} · 历史有效番茄 {task.historicalValidFocus}</small>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section className="stats-section--muted" title="预算使用" hint={isDay ? null : '每天一行'}>
          {budgetDays.length === 0 ? (
            <div className="stats-chart-empty">这段时间没有设过预算，也没有有效番茄。</div>
          ) : isDay ? (
            <Rows>
              {budgetDays.map((day) => (
                <Row
                  key={day.appDate}
                  label={day.appDate}
                  value={`${day.validPomodoros} / ${day.budgetPomodoros === null ? '未设' : day.budgetPomodoros}`}
                  detail={`用掉 ${formatRatio(day.usageRate)}`}
                />
              ))}
            </Rows>
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
      </div>
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
          <div className="sub">来看看你种下的番茄吧。</div>
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
        <div className="loading-note" role="status">正在读取…</div>
      ) : stats ? (
        <div className={loading ? 'stats-loading' : ''} aria-busy={loading}>
          <Dashboard stats={stats}/>
        </div>
      ) : null}
    </div>
  );
}
