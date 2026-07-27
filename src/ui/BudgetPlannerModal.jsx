import {
  acceptDayPlanBudget,
  addDayPlanDeduction,
  removeDayPlanDeduction,
  updateDayPlanDeduction,
  updateDayPlanWorkWindow,
} from '../data/index';
import { Icon } from './Icon';

const React = window.React;

// 「可用时段」不存起止时间，只存时长；这里固定一个展示锚点，把分钟数换算成钟点给用户输入。
const WORK_WINDOW_DISPLAY_ANCHOR_MIN = 9 * 60;

function minutesToClock(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function DeductionSection({ title, deductionType, deductions, command, busy }) {
  const [label, setLabel] = React.useState('');
  const [hours, setHours] = React.useState('');

  const add = async () => {
    const parsedHours = Number(hours);
    if (!label.trim() || !Number.isFinite(parsedHours) || parsedHours <= 0) return;
    const result = await command((time) => addDayPlanDeduction({
      ...time,
      deductionType,
      label,
      hours: parsedHours,
    }));
    if (result) {
      setLabel('');
      setHours('');
    }
  };

  return (
    <section style={{ marginTop: 16 }}>
      <div className="card-title" style={{ marginBottom: 4 }}>
        <span>{title}</span>
        <span>{deductions.length} 项</span>
      </div>
      {deductions.map((deduction) => (
        <div className="deduction-row" key={deduction.id}>
          <span style={{ fontSize: 13 }}>{deduction.label}</span>
          <input
            key={deduction.hours}
            className="input boxed mono"
            type="number"
            min="0.01"
            step="0.25"
            defaultValue={deduction.hours}
            disabled={busy}
            aria-label={`${deduction.label} 小时`}
            onBlur={(event) => {
              const nextHours = Number(event.currentTarget.value);
              if (!Number.isFinite(nextHours) || nextHours <= 0) {
                event.currentTarget.value = String(deduction.hours);
                return;
              }
              if (nextHours !== deduction.hours) {
                command((time) => updateDayPlanDeduction({
                  ...time,
                  deductionType,
                  deductionId: deduction.id,
                  hours: nextHours,
                }));
              }
            }}
          />
          <button
            className="icon-btn"
            disabled={busy}
            title={`删除${deduction.label}`}
            onClick={() => command((time) => removeDayPlanDeduction({
              ...time,
              deductionType,
              deductionId: deduction.id,
            }))}
          >
            <Icon name="x" size={12}/>
          </button>
        </div>
      ))}
      <div className="deduction-row">
        <input
          className="input boxed"
          value={label}
          disabled={busy}
          placeholder="名称"
          aria-label={`新增${title}名称`}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
        />
        <input
          className="input boxed mono"
          type="number"
          min="0.01"
          step="0.25"
          value={hours}
          disabled={busy}
          placeholder="小时"
          aria-label={`新增${title}小时`}
          onChange={(event) => setHours(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
        />
        <button
          className="icon-btn"
          disabled={busy || !label.trim() || !(Number(hours) > 0)}
          title={`添加${title}`}
          onClick={add}
        >
          <Icon name="plus" size={12}/>
        </button>
      </div>
    </section>
  );
}

function WorkWindowRangeInput({ workWindowMin, command, busy }) {
  const derivedStart = minutesToClock(WORK_WINDOW_DISPLAY_ANCHOR_MIN);
  const derivedEnd = minutesToClock(WORK_WINDOW_DISPLAY_ANCHOR_MIN + workWindowMin);
  const [start, setStart] = React.useState(derivedStart);
  const [end, setEnd] = React.useState(derivedEnd);

  React.useEffect(() => {
    setStart(derivedStart);
    setEnd(derivedEnd);
  }, [derivedStart, derivedEnd]);

  const commit = (nextStart, nextEnd) => {
    const startMin = clockToMinutes(nextStart);
    const endMin = clockToMinutes(nextEnd);
    if (startMin === null || endMin === null) {
      setStart(derivedStart);
      setEnd(derivedEnd);
      return;
    }
    const nextWorkWindowMin = Math.max(0, endMin - startMin);
    if (nextWorkWindowMin !== workWindowMin) {
      command((time) => updateDayPlanWorkWindow({ ...time, workWindowMin: nextWorkWindowMin }));
    }
  };

  return (
    <div className="planner-row">
      <label className="planner-l" style={{ flexShrink: 0 }} htmlFor="work-window-start">可用时段</label>
      <input
        id="work-window-start"
        className="input boxed mono"
        type="time"
        value={start}
        disabled={busy}
        onChange={(event) => setStart(event.target.value)}
        onBlur={() => commit(start, end)}
      />
      <span className="planner-eq">到</span>
      <input
        id="work-window-end"
        aria-label="可用时段结束"
        className="input boxed mono"
        type="time"
        value={end}
        disabled={busy}
        onChange={(event) => setEnd(event.target.value)}
        onBlur={() => commit(start, end)}
      />
      <span className="planner-eq" style={{ marginLeft: 'auto' }}>共 {workWindowMin} 分钟</span>
    </div>
  );
}

export function BudgetPlannerModal({ dayPlan, command, busy, onClose }) {
  const { estimate } = dayPlan;
  // 保守 / 乐观 / 手动 是「今日预算」的三个来源，收成三选一；确认后统一套用并关闭。
  const [selectedMode, setSelectedMode] = React.useState(dayPlan.budgetMode ?? 'conservative');
  const [manualBudget, setManualBudget] = React.useState(
    dayPlan.budgetMode === 'manual' ? String(dayPlan.budgetPomodoros) : '',
  );

  const manualValue = Number(manualBudget);
  const manualValid = manualBudget.trim() !== ''
    && Number.isInteger(manualValue) && manualValue >= 0;
  const resolvedPomodoros = selectedMode === 'conservative'
    ? estimate.conservativePomodoros
    : selectedMode === 'optimistic'
      ? estimate.optimisticPomodoros
      : (manualValid ? manualValue : null);

  const confirm = async () => {
    if (busy || resolvedPomodoros === null) return;
    const result = await command((time) => acceptDayPlanBudget({
      ...time,
      budgetMode: selectedMode,
      budgetPomodoros: resolvedPomodoros,
    }));
    if (result) onClose();
  };

  return (
    <div className="modal-bg" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="budget-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h2 id="budget-title">今日预算估算</h2>
            <div className="sub">按当前产品日的设置快照计算；扣除项修改后立即保存。</div>
          </div>
          <button className="icon-btn" disabled={busy} title="关闭预算估算" onClick={onClose}>
            <Icon name="x" size={14}/>
          </button>
        </div>

        <WorkWindowRangeInput
          workWindowMin={estimate.workWindowMin}
          command={command}
          busy={busy}
        />

        <DeductionSection
          title="固定日程"
          deductionType="fixed"
          deductions={estimate.fixedDeductions}
          command={command}
          busy={busy}
        />

        <div className="budget-free">
          <span className="budget-free-v mono">{estimate.freeMin}<span className="unit">分钟</span></span>
          <span className="budget-free-l">自由时长（可用时段减去扣除）</span>
        </div>

        <div className="section-h" style={{ marginBottom: 8 }}>
          <h3>今日预算</h3>
          <span className="count">选一个来源</span>
        </div>
        <div className="budget-choice-grid" role="radiogroup" aria-label="今日预算来源">
          <button
            type="button"
            role="radio"
            aria-checked={selectedMode === 'conservative'}
            className={`budget-choice ${selectedMode === 'conservative' ? 'on' : ''}`}
            disabled={busy}
            onClick={() => setSelectedMode('conservative')}
          >
            <span className="budget-choice-l">保守</span>
            <span className="budget-choice-v mono">
              {estimate.conservativePomodoros}<span className="unit">个</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={selectedMode === 'optimistic'}
            className={`budget-choice ${selectedMode === 'optimistic' ? 'on' : ''}`}
            disabled={busy}
            onClick={() => setSelectedMode('optimistic')}
          >
            <span className="budget-choice-l">乐观</span>
            <span className="budget-choice-v mono">
              {estimate.optimisticPomodoros}<span className="unit">个</span>
            </span>
          </button>
          <div
            className={`budget-choice budget-choice-manual ${selectedMode === 'manual' ? 'on' : ''}`}
            onClick={() => setSelectedMode('manual')}
          >
            <span className="budget-choice-l">手动</span>
            <span className="budget-choice-v mono">
              <input
                className="budget-choice-input mono"
                type="number"
                min="0"
                step="1"
                value={manualBudget}
                disabled={busy}
                placeholder="—"
                aria-label="手动预算番茄数"
                onFocus={() => setSelectedMode('manual')}
                onChange={(event) => setManualBudget(event.target.value)}
              />
              <span className="unit">个</span>
            </span>
          </div>
        </div>

        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
          disabled={busy || resolvedPomodoros === null}
          onClick={confirm}
        >
          确认今日预算
        </button>
      </div>
    </div>
  );
}
