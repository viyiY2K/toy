import {
  addTaskToToday,
  adjustTaskEstimate,
  archiveCompletedTask,
  batchAddTasksToToday,
  batchArchiveCompletedTasks,
  batchMoveTasksToList,
  completeTaskManually,
  createManualTask,
  deleteActiveTask,
  dismissTriageTask,
  estimateDayPlanBudget,
  moveTriageTaskToList,
  moveTriageTaskToToday,
  promoteSubtaskToTopLevel,
  removeTaskFromToday,
  reorderActivityTask,
  reorderSubtask,
  reorderTodayTask,
  restoreArchivedTask,
  uncompleteTask,
  updateTaskTitle,
} from '../data/index';
import { Icon } from './Icon';
import { BudgetPlannerModal } from './BudgetPlannerModal';
import { TaskDetailModal } from './TaskDetailModal';
import {
  activityReorderPayload,
  archivedTaskPresentation,
  batchCandidates,
  batchResultPresentation,
  batchRetryIds,
  canReorderSubtasks,
  completionSourceLabel,
  currentPlanMetrics,
  dayPlanIndexOf,
  reconcileBatchSelection,
  splitLineagePresentation,
  splitTodayTasks,
  unattachedSubtasks,
} from './taskViewModel';

const React = window.React;

