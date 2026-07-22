import {
  acceptDayPlanBudget,
  addDayPlanDeduction,
  removeDayPlanDeduction,
  updateDayPlanDeduction,
  updateDayPlanWorkWindow,
} from '../data/index';
import { Icon } from './Icon';

const React = window.React;

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

export function BudgetPlannerModal({ dayPlan, command, busy, onClose }) {
  const [manualBudget, setManualBudget] = React.useState(
    dayPlan.budgetMode === 'manual' ? String(dayPlan.budgetPomodoros) : '',
  );
  const { estimate } = dayPlan;

  const accept = async (budgetMode, budgetPomodoros) => {
    const result = await command((time) => acceptDayPlanBudget({
      ...time,
      budgetMode,
      budgetPomodoros,
    }));
    if (result) onClose();
  };

  return (
    <div className="modal-bg" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="budget-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 id="budget-title">今日预算估算</h2>
            <div className="sub">按当前产品日的设置快照计算；扣除项修改后立即保存。</div>
          </div>
          <button className="icon-btn" disabled={busy} title="关闭预算估算" onClick={onClose}>
            <Icon name="x" size={14}/>
          </button>
        </div>

        <div className="planner-row">
          <label className="planner-l" htmlFor="work-window-min">可用时段</label>
          <input
            id="work-window-min"
            key={estimate.workWindowMin}
            className="input boxed mono"
            style={{ width: 110 }}
            type="number"
            min="0"
            step="1"
            defaultValue={estimate.workWindowMin}
            disabled={busy}
            onBlur={(event) => {
              const workWindowMin = Number(event.currentTarget.value);
              if (!Number.isInteger(workWindowMin) || workWindowMin < 0) {
                event.currentTarget.value = String(estimate.workWindowMin);
                return;
              }
              if (workWindowMin !== estimate.workWindowMin) {
                command((time) => updateDayPlanWorkWindow({ ...time, workWindowMin }));
              }
            }}
          />
          <span className="planner-eq">分钟</span>
        </div>

        <DeductionSection
          title="固定日程"
          deductionType="fixed"
          deductions={estimate.fixedDeductions}
          command={command}
          busy={busy}
        />
        <DeductionSection
          title="生活时间"
          deductionType="life"
          deductions={estimate.lifeDeductions}
          command={command}
          busy={busy}
        />

        <div className="budget-summary">
          <div className="stat">
            <div className="v">{estimate.freeMin}<span className="unit">分钟</span></div>
            <div className="l">自由时长</div>
          </div>
          <div className="stat">
            <div className="v">{estimate.conservativePomodoros}<span className="unit">个</span></div>
            <div className="l">保守估算</div>
          </div>
          <div className="stat">
            <div className="v">{estimate.optimisticPomodoros}<span className="unit">个</span></div>
            <div className="l">乐观估算</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={busy}
            onClick={() => accept('conservative', estimate.conservativePomodoros)}
          >
            采用保守 {estimate.conservativePomodoros}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => accept('optimistic', estimate.optimisticPomodoros)}
          >
            采用乐观 {estimate.optimisticPomodoros}
          </button>
        </div>
        <div className="planner-row" style={{ marginTop: 8 }}>
          <label className="planner-l" htmlFor="manual-budget">手动预算</label>
          <input
            id="manual-budget"
            className="input boxed mono"
            style={{ width: 110 }}
            type="number"
            min="0"
            step="1"
            value={manualBudget}
            disabled={busy}
            onChange={(event) => setManualBudget(event.target.value)}
          />
          <button
            className="btn primary sm"
            disabled={
              busy
              || manualBudget.trim() === ''
              || !Number.isInteger(Number(manualBudget))
              || Number(manualBudget) < 0
            }
            onClick={() => accept('manual', Number(manualBudget))}
          >
            确认手动预算
          </button>
        </div>
      </div>
    </div>
  );
}
