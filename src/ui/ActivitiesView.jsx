import {
  addTaskToMergeGroup,
  addTaskToToday,
  adjustMergeGroupEstimate,
  adjustTaskEstimate,
  archiveCompletedTask,
  batchAddTasksToToday,
  batchArchiveCompletedTasks,
  batchMoveTasksToList,
  completeMergeGroup,
  completeTaskFromPomodoro,
  completeTaskManually,
  createManualTask,
  createMergeGroup,
  deleteActiveTask,
  dismissTriageTask,
  dissolveMergeGroup,
  estimateDayPlanBudget,
  moveTriageTaskToList,
  moveTriageTaskToToday,
  promoteSubtaskToTopLevel,
  removeTaskFromMergeGroup,
  removeTaskFromToday,
  renameMergeGroup,
  reorderActivityTask,
  reorderMergeGroupMember,
  reorderSubtask,
  reorderTodayTask,
  restoreArchivedTask,
  uncompleteTask,
  updateTaskTitle,
} from '../data/index';
import { Icon } from './Icon';
import { EmptyState } from './EmptyState';
import { BudgetPlannerModal } from './BudgetPlannerModal';
import { TaskDetailModal } from './TaskDetailModal';
import {
  activityReorderPayload,
  archivedTaskPresentation,
  batchCandidates,
  batchResultPresentation,
  batchRetryIds,
  canReorderSubtasks,
  completedOnlyMergeRows,
  completedTaskTimeLabel,
  completionSourceLabel,
  currentPlanMetrics,
  dayPlanIndexOf,
  dropInsertIndex,
  dropIntent,
  foldMergeRows,
  isMergeGroupSessionActive,
  isMergeMemberLocked,
  isTaskRunningFocus,
  mergeCardSummary,
  mergeIneligibleReason,
  reconcileBatchSelection,
  splitLineagePresentation,
  splitTodayTasks,
  unattachedSubtasks,
} from './taskViewModel';

const React = window.React;