function EditableTitle({ task, onSave, disabled = false }) {
  const [editing, setEditing] = React.useState(false);
  if (editing && !disabled) {
    return (
      <input
        className="input today-name-input"
        autoFocus
        defaultValue={task.title}
        onBlur={(event) => {
          const title = event.target.value.trim();
          if (title && title !== task.title) onSave(title);
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      className="atr-name today-name-text editable-title-button"
      disabled={disabled}
      title="编辑任务标题"
      onClick={() => setEditing(true)}
    >
      {task.title}
    </button>
  );
}

function EstimateEditor({ task, onSave, disabled }) {
  const [editing, setEditing] = React.useState(false);
  const locked = disabled || task.status !== 'active' || task.estimateRounds.length >= 3;
  if (editing && !locked) {
    return (
      <input
        className="mono today-est-input"
        type="number"
        min="1"
        max="7"
        autoFocus
        defaultValue={task.estimatedPomodoros}
        onBlur={(event) => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value >= 1 && value <= 7 && value !== task.estimatedPomodoros) {
            onSave(value);
          }
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      className={`mono today-est-num-btn ${locked ? 'locked' : ''}`}
      disabled={locked}
      title={locked ? '当前阶段不可再调整预估' : '点击调整总预估（1–7）'}
      onClick={() => setEditing(true)}
    >
      {task.estimatedPomodoros}
    </button>
  );
}

function AddTaskInput({ placeholder, onCreate, disabled }) {
  const [title, setTitle] = React.useState('');
  const submit = async () => {
    const value = title.trim();
    if (!value || disabled) return;
    await onCreate(value);
    setTitle('');
  };
  return (
    <div className="activity-tree-row atr-group" style={{ marginTop: 8 }}>
      <span className="atr-bullet"/>
      <input
        className="input atr-input"
        value={title}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && submit()}
      />
      <button className="icon-btn" disabled={disabled || !title.trim()} onClick={submit} title="新建任务">
        <Icon name="plus" size={13}/>
      </button>
    </div>
  );
}

function SubtaskRow({
  task,
  siblings,
  index,
  busy,
  command,
  onOpen,
  allowReorder,
  batchAction,
  selectedBatchIds,
  onToggleBatch,
}) {
  const active = task.status === 'active' || task.status === 'splitNeeded';
  const completed = task.status === 'completed';
  const batchSelectable = batchAction === 'archiveCompleted' && completed;
  return (
    <div className={`activity-tree-row atr-item ${completed ? 'is-completed' : ''}`}>
      {batchSelectable ? (
        <input
          className="batch-checkbox"
          type="checkbox"
          aria-label={`选择 ${task.title}`}
          checked={selectedBatchIds.has(task.id)}
          disabled={busy}
          onChange={() => onToggleBatch(task.id)}
        />
      ) : (
        <button
          className={`atr-check ${completed ? 'is-done' : ''}`}
          disabled={busy}
          title={active ? '完成子任务' : '取消完成'}
          onClick={() => active
            ? command((time) => completeTaskManually({ ...time, taskId: task.id }))
            : command((time) => uncompleteTask({ ...time, taskId: task.id }))}
        />
      )}
      <EditableTitle
        task={task}
        disabled={busy}
        onSave={(title) => command((time) => updateTaskTitle({
          ...time, taskId: task.id, title,
        }))}
      />
      <span className="atr-actions subtask-actions">
        {allowReorder && (
          <>
            <button
              className="icon-btn text-icon"
              disabled={busy || index === 0}
              title="上移子任务"
              onClick={() => command((time) => reorderSubtask({
                ...time, parentId: task.parentId, fromIndex: index, toIndex: index - 1,
              }))}
            >↑</button>
            <button
              className="icon-btn text-icon"
              disabled={busy || index === siblings.length - 1}
              title="下移子任务"
              onClick={() => command((time) => reorderSubtask({
                ...time, parentId: task.parentId, fromIndex: index, toIndex: index + 1,
              }))}
            >↓</button>
          </>
        )}
        <button className="icon-btn text-icon" disabled={busy} title="任务详情" onClick={() => onOpen(task.id)}>···</button>
        {active && (
          <>
            <button
              className="icon-btn text-icon"
              disabled={busy}
              title="升级为顶层任务"
              onClick={() => command((time) => promoteSubtaskToTopLevel({
                ...time, taskId: task.id,
              }))}
            >↤</button>
            <button
              className="icon-btn"
              disabled={busy}
              title="软删除子任务"
              onClick={() => command((time) => deleteActiveTask({ ...time, taskId: task.id }))}
            ><Icon name="x" size={11}/></button>
          </>
        )}
        {completed && (
          <button
            className="icon-btn text-icon"
            disabled={busy}
            title="归档子任务"
            onClick={() => command((time) => archiveCompletedTask({ ...time, taskId: task.id }))}
          >归</button>
        )}
      </span>
    </div>
  );
}

function SubtaskList({
  tasks,
  busy,
  command,
  onOpen,
  allowReorder,
  batchAction,
  selectedBatchIds,
  onToggleBatch,
}) {
  if (!tasks?.length) return null;
  return (
    <div className="task-subtree">
      {tasks.map((task, index) => (
        <SubtaskRow
          key={task.id}
          task={task}
          siblings={tasks}
          index={index}
          busy={busy}
          command={command}
          onOpen={onOpen}
          allowReorder={allowReorder}
          batchAction={batchAction}
          selectedBatchIds={selectedBatchIds}
          onToggleBatch={onToggleBatch}
        />
      ))}
    </div>
  );
}

export function ActivitiesView({ views, runCommand, busy }) {
  const [plannerOpen, setPlannerOpen] = React.useState(false);
  const [archiveCandidateId, setArchiveCandidateId] = React.useState(null);
  const [detailTaskId, setDetailTaskId] = React.useState(null);
  const [batchAction, setBatchAction] = React.useState(null);
  const [selectedBatchIds, setSelectedBatchIds] = React.useState(() => new Set());
  const [batchResult, setBatchResult] = React.useState(null);
  const { activeTasks: activeToday, completedTasks: completedToday } = splitTodayTasks(views.todayTasks);
  const metrics = currentPlanMetrics(views.dayPlan, views.todayPlanningCapacityRemaining);
  const detachedChildren = unattachedSubtasks(views);
  const detachedGroups = detachedChildren.reduce((groups, task) => {
    (groups[task.parentId] ??= []).push(task);
    return groups;
  }, {});
  const allChildren = Object.values(views.subtasksByParentId).flat();
  const allTaskRecords = [
    ...views.activeTasks,
    ...views.todayTasks,
    ...views.completedTasks,
    ...allChildren,
    ...views.archivedTasks,
  ].filter((task, index, tasks) => tasks.findIndex(({ id }) => id === task.id) === index);
  const detailTask = allTaskRecords.find((task) => task.id === detailTaskId) ?? null;

  const clock = () => ({
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const command = (work) => runCommand(() => work(clock()));
  const batchTasks = batchCandidates(views, batchAction);
  const archiveBatchTasks = batchCandidates(views, 'archiveCompleted');
  const batchCandidateKey = batchTasks.map(({ id }) => id).join('|');
  const batchPresentation = batchResult
    ? batchResultPresentation(batchResult, allTaskRecords)
    : null;
  const batchLabels = {
    addToToday: '批量加入今日',
    moveToList: '批量移回活动清单',
    archiveCompleted: '批量归档已完成',
  };
  const beginBatch = (action) => {
    setBatchAction(action);
    setSelectedBatchIds(new Set());
    setBatchResult(null);
  };
  const cancelBatch = () => {
    setBatchAction(null);
    setSelectedBatchIds(new Set());
    setBatchResult(null);
  };
  const toggleBatchTask = (taskId) => {
    setSelectedBatchIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };
  React.useEffect(() => {
    setSelectedBatchIds((current) => {
      const reconciled = reconcileBatchSelection([...current], batchTasks);
      if (reconciled.length === current.size && reconciled.every((id) => current.has(id))) {
        return current;
      }
      return new Set(reconciled);
    });
  }, [batchAction, batchCandidateKey]);
  const executeBatch = async () => {
    const taskIds = reconcileBatchSelection([...selectedBatchIds], batchTasks);
    if (taskIds.length === 0) return;
    const result = await command((time) => {
      const input = { ...time, taskIds };
      if (batchAction === 'addToToday') return batchAddTasksToToday(input);
      if (batchAction === 'moveToList') return batchMoveTasksToList(input);
      return batchArchiveCompletedTasks(input);
    });
    if (!result) return;
    setBatchResult(result);
    setSelectedBatchIds(new Set(batchRetryIds(result)));
  };
  const batchCheckbox = (task) => batchAction && batchTasks.some(({ id }) => id === task.id) ? (
    <input
      className="batch-checkbox"
      type="checkbox"
      aria-label={`选择 ${task.title}`}
      checked={selectedBatchIds.has(task.id)}
      disabled={busy}
      onChange={() => toggleBatchTask(task.id)}
    />
  ) : <span className="atr-bullet"/>;

  const parseDrag = (event) => {
    try { return JSON.parse(event.dataTransfer.getData('application/json')); }
    catch { return null; }
  };
  const setDrag = (event, value) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify(value));
  };

  return (
    <div>
      <div className="main-head">
        <div>
          <h1>清单与计划</h1>
          <div className="sub">在活动清单里整理想法，移到今日待办后开始番茄。</div>
        </div>
        <div className="right" style={{ gap: 20 }}>
          <div className="bb-stat" style={{ textAlign: 'right' }}>
            <div className="bb-l">自由时长</div>
            <div className="bb-v" style={{ color: 'var(--accent-ink)', fontSize: 18 }}>
              {metrics.freeHours.toFixed(1)}<span className="unit">h</span>
            </div>
          </div>
          <div className="bb-divider"/>
          <div className="bb-stat" style={{ textAlign: 'right' }}>
            <div className="bb-l">番茄预算</div>
            <div className="bb-v" style={{ fontSize: 18 }}>
              {metrics.budgetPomodoros}<span className="unit"> 个</span>
            </div>
          </div>
          <button
            className="btn"
            disabled={busy}
            title="编辑今日预算"
            onClick={() => {
              setPlannerOpen(true);
              command((time) => estimateDayPlanBudget(time));
            }}
          >
            <Icon name="clock" size={13}/> 估算
          </button>
        </div>
      </div>

      {views.pendingTriageTasks.length > 0 && (
        <section className="triage-section" aria-label="待分流清单">
          <div className="section-h">
            <h3>待分流</h3>
            <span className="count">{views.pendingTriageTasks.length} 个</span>
          </div>
          <div className="card triage-list">
            {views.pendingTriageTasks.map((task) => (
              <div className="triage-row" key={task.id}>
                <span className="triage-title">{task.title}</span>
                <span className="triage-actions">
                  <button className="btn ghost sm" disabled={busy} onClick={() => command((time) => moveTriageTaskToToday({ ...time, taskId: task.id }))}>加入今日</button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => command((time) => moveTriageTaskToList({ ...time, taskId: task.id }))}>移到活动清单</button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => command((time) => dismissTriageTask({ ...time, taskId: task.id }))}>放弃</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {batchAction && (
        <section className="card batch-toolbar" aria-label="批量操作">
          <div>
            <div className="batch-title">{batchLabels[batchAction]}</div>
            <div className="batch-help">每个任务独立原子提交；若中途失败，后续任务不会继续执行。</div>
          </div>
          <div className="batch-toolbar-actions">
            <span className="count">已选 {selectedBatchIds.size} / {batchTasks.length}</span>
            <button className="btn ghost sm" disabled={busy} onClick={cancelBatch}>取消</button>
            <button className="btn sm" disabled={busy || selectedBatchIds.size === 0} onClick={executeBatch}>执行</button>
          </div>
          {batchResult && batchPresentation && (
            <div
              className={`batch-result ${batchResult.failed.length ? 'has-error' : ''}`}
              role={batchResult.failed.length ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div>
                已完成 {batchResult.succeeded.length} 个
                {batchResult.failed.length > 0 && ` · 失败 ${batchResult.failed.length} 个`}
                {batchResult.notAttempted.length > 0 && ` · 未尝试 ${batchResult.notAttempted.length} 个`}
              </div>
              {batchPresentation.failed.length > 0 && (
                <ul className="batch-result-list">
                  {batchPresentation.failed.map((item) => (
                    <li key={item.taskId}>失败：{item.title} — {item.message}</li>
                  ))}
                </ul>
              )}
              {batchPresentation.notAttempted.length > 0 && (
                <ul className="batch-result-list">
                  {batchPresentation.notAttempted.map((item) => (
                    <li key={item.taskId}>未尝试：{item.title}</li>
                  ))}
                </ul>
              )}
              {selectedBatchIds.size > 0 && (
                <button className="btn ghost sm" disabled={busy} onClick={executeBatch}>重试失败与未尝试项</button>
              )}
            </div>
          )}
        </section>
      )}

      <div className="kanban" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div
          className="kan-col activity-list-col"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const drag = parseDrag(event);
            if (drag?.from === 'today') {
              command((time) => removeTaskFromToday({ ...time, taskId: drag.taskId }));
            }
          }}
        >
          <div className="kan-head">
            <span><Icon name="list" size={13}/> &nbsp;活动清单</span>
            <span className="kan-head-right">
              <span className="kan-count">{views.activeTasks.length}</span>
              <button className="btn ghost sm" disabled={busy || views.activeTasks.length === 0} onClick={() => beginBatch('addToToday')}>批量加入今日</button>
            </span>
          </div>
          <AddTaskInput
            placeholder="任务名称，回车创建…"
            disabled={busy}
            onCreate={(title) => command((time) => createManualTask({
              ...time, title, destination: 'list',
            }))}
          />
          {views.activeTasks.length === 0 && <div className="empty">清单里暂时没有活动。</div>}
          <div className="activity-tree">
            {views.activeTasks.map((task, index) => (
              <div key={task.id} className="task-tree-group">
                <div
                  className="activity-tree-row atr-group draggable"
                  draggable={!busy && !batchAction}
                  onDragStart={(event) => setDrag(event, { from: 'list', taskId: task.id, index })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const reorder = activityReorderPayload(parseDrag(event), index);
                    if (!reorder) return;
                    event.preventDefault();
                    event.stopPropagation();
                    command((time) => reorderActivityTask({ ...time, ...reorder }));
                  }}
                  title="拖动排序，或拖到今日待办"
                >
                  {batchCheckbox(task)}
                  <EditableTitle
                    task={task}
                    disabled={busy}
                    onSave={(title) => command((time) => updateTaskTitle({ ...time, taskId: task.id, title }))}
                  />
                  <span className="atr-actions">
                    <button
                      className="icon-btn text-icon"
                      disabled={busy}
                      title="任务详情、备注与层级"
                      onClick={() => setDetailTaskId(task.id)}
                    >···</button>
                    <button
                      className="icon-btn"
                      disabled={busy}
                      title="手动完成"
                      onClick={() => command((time) => completeTaskManually({
                        ...time, taskId: task.id,
                      }))}
                    >
                      <Icon name="check" size={12}/>
                    </button>
                    <button
                      className="icon-btn"
                      disabled={busy}
                      title="软删除"
                      onClick={() => command((time) => deleteActiveTask({ ...time, taskId: task.id }))}
                    >
                      <Icon name="x" size={12}/>
                    </button>
                  </span>
                </div>
                <SubtaskList
                  tasks={views.subtasksByParentId[task.id]}
                  busy={busy}
                  command={command}
                  onOpen={setDetailTaskId}
                  allowReorder={canReorderSubtasks(views, task.id)}
                  batchAction={batchAction}
                  selectedBatchIds={selectedBatchIds}
                  onToggleBatch={toggleBatchTask}
                />
              </div>
            ))}
          </div>
        </div>

        <div
          className="kan-col today-list-col"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const drag = parseDrag(event);
            if (drag?.from === 'list') {
              command((time) => addTaskToToday({ ...time, taskId: drag.taskId, source: 'drag' }));
            }
          }}
        >
          <div className="kan-head">
            <span><Icon name="arrow-day" size={13}/> &nbsp;今日待办</span>
            <span className="kan-head-right">
              <span className="kan-count" style={{ color: metrics.overloadedPomodoros > 0 ? 'var(--accent-ink)' : 'var(--muted)' }}>
                余 {metrics.remainingPomodoros}
                {metrics.overloadedPomodoros > 0 && ` · 超载 ${metrics.overloadedPomodoros}`}
              </span>
              <button className="btn ghost sm" disabled={busy || activeToday.length === 0} onClick={() => beginBatch('moveToList')}>批量移回</button>
            </span>
          </div>
          <AddTaskInput
            placeholder="直接新建今日任务…"
            disabled={busy}
            onCreate={(title) => command((time) => createManualTask({
              ...time, title, destination: 'today',
            }))}
          />
          {activeToday.length === 0 && completedToday.length === 0 && (
            <div className="empty">从活动清单拖入事项。</div>
          )}
          {activeToday.map((task) => {
            const dayPlanIndex = dayPlanIndexOf(views.todayTasks, task.id);
            return (
              <div key={task.id} className="today-task-block">
                <div
                  className="activity-tree-row atr-group draggable today-task-row"
                  draggable={!busy && !batchAction}
                  onDragStart={(event) => setDrag(event, { from: 'today', taskId: task.id, index: dayPlanIndex })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const drag = parseDrag(event);
                    if (drag?.from === 'list') {
                      command((time) => addTaskToToday({
                        ...time, taskId: drag.taskId, source: 'drag', addedAtIndex: dayPlanIndex,
                      }));
                    } else if (drag?.from === 'today' && drag.index !== dayPlanIndex) {
                      command((time) => reorderTodayTask({
                        ...time, fromIndex: drag.index, toIndex: dayPlanIndex,
                      }));
                    }
                  }}
                >
                  {batchCheckbox(task)}
                  <EditableTitle
                    task={task}
                    disabled={busy}
                    onSave={(title) => command((time) => updateTaskTitle({ ...time, taskId: task.id, title }))}
                  />
                  <div className="today-task-tools">
                    <button
                      className="icon-btn text-icon"
                      disabled={busy}
                      title="任务详情、备注与层级"
                      onClick={() => setDetailTaskId(task.id)}
                    >···</button>
                    <span className="today-est-pill">
                      <EstimateEditor
                        task={task}
                        disabled={busy}
                        onSave={(estimatedPomodoros) => command((time) => adjustTaskEstimate({
                          ...time, taskId: task.id, estimatedPomodoros,
                        }))}
                      />
                    </span>
                    <button
                      className="icon-btn"
                      disabled={busy}
                      title="手动完成"
                      onClick={() => command((time) => completeTaskManually({
                        ...time, taskId: task.id,
                      }))}
                    >
                      <Icon name="check" size={11}/>
                    </button>
                    <button
                      className="icon-btn"
                      disabled={busy}
                      title="移回活动清单"
                      onClick={() => command((time) => removeTaskFromToday({ ...time, taskId: task.id }))}
                    >
                      <Icon name="x" size={11}/>
                    </button>
                  </div>
                </div>
                <SubtaskList
                  tasks={views.subtasksByParentId[task.id]}
                  busy={busy}
                  command={command}
                  onOpen={setDetailTaskId}
                  allowReorder={canReorderSubtasks(views, task.id)}
                  batchAction={batchAction}
                  selectedBatchIds={selectedBatchIds}
                  onToggleBatch={toggleBatchTask}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>
        顶层任务保持原有拖动排序；子任务使用行内箭头在同一母任务内排序，详情中可调整层级与备注。
      </div>

      {archiveBatchTasks.length > 0 && (
        <div className="completed-section">
          <div className="section-h">
            <h3><Icon name="check" size={12}/> &nbsp;已完成</h3>
            <span className="section-actions">
              <span className="count">{archiveBatchTasks.length} 个</span>
              <button className="btn ghost sm" disabled={busy} onClick={() => beginBatch('archiveCompleted')}>批量归档</button>
            </span>
          </div>
          <div className="card completed-card">
            {views.completedTasks.length === 0 && (
              <div className="empty">已完成子任务保留在所属任务下，可在批量模式中选择。</div>
            )}
            {views.completedTasks.map((task) => (
              <div key={task.id} className="completed-row-item">
                <div className="completed-row-head">
                  <span className="completed-done-name">
                    {batchAction === 'archiveCompleted' && (
                      <input
                        className="batch-checkbox"
                        type="checkbox"
                        aria-label={`选择 ${task.title}`}
                        checked={selectedBatchIds.has(task.id)}
                        disabled={busy}
                        onChange={() => toggleBatchTask(task.id)}
                      />
                    )}
                    {task.title}
                  </span>
                  <span className="completed-done-date">
                    {completionSourceLabel(task.completionSource)} · {task.completedAt ?? ''}
                  </span>
                </div>
                <div className="completed-row-actions">
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => setDetailTaskId(task.id)}
                  >
                    详情 / 工作记录
                  </button>
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => {
                      setArchiveCandidateId(null);
                      command((time) => uncompleteTask({ ...time, taskId: task.id }));
                    }}
                  >
                    取消完成
                  </button>
                  {archiveCandidateId === task.id ? (
                    <>
                      <button
                        className="btn sm"
                        disabled={busy}
                        onClick={() => {
                          setArchiveCandidateId(null);
                          command((time) => archiveCompletedTask({ ...time, taskId: task.id }));
                        }}
                      >
                        确认归档
                      </button>
                      <button
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() => setArchiveCandidateId(null)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => setArchiveCandidateId(task.id)}
                    >
                      归档
                    </button>
                  )}
                </div>
                <SubtaskList
                  tasks={views.subtasksByParentId[task.id]}
                  busy={busy}
                  command={command}
                  onOpen={setDetailTaskId}
                  allowReorder={canReorderSubtasks(views, task.id)}
                  batchAction={batchAction}
                  selectedBatchIds={selectedBatchIds}
                  onToggleBatch={toggleBatchTask}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {detachedChildren.length > 0 && (
        <div className="completed-section">
          <div className="section-h">
            <h3>待整理子任务</h3>
            <span className="count">{detachedChildren.length} 个</span>
          </div>
          <div className="card completed-card detached-card">
            {Object.entries(detachedGroups).map(([parentId, tasks]) => (
              <div key={parentId} className="detached-group">
                <div className="task-detail-help">原母任务 {parentId.slice(0, 8)}… 当前不可见</div>
                <SubtaskList
                  tasks={tasks}
                  busy={busy}
                  command={command}
                  onOpen={setDetailTaskId}
                  allowReorder={false}
                  batchAction={batchAction}
                  selectedBatchIds={selectedBatchIds}
                  onToggleBatch={toggleBatchTask}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="completed-section history-section">
        <div className="section-h">
          <h3>归档历史</h3>
          <span className="count">{views.archivedTasks.length} 个</span>
        </div>
        <div className="card completed-card">
          {views.archivedTasks.length === 0 && <div className="empty">尚无归档任务。</div>}
          {views.archivedTasks.map((task) => {
            const presentation = archivedTaskPresentation(task);
            const lineage = splitLineagePresentation(task, allTaskRecords);
            return (
              <div key={task.id} className="history-row">
                <div className="history-main">
                  <div className="history-title">{task.title}</div>
                  <div className="history-meta">
                    <span>{presentation.outcomeLabel}</span>
                    <span>{presentation.archivedAt}</span>
                    {presentation.completionLabel && <span>{presentation.completionLabel}</span>}
                    {presentation.lineageLabel && <span>{presentation.lineageLabel}</span>}
                    {lineage && <span>{lineage.label}</span>}
                    {task.parentId && <span>子任务</span>}
                  </div>
                  {task.note && <div className="history-note">备注：{task.note}</div>}
                  {task.actualWorkNote && <div className="history-note">工作记录：{task.actualWorkNote}</div>}
                </div>
                <div className="history-actions">
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => setDetailTaskId(task.id)}
                  >
                    详情 / 工作记录
                  </button>
                  <button
                    className="btn sm"
                    disabled={busy}
                    onClick={() => command((time) => restoreArchivedTask({
                      ...time, taskId: task.id,
                    }))}
                  >
                    恢复
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {plannerOpen && (
        <BudgetPlannerModal
          dayPlan={views.dayPlan}
          command={command}
          busy={busy}
          onClose={() => setPlannerOpen(false)}
        />
      )}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          views={views}
          busy={busy}
          command={command}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}
