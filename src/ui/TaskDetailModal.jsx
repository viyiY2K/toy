import {
  adjustTaskEstimate,
  archiveCompletedTask,
  createSubtask,
  deleteActiveTask,
  moveTopLevelTaskToSubtask,
  promoteSubtaskToTopLevel,
  restoreArchivedTask,
  splitTask,
  uncompleteTask,
  updateTaskActualWorkNote,
  updateTaskNote,
} from '../data/index';
import {
  availableParentTasks,
  canAdjustTaskEstimate,
  hasRetainedChildren,
  splitDraftValid,
  splitLineagePresentation,
} from './taskViewModel';

const React = window.React;

export function TaskDetailModal({ task, views, busy, command, onClose }) {
  const [note, setNote] = React.useState(task.note ?? '');
  const [actualWorkNote, setActualWorkNote] = React.useState(task.actualWorkNote ?? '');
  const [estimatedPomodoros, setEstimatedPomodoros] = React.useState(String(task.estimatedPomodoros));
  const [subtaskTitle, setSubtaskTitle] = React.useState('');
  const [parentId, setParentId] = React.useState('');
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [splitTitle, setSplitTitle] = React.useState('');
  const [splitEstimate, setSplitEstimate] = React.useState('1');
  const modalRef = React.useRef(null);

  React.useEffect(() => {
    const previousFocus = document.activeElement;
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)';
    modalRef.current?.querySelector(focusableSelector)?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll(focusableSelector)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  React.useEffect(() => {
    setNote(task.note ?? '');
    setActualWorkNote(task.actualWorkNote ?? '');
    setEstimatedPomodoros(String(task.estimatedPomodoros));
    setSubtaskTitle('');
    setParentId('');
    setSplitOpen(false);
    setSplitTitle('');
    setSplitEstimate('1');
  }, [task.id, task.updatedAt]);

  const active = task.status === 'active' || task.status === 'splitNeeded';
  const lineage = splitLineagePresentation(task, [
    ...views.activeTasks,
    ...views.todayTasks,
    ...views.completedTasks,
    ...Object.values(views.subtasksByParentId).flat(),
    ...views.archivedTasks,
  ]);
  const isTodayTopLevel = task.parentId === null && views.dayPlan.taskIds.includes(task.id);
  const children = views.subtasksByParentId[task.id] ?? [];
  const retainedChildren = hasRetainedChildren(views, task.id);
  const estimateEditable = canAdjustTaskEstimate(task);
  const estimateValue = Number(estimatedPomodoros);
  const estimateValid = Number.isInteger(estimateValue) && estimateValue >= 1 && estimateValue <= 7;
  const parentChoices = availableParentTasks(views, task.id);
  const saveNote = () => command((time) => updateTaskNote({
    ...time,
    taskId: task.id,
    note: note.trim() || null,
  }));
  const saveActualWorkNote = () => command((time) => updateTaskActualWorkNote({
    ...time,
    taskId: task.id,
    actualWorkNote: actualWorkNote.trim() || null,
  }));

  return (
    <div className="modal-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={modalRef}
        className="modal task-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`task-detail-title-${task.id}`}
      >
        <div className="task-detail-head">
          <div>
            <h2 id={`task-detail-title-${task.id}`}>{task.title}</h2>
            <div className="sub">
              {task.parentId ? '子任务' : '顶层任务'} · {task.status}
            </div>
            {lineage && <div className="task-lineage">{lineage.label}</div>}
          </div>
          <button className="btn ghost sm" onClick={onClose}>关闭</button>
        </div>

        {active && (
          <div className="task-detail-section">
            <label className="task-detail-label" htmlFor={`estimate-${task.id}`}>预估番茄数</label>
            <div className="task-detail-inline estimate-inline">
              <input
                id={`estimate-${task.id}`}
                className="input boxed"
                type="number"
                min="1"
                max="7"
                value={estimatedPomodoros}
                disabled={busy || !estimateEditable}
                onChange={(event) => setEstimatedPomodoros(event.target.value)}
              />
              <button
                className="btn sm"
                disabled={
                  busy
                  || !estimateEditable
                  || !estimateValid
                  || estimateValue === task.estimatedPomodoros
                }
                onClick={() => command((time) => adjustTaskEstimate({
                  ...time, taskId: task.id, estimatedPomodoros: estimateValue,
                }))}
              >
                保存预估
              </button>
            </div>
            <div className="task-detail-help">
              {estimateEditable
                ? `第 ${task.estimateRounds.length + 1} 轮调整；合法范围 1–7。`
                : '已达到三轮预估上限。'}
            </div>
          </div>
        )}

        {active && (
          <div className="task-detail-section">
            <label className="task-detail-label" htmlFor={`note-${task.id}`}>任务备注</label>
            <textarea
              id={`note-${task.id}`}
              className="input boxed task-detail-textarea"
              value={note}
              disabled={busy}
              placeholder="记录上下文、下一步或限制条件…"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="task-detail-actions">
              <button
                className="btn sm"
                disabled={busy || (note.trim() || null) === task.note}
                onClick={saveNote}
              >
                保存备注
              </button>
            </div>
          </div>
        )}

        {(task.status === 'completed' || task.status === 'archived') && (
          <div className="task-detail-section">
            <label className="task-detail-label" htmlFor={`actual-${task.id}`}>实际工作记录</label>
            <textarea
              id={`actual-${task.id}`}
              className="input boxed task-detail-textarea"
              value={actualWorkNote}
              disabled={busy}
              placeholder="记录实际完成了什么、结果与后续…"
              onChange={(event) => setActualWorkNote(event.target.value)}
            />
            <div className="task-detail-actions">
              <button
                className="btn sm"
                disabled={busy || (actualWorkNote.trim() || null) === task.actualWorkNote}
                onClick={saveActualWorkNote}
              >
                保存工作记录
              </button>
            </div>
          </div>
        )}

        {active && task.parentId === null && (
          <div className="task-detail-section">
            <div className="task-detail-label">子任务</div>
            <div className="task-detail-inline">
              <input
                className="input boxed"
                value={subtaskTitle}
                disabled={busy}
                placeholder="新建子任务…"
                onChange={(event) => setSubtaskTitle(event.target.value)}
                onKeyDown={async (event) => {
                  if (event.key !== 'Enter' || !subtaskTitle.trim()) return;
                  const result = await command((time) => createSubtask({
                    ...time, parentId: task.id, title: subtaskTitle.trim(),
                  }));
                  if (result) setSubtaskTitle('');
                }}
              />
              <button
                className="btn sm"
                disabled={busy || !subtaskTitle.trim()}
                onClick={async () => {
                  const result = await command((time) => createSubtask({
                    ...time, parentId: task.id, title: subtaskTitle.trim(),
                  }));
                  if (result) setSubtaskTitle('');
                }}
              >
                添加
              </button>
            </div>
          </div>
        )}

        {active && task.parentId === null && (
          <div className="task-detail-section">
            <div className="task-detail-label">层级</div>
            {retainedChildren ? (
              <div className="task-detail-help">存在当前或已归档子任务的顶层任务不能再缩进为子任务。</div>
            ) : parentChoices.length > 0 ? (
              <div className="task-detail-inline">
                <select
                  className="input boxed"
                  aria-label="选择母任务"
                  value={parentId}
                  disabled={busy}
                  onChange={(event) => setParentId(event.target.value)}
                >
                  <option value="">选择母任务…</option>
                  {parentChoices.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                  ))}
                </select>
                <button
                  className="btn sm"
                  disabled={busy || !parentId}
                  onClick={() => command((time) => moveTopLevelTaskToSubtask({
                    ...time,
                    taskId: task.id,
                    parentId,
                    toIndex: (views.subtasksByParentId[parentId] ?? []).length,
                  }))}
                >
                  设为子任务
                </button>
              </div>
            ) : (
              <div className="task-detail-help">暂无其他可作为母任务的活动顶层任务。</div>
            )}
          </div>
        )}

        {active && task.parentId !== null && (
          <div className="task-detail-section task-detail-actions spread">
            <span className="task-detail-help">升级后进入活动清单，不自动加入今日。</span>
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => command((time) => promoteSubtaskToTopLevel({
                ...time, taskId: task.id,
              }))}
            >
              升级为顶层
            </button>
          </div>
        )}

        {active && (
          <div className="task-detail-section split-panel">
            <div className="task-detail-label">拆分归档</div>
            {!splitOpen ? (
              <div className="task-detail-actions spread">
                <span className="task-detail-help">原任务归档为 split，并创建一个血缘后继任务。</span>
                <button className="btn ghost sm" disabled={busy} onClick={() => setSplitOpen(true)}>
                  准备拆分
                </button>
              </div>
            ) : (
              <>
                <div className="task-detail-inline split-fields">
                  <input
                    className="input boxed"
                    aria-label="拆分后任务标题"
                    value={splitTitle}
                    disabled={busy}
                    placeholder="拆分后的下一步…"
                    onChange={(event) => setSplitTitle(event.target.value)}
                  />
                  <input
                    className="input boxed mono"
                    aria-label="拆分后预估番茄数"
                    type="number"
                    min="1"
                    max="7"
                    value={splitEstimate}
                    disabled={busy}
                    onChange={(event) => setSplitEstimate(event.target.value)}
                  />
                </div>
                <div className="task-detail-actions">
                  <button className="btn ghost sm" disabled={busy} onClick={() => setSplitOpen(false)}>
                    取消拆分
                  </button>
                  <button
                    className="btn sm"
                    disabled={busy || !splitDraftValid(splitTitle, splitEstimate)}
                    onClick={() => command((time) => splitTask({
                      ...time,
                      taskId: task.id,
                      newTitle: splitTitle.trim(),
                      estimatedPomodoros: Number(splitEstimate),
                    }))}
                  >
                    确认拆分并归档
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="task-detail-footer">
          {active && (
            <button
              className="btn ghost sm danger"
              disabled={busy || isTodayTopLevel}
              title={isTodayTopLevel ? '请先移回活动清单，再执行软删除' : '软删除任务'}
              onClick={() => {
                onClose();
                command((time) => deleteActiveTask({ ...time, taskId: task.id }));
              }}
            >
              软删除
            </button>
          )}
          {task.status === 'completed' && (
            <>
              <button
                className="btn ghost sm"
                disabled={busy}
                onClick={() => command((time) => uncompleteTask({ ...time, taskId: task.id }))}
              >
                取消完成
              </button>
              <button
                className="btn sm"
                disabled={busy}
                onClick={() => command((time) => archiveCompletedTask({ ...time, taskId: task.id }))}
              >
                归档
              </button>
            </>
          )}
          {task.status === 'archived' && (
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => command((time) => restoreArchivedTask({ ...time, taskId: task.id }))}
            >
              从归档恢复
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