function EditableTitle({ task, value, onSave, disabled = false, label = '编辑标题' }) {
  const [editing, setEditing] = React.useState(false);
  const current = value ?? task?.title ?? '';
  if (editing && !disabled) {
    return (
      <input
        className="input today-name-input"
        autoFocus
        defaultValue={current}
        onBlur={(event) => {
          const title = event.target.value.trim();
          if (title && title !== current) onSave(title);
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
      title={label}
      onClick={() => setEditing(true)}
    >
      {current}
    </button>
  );
}

function canEditEstimate(task, disabled, runningFocusTaskId) {
  return !disabled
    && !isTaskRunningFocus(task, runningFocusTaskId)
    && task.status === 'active'
    && task.estimateRounds.length < 3;
}

function EstimateEditor({
  task,
  onSave,
  disabled,
  runningFocusTaskId,
  editRequested,
  onEditRequestHandled,
  onAdvance,
}) {
  const [editing, setEditing] = React.useState(false);
  const runningFocus = isTaskRunningFocus(task, runningFocusTaskId);
  const locked = !canEditEstimate(task, disabled, runningFocusTaskId);
  const advanceAfterCommitRef = React.useRef(false);

  React.useEffect(() => {
    if (!editRequested || locked) return;
    setEditing(true);
    onEditRequestHandled();
  }, [editRequested, locked, onEditRequestHandled]);

  if (editing && !locked) {
    return (
      <input
        className="mono today-est-input"
        type="number"
        min="1"
        max="7"
        autoFocus
        defaultValue={task.estimatedPomodoros}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={async (event) => {
          const value = Number(event.target.value);
          const shouldAdvance = advanceAfterCommitRef.current;
          advanceAfterCommitRef.current = false;
          let saved = true;
          if (Number.isInteger(value) && value >= 1 && value <= 7 && value !== task.estimatedPomodoros) {
            saved = Boolean(await onSave(value));
          } else if (!Number.isInteger(value) || value < 1 || value > 7) {
            saved = false;
          }
          setEditing(false);
          if (shouldAdvance && saved) onAdvance();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            advanceAfterCommitRef.current = true;
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            advanceAfterCommitRef.current = false;
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      className={`mono today-est-num-btn ${locked ? 'locked' : ''}`}
      disabled={locked}
      title={runningFocus ? '本轮专注进行中，结束后再调整预估' : locked ? '当前阶段不可再调整预估' : '点击调整总预估（1–7）'}
      onClick={() => setEditing(true)}
    >
      {task.estimatedPomodoros}
    </button>
  );
}

function AddTaskInput({ placeholder, onCreate, disabled, focusRequest = 0 }) {
  const [title, setTitle] = React.useState('');
  const inputRef = React.useRef(null);
  const refocusAfterCreateRef = React.useRef(false);

  React.useEffect(() => {
    if (!focusRequest || disabled) return;
    inputRef.current?.scrollIntoView?.({ block: 'nearest' });
    inputRef.current?.focus();
  }, [disabled, focusRequest]);

  React.useEffect(() => {
    if (!disabled && refocusAfterCreateRef.current) {
      refocusAfterCreateRef.current = false;
      inputRef.current?.focus();
    }
  }, [disabled, title]);

  const submit = async () => {
    const value = title.trim();
    if (!value || disabled) return;
    const result = await onCreate(value);
    if (!result) return;
    refocusAfterCreateRef.current = true;
    setTitle('');
  };
  return (
    <div className="activity-tree-row atr-group" style={{ marginTop: 8 }}>
      <span className="atr-bullet"/>
      <input
        ref={inputRef}
        className="input atr-input"
        value={title}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submit();
        }}
      />
      <button className="icon-btn" disabled={disabled || !title.trim()} onClick={submit} title="新建任务">
        <Icon name="plus" size={13}/>
      </button>
    </div>
  );
}

export function ListScrollRegion({ className = '', children }) {
  const scrollRef = React.useRef(null);
  const trackRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [thumb, setThumb] = React.useState({ visible: false, height: 36, top: 0 });

  const updateThumb = React.useCallback(() => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;

    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const trackHeight = track.clientHeight;
    const visible = maxScroll > 1 && trackHeight > 0;
    const height = visible
      ? Math.min(trackHeight, Math.max(36, Math.round(trackHeight * scroller.clientHeight / scroller.scrollHeight)))
      : 36;
    const maxTop = Math.max(0, trackHeight - height);
    const top = visible && maxScroll > 0
      ? Math.round((scroller.scrollTop / maxScroll) * maxTop)
      : 0;

    setThumb((current) => (
      current.visible === visible && current.height === height && current.top === top
        ? current
        : { visible, height, top }
    ));
  }, []);

  React.useLayoutEffect(() => {
    updateThumb();
  });

  React.useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateThumb);
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(updateThumb);

    resizeObserver?.observe(scroller);
    mutationObserver?.observe(scroller, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener('resize', updateThumb);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', updateThumb);
    };
  }, [updateThumb]);

  const beginThumbDrag = (event) => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track || !thumb.visible) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: scroller.scrollTop,
      maxScroll: scroller.scrollHeight - scroller.clientHeight,
      maxThumbTop: track.clientHeight - thumb.height,
    };
  };

  const dragThumb = (event) => {
    const drag = dragRef.current;
    const scroller = scrollRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId || drag.maxThumbTop <= 0) return;

    const scrollDelta = (event.clientY - drag.startY) * drag.maxScroll / drag.maxThumbTop;
    scroller.scrollTop = drag.startScrollTop + scrollDelta;
  };

  const endThumbDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const jumpToTrackPosition = (event) => {
    if (event.target !== event.currentTarget || !thumb.visible) return;
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;

    const trackRect = track.getBoundingClientRect();
    const maxThumbTop = track.clientHeight - thumb.height;
    const thumbTop = Math.min(
      maxThumbTop,
      Math.max(0, event.clientY - trackRect.top - thumb.height / 2),
    );
    scroller.scrollTop = maxThumbTop > 0
      ? (thumbTop / maxThumbTop) * (scroller.scrollHeight - scroller.clientHeight)
      : 0;
  };

  return (
    <div className="list-scroll-shell">
      <div
        ref={scrollRef}
        className={`list-scroll-region ${className}`.trim()}
        onScroll={updateThumb}
      >
        {children}
      </div>
      <div
        ref={trackRef}
        className={`list-scrollbar-track ${thumb.visible ? 'is-visible' : ''}`}
        aria-hidden="true"
        onPointerDown={jumpToTrackPosition}
      >
        <div
          className="list-scrollbar-thumb"
          style={{ height: thumb.height, transform: `translateY(${thumb.top}px)` }}
          onPointerDown={beginThumbDrag}
          onPointerMove={dragThumb}
          onPointerUp={endThumbDrag}
          onPointerCancel={endThumbDrag}
        />
      </div>
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
        <button className="icon-btn" disabled={busy} title="任务详情" onClick={() => onOpen(task.id)}>
          <Icon name="info" size={11}/>
        </button>
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

/**
 * 合并组：和活动清单里的父任务同一套树——父行是组名，下面缩进挂成员。
 * 这不是子任务血缘，只是几件小事共用一个番茄。
 */
function MergeGroupBlock({
  group,
  members,
  remaining,
  busy,
  command,
  onOpen,
  dragProps,
  memberDrag,
  runningFocus,
  showEstimate = false,
  estimateEditRequest,
  onEditRequestHandled,
  onAdvance,
}) {
  const summary = mergeCardSummary(group, members, remaining);
  const sessionActive = isMergeGroupSessionActive(group, runningFocus);
  const latestSessionId = group.latestCompletedSessionId ?? null;
  const groupAsEstimateTask = {
    id: group.id,
    estimatedPomodoros: group.estimatedPomodoros,
    estimateRounds: group.estimateRounds,
    status: group.status === 'limitReached' ? 'splitNeeded' : 'active',
  };

  const completeMember = (task) => {
    if (sessionActive && runningFocus.sessionId && task.id === runningFocus.taskId) {
      return command((time) => completeTaskFromPomodoro({
        ...time, sessionId: runningFocus.sessionId, taskId: task.id,
      }));
    }
    return command((time) => completeTaskManually({ ...time, taskId: task.id }));
  };

  return (
    <div className={`task-tree-group merge-group-block ${summary.blocked ? 'is-blocked' : ''}`}>
      <div
        className={`activity-tree-row atr-group ${dragProps.className}`}
        draggable={dragProps.draggable}
        onDragStart={dragProps.onDragStart}
        onDragOver={dragProps.onDragOver}
        onDragEnd={dragProps.onDragEnd}
        onDrop={dragProps.onDrop}
      >
        <span className="atr-bullet" aria-hidden="true"/>
        <EditableTitle
          value={group.title}
          disabled={busy}
          label="编辑合并组名称"
          onSave={(title) => command((time) => renameMergeGroup({
            ...time, mergeGroupId: group.id, title,
          }))}
        />
        <span className={showEstimate ? 'today-task-tools' : 'atr-actions'}>
          {showEstimate && (
            <span className="today-est-pill">
              <EstimateEditor
                task={groupAsEstimateTask}
                disabled={busy || group.status === 'limitReached'}
                runningFocusTaskId={null}
                editRequested={estimateEditRequest === group.id}
                onEditRequestHandled={onEditRequestHandled}
                onAdvance={onAdvance}
                onSave={(estimatedPomodoros) => command((time) => adjustMergeGroupEstimate({
                  ...time, mergeGroupId: group.id, estimatedPomodoros,
                }))}
              />
            </span>
          )}
          {latestSessionId && (
            <button
              className="icon-btn"
              disabled={busy || sessionActive}
              title="确认这一组做完了"
              onClick={() => command((time) => completeMergeGroup({
                ...time, mergeGroupId: group.id, sessionId: latestSessionId,
              }))}
            >
              <Icon name="check" size={12}/>
            </button>
          )}
          <button
            className="icon-btn"
            disabled={busy || sessionActive}
            title={sessionActive
              ? '本轮合并专注进行中，结束后才能取消合并'
              : '取消合并（任务各自回到原来的位置，不会被删除）'}
            onClick={() => command((time) => dissolveMergeGroup({
              ...time, mergeGroupId: group.id,
            }))}
          >
            <Icon name="x" size={12}/>
          </button>
        </span>
      </div>
      {summary.blocked && (
        <div className="merge-group-hint" role="status">
          这些零碎事项已经占满一个多番茄的量，建议把还没做完的移出去，或取消整次合并。
        </div>
      )}
      <div className="task-subtree">
        {members.map((task, index) => {
          const completed = task.status === 'completed';
          const locked = isMergeMemberLocked(task, runningFocus);
          const otherLocked = sessionActive && !locked;
          return (
            <div
              key={task.id}
              className={`activity-tree-row atr-item ${completed ? 'is-completed' : ''} ${locked ? 'is-current' : ''} ${memberDrag.className(task.id)}`}
              draggable={!busy && !locked}
              onDragStart={(event) => memberDrag.onDragStart(event, task, index)}
              onDragOver={(event) => memberDrag.onDragOver(event, task.id)}
              onDragEnd={memberDrag.onDragEnd}
              onDrop={(event) => memberDrag.onDrop(event, index)}
              title={locked ? '正在做这一件' : '拖动可调整这个番茄里先做哪件'}
            >
              <button
                className={`atr-check ${completed ? 'is-done' : ''}`}
                disabled={busy || (sessionActive && !locked) || (sessionActive && completed)}
                title={
                  completed
                    ? '取消完成'
                    : locked
                      ? '这一件做完了'
                      : otherLocked
                        ? '先做完当前这件'
                        : '完成这件小事'
                }
                onClick={() => (completed
                  ? command((time) => uncompleteTask({ ...time, taskId: task.id }))
                  : completeMember(task))}
              />
              <EditableTitle
                task={task}
                disabled={busy}
                onSave={(title) => command((time) => updateTaskTitle({
                  ...time, taskId: task.id, title,
                }))}
              />
              <span className="atr-actions subtask-actions">
                {locked && <span className="merge-now">正在做</span>}
                <button
                  className="icon-btn"
                  disabled={busy}
                  title="任务详情"
                  onClick={() => onOpen(task.id)}
                >
                  <Icon name="info" size={11}/>
                </button>
                <button
                  className="icon-btn text-icon"
                  disabled={busy || locked}
                  title={locked ? '正在做这一件，不能移出' : '移出合并（回到独立任务）'}
                  onClick={() => command((time) => removeTaskFromMergeGroup({
                    ...time, mergeGroupId: group.id, taskId: task.id, reason: 'manualUnmerge',
                  }))}
                >↤</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActivitiesView({ views, runCommand, busy, runningFocus = null }) {
  const runningFocusTaskId = runningFocus?.taskId ?? null;
  const [plannerOpen, setPlannerOpen] = React.useState(false);
  const [archiveCandidateId, setArchiveCandidateId] = React.useState(null);
  const [detailTaskId, setDetailTaskId] = React.useState(null);
  const [batchAction, setBatchAction] = React.useState(null);
  const [selectedBatchIds, setSelectedBatchIds] = React.useState(() => new Set());
  const [batchResult, setBatchResult] = React.useState(null);
  const [estimateEditRequest, setEstimateEditRequest] = React.useState(null);
  const [activityInputFocusRequest, setActivityInputFocusRequest] = React.useState(0);
  const [todayInputFocusRequest, setTodayInputFocusRequest] = React.useState(0);
  // 拖拽排序的纯视觉反馈：draggingKey = 正在拖的行，dragOverKey = 当前悬停的落点行，
  // dropPosition = 悬停在该行的上半还是下半（决定落到目标行前面还是后面，而不是互换）。
  const [draggingKey, setDraggingKey] = React.useState(null);
  const [dragOverKey, setDragOverKey] = React.useState(null);
  const [dropPosition, setDropPosition] = React.useState('before');
  // 被拖任务的 id 与「为什么不能合并」——dragover 期间 dataTransfer 读不到数据，
  // 只能自己存一份，才能在悬停时就给出防呆反馈。
  const [draggedTaskId, setDraggedTaskId] = React.useState(null);
  const [blockedReason, setBlockedReason] = React.useState(null);
  const { activeTasks: activeToday, completedTasks: completedToday } = splitTodayTasks(views.todayTasks);
  const activityRows = foldMergeRows(views.activeTasks, views);
  const todayRows = foldMergeRows(activeToday, views);
  const leftoverMergeOn = (rows, inList) => completedOnlyMergeRows(rows, views)
    .filter((row) => row.members.some(inList));
  const activityTreeRows = [
    ...activityRows,
    ...leftoverMergeOn(activityRows, (task) => !views.dayPlan.taskIds.includes(task.id)),
  ];
  const todayTreeRows = [
    ...todayRows,
    ...leftoverMergeOn(todayRows, (task) => views.dayPlan.taskIds.includes(task.id)),
  ];
  const liveMergeMemberIds = new Set(
    (views.mergeGroups ?? []).flatMap((group) =>
      (views.mergeGroupMembersById?.[group.id] ?? []).map((task) => task.id)),
  );
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
  const clearDrag = () => {
    setDraggingKey(null);
    setDragOverKey(null);
    setDropPosition('before');
    setDraggedTaskId(null);
    setBlockedReason(null);
  };
  /*
   * 落点意图：拖到行的**正中间**是「合并」，落在上/下缘仍是排序（§4.1）。
   * dataTransfer 在 dragover 期间读不到数据，所以被拖任务的 id 单独存一份 state，
   * 用来在悬停时就判定合并资格、给出防呆反馈，而不是等写入被拒绝。
   */
  const hoverRow = (event, key, target = null) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const intent = target === null
      ? (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      : dropIntent(event.clientY - rect.top, rect.height);
    setDragOverKey(key);
    setDropPosition(intent);
    if (intent !== 'merge' || draggedTaskId === null) {
      setBlockedReason(null);
      return;
    }
    const dragged = allTaskRecords.find((task) => task.id === draggedTaskId) ?? null;
    setBlockedReason(mergeIneligibleReason(dragged, views) ?? mergeIneligibleReason(target, views));
  };
  const rowDragClass = (key) => {
    if (draggingKey === key) return 'dragging';
    if (dragOverKey === key && draggingKey !== null && draggingKey !== key) {
      if (dropPosition === 'merge') return blockedReason ? 'drop-blocked' : 'drop-merge';
      return dropPosition === 'after' ? 'drop-after' : 'drop-before';
    }
    return '';
  };

  /**
   * 把一个任务并到目标行上：目标已经在合并组里就加入那个组，否则新建一个组。
   * 资格不满足时只提示、不写入（§3.8 关键规则 9 的防呆前置）。
   */
  const mergeInto = (draggedId, target) => {
    if (draggedId === target.id) return;
    const dragged = allTaskRecords.find((task) => task.id === draggedId) ?? null;
    const reason = mergeIneligibleReason(dragged, views) ?? mergeIneligibleReason(target, views);
    if (reason) {
      setBlockedReason(reason);
      window.setTimeout(() => setBlockedReason(null), 2400);
      return;
    }
    if (target.mergeGroupId) {
      command((time) => addTaskToMergeGroup({
        ...time, mergeGroupId: target.mergeGroupId, taskId: draggedId, source: 'drag',
      }));
      return;
    }
    command((time) => createMergeGroup({ ...time, taskIds: [target.id, draggedId] }));
  };

  /** 整张合并卡片作为落点：往上拖任务 = 加入这个组。卡片本身不参与列表排序。 */
  const mergeCardDragProps = (group) => ({
    draggable: false,
    className: rowDragClass(`merge-${group.id}`),
    onDragStart: undefined,
    onDragEnd: clearDrag,
    onDragOver: (event) => {
      event.preventDefault();
      setDragOverKey(`merge-${group.id}`);
      setDropPosition('merge');
      const dragged = allTaskRecords.find((task) => task.id === draggedTaskId) ?? null;
      setBlockedReason(
        group.status === 'limitReached'
          ? '这个合并组已经占满预估，先处理掉里面没做完的事再加新的'
          : mergeIneligibleReason(dragged, views),
      );
    },
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      const drag = parseDrag(event);
      const blocked = blockedReason;
      clearDrag();
      if (blocked || typeof drag?.taskId !== 'string') {
        if (blocked) {
          setBlockedReason(blocked);
          window.setTimeout(() => setBlockedReason(null), 2400);
        }
        return;
      }
      if (group.taskIds.includes(drag.taskId)) return;
      command((time) => addTaskToMergeGroup({
        ...time, mergeGroupId: group.id, taskId: drag.taskId, source: 'drag',
      }));
    },
  });

  /** 卡片内部成员排序：只重排组内顺序（这个番茄里先做哪件），不改成员归属。 */
  const memberDragProps = (group) => ({
    className: (taskId) => rowDragClass(`member-${taskId}`),
    onDragStart: (event, task, index) => {
      event.stopPropagation();
      setDrag(event, { from: 'mergeMember', taskId: task.id, index, mergeGroupId: group.id });
      setDraggingKey(`member-${task.id}`);
      setDraggedTaskId(task.id);
    },
    onDragOver: (event, taskId) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setDragOverKey(`member-${taskId}`);
      setDropPosition(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    },
    onDragEnd: clearDrag,
    onDrop: (event, index) => {
      event.preventDefault();
      event.stopPropagation();
      const position = dropPosition;
      const drag = parseDrag(event);
      clearDrag();
      if (drag?.from !== 'mergeMember' || drag.mergeGroupId !== group.id) return;
      const toIndex = dropInsertIndex(drag.index, index, position);
      if (toIndex === drag.index) return;
      command((time) => reorderMergeGroupMember({
        ...time, mergeGroupId: group.id, fromIndex: drag.index, toIndex,
      }));
    },
  });

  return (
    <div>
      <div className="main-head">
        <div>
          <h1>清单与计划</h1>
          <div className="sub">在「活动清单」里整理想法，移到「今日待办」后开始番茄。</div>
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
              <button className="btn ghost sm" disabled={busy} onClick={() => setActivityInputFocusRequest((request) => request + 1)}>新增</button>
              <span className="kan-count">{views.activeTasks.length}</span>
              <button className="btn ghost sm" disabled={busy || views.activeTasks.length === 0} onClick={() => beginBatch('addToToday')}>批量加入今日</button>
            </span>
          </div>
          <ListScrollRegion className={activityTreeRows.length === 0 ? 'is-empty' : ''}>
            {activityTreeRows.length === 0 && (
              <EmptyState
                icon="list"
                title="清单还是空的"
                hint="在下方输入框写下想做的第一件事，回车就能加进来。"
              />
            )}
            {activityTreeRows.length > 0 && (
              <div className="activity-tree">
                {activityTreeRows.map((row) => {
                  if (row.kind === 'merge') {
                    return (
                      <MergeGroupBlock
                        key={row.key}
                        group={{
                          ...row.group,
                          latestCompletedSessionId: views.mergeGroupLatestCompletedSessionIdById?.[row.group.id],
                        }}
                        members={row.members}
                        remaining={row.remaining}
                        busy={busy}
                        command={command}
                        onOpen={setDetailTaskId}
                        dragProps={mergeCardDragProps(row.group)}
                        memberDrag={memberDragProps(row.group)}
                        runningFocus={runningFocus}
                      />
                    );
                  }
                  const task = row.task;
                  const index = views.activeTasks.findIndex((candidate) => candidate.id === task.id);
                  return (
                <div key={task.id} className="task-tree-group">
                <div
                  className={`activity-tree-row atr-group draggable ${rowDragClass(`list-${task.id}`)}`}
                  draggable={!busy && !batchAction}
                  onDragStart={(event) => {
                    setDrag(event, { from: 'list', taskId: task.id, index });
                    setDraggingKey(`list-${task.id}`);
                    setDraggedTaskId(task.id);
                  }}
                  onDragOver={(event) => hoverRow(event, `list-${task.id}`, task)}
                  onDragEnd={clearDrag}
                  onDrop={(event) => {
                    const position = dropPosition;
                    const drag = parseDrag(event);
                    clearDrag();
                    if (position === 'merge' && typeof drag?.taskId === 'string') {
                      event.preventDefault();
                      event.stopPropagation();
                      mergeInto(drag.taskId, task);
                      return;
                    }
                    const reorder = activityReorderPayload(drag, index, position);
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
                      className="icon-btn"
                      disabled={busy}
                      title="任务详情、备注与层级"
                      onClick={() => setDetailTaskId(task.id)}
                    >
                      <Icon name="info" size={12}/>
                    </button>
                    <button
                      className="icon-btn"
                      disabled={busy || isTaskRunningFocus(task, runningFocusTaskId)}
                      title={
                        isTaskRunningFocus(task, runningFocusTaskId)
                          ? '本轮专注进行中，结束后再完成'
                          : '手动完成'
                      }
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
                );
                })}
              </div>
            )}
            <AddTaskInput
              placeholder="任务名称，回车创建…"
              disabled={busy}
              focusRequest={activityInputFocusRequest}
              onCreate={(title) => command((time) => createManualTask({
                ...time, title, destination: 'list',
              }))}
            />
          </ListScrollRegion>
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
              <button className="btn ghost sm" disabled={busy} onClick={() => setTodayInputFocusRequest((request) => request + 1)}>新增</button>
              <span className="kan-count" style={{ color: metrics.overloadedPomodoros > 0 ? 'var(--accent-ink)' : 'var(--muted)' }}>
                余 {metrics.remainingPomodoros}
                {metrics.overloadedPomodoros > 0 && ` · 超载 ${metrics.overloadedPomodoros}`}
              </span>
              <button className="btn ghost sm" disabled={busy || activeToday.length === 0} onClick={() => beginBatch('moveToList')}>批量移回</button>
            </span>
          </div>
          <ListScrollRegion className={activeToday.length === 0 && completedToday.length === 0 ? 'is-empty' : ''}>
            {activeToday.length === 0 && completedToday.length === 0 && (
              <EmptyState
                icon="arrow-day"
                title="今天还没有安排"
                hint="从左边的清单把事项拖过来，或在下方直接新建今日任务。"
              />
            )}
            {todayTreeRows.map((row) => {
              if (row.kind === 'merge') {
                return (
                  <MergeGroupBlock
                    key={row.key}
                    group={{
                      ...row.group,
                      latestCompletedSessionId: views.mergeGroupLatestCompletedSessionIdById?.[row.group.id],
                    }}
                    members={row.members}
                    remaining={row.remaining}
                    busy={busy}
                    command={command}
                    onOpen={setDetailTaskId}
                    dragProps={mergeCardDragProps(row.group)}
                    memberDrag={memberDragProps(row.group)}
                    runningFocus={runningFocus}
                    showEstimate
                    estimateEditRequest={estimateEditRequest}
                    onEditRequestHandled={() => setEstimateEditRequest(null)}
                    onAdvance={() => setEstimateEditRequest(null)}
                  />
                );
              }
              const task = row.task;
              const activeIndex = activeToday.findIndex((candidate) => candidate.id === task.id);
              const dayPlanIndex = dayPlanIndexOf(views.todayTasks, task.id);
              const nextEstimateTask = activeToday
                .slice(activeIndex + 1)
                .find((candidate) => canEditEstimate(candidate, false, runningFocusTaskId));
              return (
              <div key={task.id} className="today-task-block">
                <div
                  className={`activity-tree-row atr-group draggable today-task-row ${rowDragClass(`today-${task.id}`)}`}
                  draggable={!busy && !batchAction}
                  onDragStart={(event) => {
                    setDrag(event, { from: 'today', taskId: task.id, index: dayPlanIndex });
                    setDraggingKey(`today-${task.id}`);
                    setDraggedTaskId(task.id);
                  }}
                  onDragOver={(event) => hoverRow(event, `today-${task.id}`, task)}
                  onDragEnd={clearDrag}
                  onDrop={(event) => {
                    const position = dropPosition;
                    clearDrag();
                    event.preventDefault();
                    event.stopPropagation();
                    const drag = parseDrag(event);
                    if (position === 'merge' && typeof drag?.taskId === 'string') {
                      mergeInto(drag.taskId, task);
                      return;
                    }
                    if (drag?.from === 'list') {
                      const addedAtIndex = position === 'after' ? dayPlanIndex + 1 : dayPlanIndex;
                      command((time) => addTaskToToday({
                        ...time, taskId: drag.taskId, source: 'drag', addedAtIndex,
                      }));
                    } else if (drag?.from === 'today') {
                      const toIndex = dropInsertIndex(drag.index, dayPlanIndex, position);
                      if (toIndex !== drag.index) {
                        command((time) => reorderTodayTask({ ...time, fromIndex: drag.index, toIndex }));
                      }
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
                      className="icon-btn"
                      disabled={busy}
                      title="任务详情、备注与层级"
                      onClick={() => setDetailTaskId(task.id)}
                    >
                      <Icon name="info" size={12}/>
                    </button>
                    <span className="today-est-pill">
                      <EstimateEditor
                        task={task}
                        disabled={busy}
                        runningFocusTaskId={runningFocusTaskId}
                        editRequested={estimateEditRequest === task.id}
                        onEditRequestHandled={() => setEstimateEditRequest(null)}
                        onAdvance={() => setEstimateEditRequest(nextEstimateTask?.id ?? null)}
                        onSave={(estimatedPomodoros) => command((time) => adjustTaskEstimate({
                          ...time, taskId: task.id, estimatedPomodoros,
                        }))}
                      />
                    </span>
                    <button
                      className="icon-btn"
                      disabled={busy || isTaskRunningFocus(task, runningFocusTaskId)}
                      title={
                        isTaskRunningFocus(task, runningFocusTaskId)
                          ? '本轮专注进行中，结束后再完成'
                          : '手动完成'
                      }
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
            <AddTaskInput
              placeholder="直接新建今日任务…"
              disabled={busy}
              focusRequest={todayInputFocusRequest}
              onCreate={(title) => command((time) => createManualTask({
                ...time, title, destination: 'today',
              }))}
            />
          </ListScrollRegion>
        </div>
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
            {views.completedTasks.filter((task) => !liveMergeMemberIds.has(task.id)).map((task) => (
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
                    {completionSourceLabel(task.completionSource)} · {completedTaskTimeLabel(task, views.completionTimingByTaskId[task.id])}
                  </span>
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
          {views.archivedTasks.length === 0 && (
            <EmptyState
              icon="check"
              title="还没有归档记录"
              hint="完成并归档的任务会收在这里，方便日后回看。"
            />
          )}
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

      {blockedReason && (
        <div className="merge-drop-hint" role="status" aria-live="polite">{blockedReason}</div>
      )}
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
          runningFocusTaskId={runningFocusTaskId}
          command={command}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}
