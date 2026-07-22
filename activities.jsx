// Activities view: 2-column layout — 活动清单 (left) / 今日待办 (right).
// Both columns are views over one unified `tasks` array; a task's `bucket`
// ('list' | 'today') decides which column it shows in. Subtasks live on the task.

const fmtCompletedDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
};

const fmtCompletedStamp = (task) => {
  if (task.completedDate) {
    return `${fmtCompletedDate(task.completedDate)}${task.finishedAt ? ` ${task.finishedAt}` : ''}`;
  }
  return task.finishedAt || '';
};

// Horizontal indent (px) of a child row; also the X threshold for "nest as child" while dragging.
const CHILD_INDENT = 26;

// === main view ===
const ActivitiesView = ({ state, setState }) => {
  const { budget, settings } = state;
  const tasks = state.tasks || [];
  const [newTodayName, setNewTodayName] = React.useState('');
  const [editingTodayId, setEditingTodayId] = React.useState(null);
  const [editingKey, setEditingKey] = React.useState(null);
  const [chainAdd, setChainAdd] = React.useState(false);
  const skipBlurRef = React.useRef(null);
  const [estimateHintId, setEstimateHintId] = React.useState(null);
  const [showPlanner, setShowPlanner] = React.useState(false);
  const estimateHintTimer = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => () => {
    if (estimateHintTimer.current) clearTimeout(estimateHintTimer.current);
  }, []);

  const showEstimateHint = (id) => {
    setEstimateHintId(id);
    if (estimateHintTimer.current) clearTimeout(estimateHintTimer.current);
    estimateHintTimer.current = setTimeout(() => setEstimateHintId(null), 1400);
  };

  // drag state — one descriptor shared by both columns
  const [drag, setDrag] = React.useState(null);       // {from, kind, taskId, subId, key, hasSubs, idx}
  const [listDrop, setListDrop] = React.useState(null); // {gap, depth}
  const [todayDrop, setTodayDrop] = React.useState(null); // {idx, pos}
  const [listColActive, setListColActive] = React.useState(false);
  const [todayColActive, setTodayColActive] = React.useState(false);
  const clearDrag = () => { setDrag(null); setListDrop(null); setTodayDrop(null); setListColActive(false); setTodayColActive(false); };

  // derived buckets
  const listTasks = tasks.filter(t => t.bucket === 'list');
  const activeToday = tasks.filter(t => t.bucket === 'today' && t.status === 'active');
  const doneToday = tasks.filter(t => t.bucket === 'today' && t.status === 'done');
  const todayTasks = tasks.filter(t => t.bucket === 'today');
  const taskById = (id) => tasks.find(t => t.id === id);

  // flatten the list bucket into visible tree rows (parent header + indented subtasks)
  const listRows = [];
  listTasks.forEach((t) => {
    listRows.push({ key: t.id, kind: 'group', taskId: t.id, subId: null, depth: 0, name: t.name });
    t.subtasks.forEach((st) => {
      listRows.push({ key: `${t.id}:${st.id}`, kind: 'item', taskId: t.id, subId: st.id, depth: 1, name: st.name, done: st.done });
    });
  });

  // budget calc
  const totalMin = Math.max(0, hhmmToMin(budget.end) - hhmmToMin(budget.start));
  const dedMin = budget.deductions.reduce((a,d) => a + (Number(d.hours)||0) * 60, 0);
  const freeMin = Math.max(0, totalMin - dedMin);
  const adjust = budget.adjust || 0;
  const pomos = Math.max(0, Math.floor(freeMin / (settings.focusMin + settings.shortMin)) + adjust);
  const plannedPomos = todayTasks.reduce((a, t) => a + t.estimates.reduce((x,y)=>x+y,0), 0);
  const remaining = pomos - plannedPomos;
  const dedHours = budget.deductions.reduce((a,d) => a + (Number(d.hours)||0), 0);

  // === bucket helpers (keep order: list, today-active, today-done) ===
  const splitBuckets = (all) => ({
    list: all.filter(t => t.bucket === 'list'),
    active: all.filter(t => t.bucket === 'today' && t.status === 'active'),
    done: all.filter(t => t.bucket === 'today' && t.status === 'done'),
  });
  const combine = ({ list, active, done }) => [...list, ...active, ...done];

  // === task / subtask operations (work on any bucket, matched by id) ===
  // 活动清单 add flow: the header + creates an empty task in edit mode; pressing Enter
  // commits it and opens a fresh one (a chain), so several tasks can be added in a row.
  const startAddDraft = () => {
    discardEmptyListDrafts();
    const t = makeTask({ name: '', bucket: 'list' });
    setState(s => { const b = splitBuckets(s.tasks); b.list = [...b.list, t]; return { ...s, tasks: combine(b) }; });
    setChainAdd(true);
    setEditingKey(t.id);
  };
  const discardEmptyListDrafts = () => {
    setState(s => ({
      ...s,
      tasks: s.tasks.filter(t => !(t.bucket === 'list' && !t.name.trim() && t.subtasks.length === 0))
    }));
    skipBlurRef.current = null;
    setChainAdd(false);
  };
  const beginEditingKey = (key) => {
    if (key !== editingKey) discardEmptyListDrafts();
    setEditingKey(key);
  };
  const commitGroupEdit = (row, value, viaEnter) => {
    const v = value.trim();
    if (v) {
      updateTaskName(row.taskId, v);
      if (chainAdd && viaEnter) {
        const t = makeTask({ name: '', bucket: 'list' });
        setState(s => { const b = splitBuckets(s.tasks); b.list = [...b.list, t]; return { ...s, tasks: combine(b) }; });
        setEditingKey(t.id);
        return;
      }
    } else if (chainAdd) {
      deleteTask(row.taskId); // discard the still-empty new task
    }
    setEditingKey(null);
    setChainAdd(false);
  };
  const cancelGroupEdit = (row) => {
    const t = taskById(row.taskId);
    if (chainAdd && t && !t.name.trim()) deleteTask(row.taskId);
    setEditingKey(null);
    setChainAdd(false);
  };

  const addTodayTask = () => {
    if (!newTodayName.trim()) return;
    setState(s => {
      const b = splitBuckets(s.tasks);
      b.active = [...b.active, makeTask({ name: newTodayName.trim(), bucket: 'today' })];
      return { ...s, tasks: combine(b) };
    });
    setNewTodayName('');
  };

  const deleteTask = (taskId) => setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== taskId) }));
  const updateTaskName = (taskId, name) => setState(s => ({
    ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, name } : t)
  }));

  const addChild = (taskId) => {
    const sub = makeSubtask('新子任务');
    setState(s => ({ ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, subtasks: [...t.subtasks, sub] } : t) }));
    setEditingKey(`${taskId}:${sub.id}`);
  };
  const deleteSubtask = (taskId, subId) => setState(s => ({
    ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, subtasks: t.subtasks.filter(st => st.id !== subId) } : t)
  }));
  // Removes a subtask from a today-task and promotes it as a new top-level list task.
  const retireSubtaskToList = (taskId, subId) => setState(s => {
    const sub = s.tasks.find(t => t.id === taskId)?.subtasks.find(st => st.id === subId);
    if (!sub) return s;
    const tasks = s.tasks.map(t => t.id === taskId
      ? { ...t, subtasks: t.subtasks.filter(st => st.id !== subId) }
      : t
    );
    const b = splitBuckets(tasks);
    b.list = [...b.list, makeTask({ name: sub.name, bucket: 'list' })];
    return { ...s, tasks: combine(b) };
  });
  const updateSubtask = (taskId, subId, name) => setState(s => ({
    ...s, tasks: s.tasks.map(t => t.id === taskId
      ? { ...t, subtasks: t.subtasks.map(st => st.id === subId ? { ...st, name } : st) } : t)
  }));
  const toggleSubtask = (taskId, subId, done) => setState(s => ({
    ...s, tasks: s.tasks.map(t => t.id === taskId
      ? { ...t, subtasks: t.subtasks.map(st => st.id === subId ? { ...st, done, doneAt: done ? (st.doneAt || null) : null } : st) } : t)
  }));

  // === list-tree rebuild (depth 0 = parent task, 1 = subtask) ===
  const rebuildList = (nodes, override) => {
    const out = [];
    let cur = null;
    for (const n of nodes) {
      let depth = n.kind === 'group' ? 0 : 1;
      if (override && n === override.node) depth = override.depth;
      if (depth === 0) {
        cur = n.kind === 'group' ? { ...n.task, subtasks: [] } : makeTask({ name: n.sub.name, bucket: 'list' });
        out.push(cur);
      } else {
        if (!cur) {
          cur = n.kind === 'group' ? { ...n.task, subtasks: [] } : makeTask({ name: n.sub.name, bucket: 'list' });
          out.push(cur);
        } else if (n.kind === 'item') {
          cur.subtasks.push(n.sub);
        } else {
          cur.subtasks.push(makeSubtask(n.task.name));
        }
      }
    }
    return out;
  };

  const buildListNodes = (list) => {
    const nodes = [];
    list.forEach(t => {
      nodes.push({ kind: 'group', task: t, key: t.id });
      t.subtasks.forEach(st => nodes.push({ kind: 'item', sub: st, key: `${t.id}:${st.id}` }));
    });
    return nodes;
  };

  // reorder / indent inside the list bucket
  const applyListMove = (dragInfo, gap, depth) => setState(s => {
    const b = splitBuckets(s.tasks);
    const nodes = buildListNodes(b.list);
    const srcIdx = nodes.findIndex(n => n.key === dragInfo.key);
    if (srcIdx < 0) return s;
    const srcNode = nodes[srcIdx];
    const carriesSubtree = srcNode.kind === 'group' && srcNode.task.subtasks.length > 0;
    let removeCount = 1;
    if (carriesSubtree) { let j = srcIdx + 1; while (j < nodes.length && nodes[j].kind === 'item') { removeCount++; j++; } }
    const block = nodes.slice(srcIdx, srcIdx + removeCount);
    const rest = [...nodes.slice(0, srcIdx), ...nodes.slice(srcIdx + removeCount)];
    let insertAt = gap > srcIdx ? gap - removeCount : gap;
    insertAt = Math.max(0, Math.min(rest.length, insertAt));
    const snap = (idx) => { let i = idx; while (i < rest.length && rest[i].kind !== 'group') i++; return i; };
    let merged, override = null;
    if (carriesSubtree) {
      insertAt = snap(insertAt);
      merged = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
    } else {
      let d = insertAt === 0 ? 0 : depth;
      if (d === 0) insertAt = snap(insertAt);
      merged = [...rest.slice(0, insertAt), block[0], ...rest.slice(insertAt)];
      override = { node: block[0], depth: d };
    }
    b.list = rebuildList(merged, override);
    return { ...s, tasks: combine(b) };
  });

  // list → today
  const moveToToday = (dragInfo, insertAt) => setState(s => {
    const b = splitBuckets(s.tasks);
    let moved;
    if (dragInfo.kind === 'item') {
      const parent = b.list.find(t => t.id === dragInfo.taskId);
      const sub = parent && parent.subtasks.find(st => st.id === dragInfo.subId);
      if (!sub) return s;
      moved = makeTask({ name: sub.name, bucket: 'today' });
      b.list = b.list.map(t => t.id === dragInfo.taskId ? { ...t, subtasks: t.subtasks.filter(st => st.id !== dragInfo.subId) } : t);
    } else {
      const t = b.list.find(x => x.id === dragInfo.taskId);
      if (!t) return s;
      moved = { ...t, bucket: 'today', status: 'active', completed: 0, interrupts: { internal: 0, external: 0 }, cancelledPomos: 0, pomoEvents: [], finishedAt: null, completedDate: null };
      b.list = b.list.filter(x => x.id !== dragInfo.taskId);
    }
    const at = insertAt == null ? b.active.length : Math.max(0, Math.min(b.active.length, insertAt));
    b.active = [...b.active]; b.active.splice(at, 0, moved);
    return { ...s, tasks: combine(b) };
  });

  // today → list (drop into the tree at gap/depth)
  const moveToList = (dragInfo, gap, depth) => setState(s => {
    const b = splitBuckets(s.tasks);
    const src = [...b.active, ...b.done].find(x => x.id === dragInfo.taskId);
    if (!src) return s;
    const moved = { ...src, bucket: 'list', status: 'active', completed: 0, interrupts: { internal: 0, external: 0 }, cancelledPomos: 0, pomoEvents: [], finishedAt: null, completedDate: null };
    b.active = b.active.filter(x => x.id !== dragInfo.taskId);
    b.done = b.done.filter(x => x.id !== dragInfo.taskId);
    const nodes = buildListNodes(b.list);
    let g = Math.max(0, Math.min(nodes.length, gap));
    let d = moved.subtasks.length > 0 ? 0 : (g === 0 ? 0 : depth);
    const snap = (idx) => { let i = idx; while (i < nodes.length && nodes[i].kind !== 'group') i++; return i; };
    if (d === 0) g = snap(g);
    const movedNode = { kind: 'group', task: moved, key: moved.id };
    const movedItemNodes = (moved.subtasks || []).map(st => ({ kind: 'item', sub: st, key: `${moved.id}:${st.id}` }));
    nodes.splice(g, 0, movedNode, ...movedItemNodes);
    b.list = rebuildList(nodes, d === 1 ? { node: movedNode, depth: 1 } : null);
    return { ...s, tasks: combine(b) };
  });

  // reorder active today tasks
  const reorderToday = (fromIdx, toIdx) => setState(s => {
    const b = splitBuckets(s.tasks);
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= b.active.length || toIdx >= b.active.length) return s;
    const na = [...b.active];
    const [m] = na.splice(fromIdx, 1);
    na.splice(toIdx, 0, m);
    b.active = na;
    return { ...s, tasks: combine(b) };
  });

  // === today task tweaks ===
  const setEstimate = (id, n) => setState(s => ({ ...s,
    tasks: s.tasks.map(t => t.id === id ? { ...t, estimates: [Math.max(1, Math.min(9, n))], estimated: true } : t)
  }));
  // 今日待办 的"删除"= 移回活动清单（保留任务，不真正删除）
  const sendTodayToList = (taskId) => setState(s => {
    const b = splitBuckets(s.tasks);
    const t = [...b.active, ...b.done].find(x => x.id === taskId);
    if (!t) return s;
    b.active = b.active.filter(x => x.id !== taskId);
    b.done = b.done.filter(x => x.id !== taskId);
    b.list = [...b.list, { ...t, bucket: 'list', status: 'active', completed: 0, interrupts: { internal: 0, external: 0 }, cancelledPomos: 0, pomoEvents: [], finishedAt: null, completedDate: null }];
    return { ...s, tasks: combine(b) };
  });

  // === urgent ops ===
  const urgentToToday = (id) => setState(s => {
    const item = s.urgent.find(u => u.id === id);
    if (!item) return s;
    const b = splitBuckets(s.tasks);
    b.active = [makeTask({ name: item.name, bucket: 'today' }), ...b.active];
    return { ...s, urgent: s.urgent.filter(u => u.id !== id), tasks: combine(b) };
  });
  const urgentToLater = (id) => setState(s => {
    const item = s.urgent.find(u => u.id === id);
    if (!item) return s;
    return { ...s, urgent: s.urgent.filter(u => u.id !== id),
      tasks: [makeTask({ name: item.name, bucket: 'list' }), ...s.tasks] };
  });
  const deleteUrgent = (id) => setState(s => ({ ...s, urgent: s.urgent.filter(u => u.id !== id) }));

  // === planner ops ===
  const updateBudget = (patch) => setState(s => ({ ...s, budget: { ...s.budget, ...patch } }));
  const bumpDeduction = (delta) => {
    const cur = budget.deductions.reduce((a,d) => a + (Number(d.hours)||0), 0);
    setState(s => ({ ...s, budget: { ...s.budget,
      deductions: [{ id: 'd', hours: Math.max(0, +(cur + delta).toFixed(1)) }] } }));
  };

  // === drag wiring ===
  const listRowDrag = (row) => ({
    draggable: editingKey !== row.key,
    onDragStart: (e) => {
      setDrag({ from: 'list', kind: row.kind, taskId: row.taskId, subId: row.subId, key: row.key,
        hasSubs: row.kind === 'group' && (taskById(row.taskId)?.subtasks.length > 0) });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.key);
    },
    onDragEnd: clearDrag,
  });

  const todayRowDrag = (t, idx) => ({
    draggable: true,
    onDragStart: (e) => {
      setDrag({ from: 'today', kind: 'group', taskId: t.id, subId: null, idx, hasSubs: t.subtasks.length > 0 });
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: clearDrag,
  });

  const computeListDrop = (e) => {
    const listEl = listRef.current;
    if (!listEl || !drag) return null;
    const rowEls = Array.from(listEl.querySelectorAll('.activity-tree-row'));
    let gap = rowEls.length;
    for (let k = 0; k < rowEls.length; k++) {
      const r = rowEls[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { gap = k; break; }
    }
    const carriesSubtree = drag.kind === 'group' && drag.hasSubs;
    if (carriesSubtree) {
      let g = gap;
      while (g < listRows.length && listRows[g].kind !== 'group') g++;
      return { gap: g, depth: 0 };
    }
    const baseLeft = (rowEls[0] || listEl).getBoundingClientRect().left;
    const xOffset = e.clientX - baseLeft;
    let depth;
    if (drag.from === 'today') {
      // Cross-column: child intent only when cursor is explicitly in the child-indent zone
      // Child items sit at ~20px left margin; allow a deliberate band around that area.
      // Beyond ~55px the cursor is in the text area → default to parent insertion.
      depth = (xOffset > 15 && xOffset < 55) ? 1 : 0;
    } else {
      // In-list reorder: any position to the right of CHILD_INDENT triggers nesting
      depth = xOffset > CHILD_INDENT ? 1 : 0;
    }
    if (gap === 0) depth = 0;
    return { gap, depth };
  };

  const listColProps = {
    ref: listRef,
    onDragOver: (e) => {
      if (!drag) return;
      e.preventDefault();
      const d = computeListDrop(e);
      if (d) setListDrop(d);
      if (drag.from === 'today') setListColActive(true);
    },
    onDragLeave: (e) => {
      if (listRef.current && !listRef.current.contains(e.relatedTarget)) { setListDrop(null); setListColActive(false); }
    },
    onDrop: (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.from === 'list' && listDrop) applyListMove(drag, listDrop.gap, listDrop.depth);
      else if (drag.from === 'today' && listDrop) moveToList(drag, listDrop.gap, listDrop.depth);
      clearDrag();
    },
  };

  const todayDropProps = (idx) => ({
    onDragOver: (e) => {
      if (!drag) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientY - rect.top) < rect.height / 2 ? 'above' : 'below';
      setTodayDrop({ idx, pos });
      if (drag.from === 'list') setTodayColActive(true);
    },
    onDrop: (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      const insertAt = todayDrop?.pos === 'above' ? idx : idx + 1;
      if (drag.from === 'today') {
        const adj = insertAt > drag.idx ? insertAt - 1 : insertAt;
        reorderToday(drag.idx, adj);
      } else if (drag.from === 'list') {
        moveToToday(drag, insertAt);
      }
      clearDrag();
    },
  });

  const todayColProps = {
    onDragOver: (e) => {
      if (!drag || drag.from !== 'list') return;
      e.preventDefault();
      setTodayColActive(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setTodayColActive(false);
    },
    onDrop: (e) => {
      if (!drag || drag.from !== 'list') return;
      e.preventDefault();
      moveToToday(drag, null);
      clearDrag();
    },
  };

  const todayItemCls = (idx) => {
    let cls = 'activity-tree-row atr-group draggable today-task-row';
    if (drag?.from === 'today' && drag.idx === idx) cls += ' drag-source';
    if (todayDrop?.idx === idx) cls += todayDrop.pos === 'above' ? ' drop-above' : ' drop-below';
    return cls;
  };

  // Child items are indented 20px; use that value so the insert line aligns visually.
  const DROP_CHILD_INDENT = 20;
  const dropLine = (gap) => (
    listDrop && listDrop.gap === gap
      ? <div
          className={`activity-drop-line${listDrop.depth === 1 ? ' depth-child' : ''}`}
          style={{ marginLeft: listDrop.depth * DROP_CHILD_INDENT }}
        />
      : null
  );

  return (
    <div>
      <div className="main-head">
        <div>
          <h1>清单与计划</h1>
          <div className="sub">在活动清单里整理想法，移到今日待办后开始番茄。</div>
        </div>
        <div className="right" style={{gap: 20}}>
          <div className="bb-stat" style={{textAlign:'right'}}>
            <div className="bb-l">自由时长</div>
            <div className="bb-v" style={{color:'var(--accent-ink)', fontSize:18}}>{(freeMin/60).toFixed(1)}<span className="unit">h</span></div>
          </div>
          <div className="bb-divider"/>
          <div className="bb-stat" style={{textAlign:'right'}}>
            <div className="bb-l">番茄预算</div>
            <div className="bb-v" style={{fontSize:18}}>
              {pomos}<span className="unit"> 个</span>
            </div>
          </div>
          <button className="btn" onClick={() => setShowPlanner(true)}>
            <Icon name="clock" size={13}/> 估算
          </button>
        </div>
      </div>

      {state.urgent && state.urgent.length > 0 && (
        <div style={{marginBottom: 18}}>
          <div className="section-h" style={{marginTop: 0}}>
            <h3><Icon name="urgent" size={12}/> &nbsp;计划外紧急</h3>
            <span className="count">{state.urgent.length} 条待处理</span>
          </div>
          <div className="card">
            {state.urgent.map(u => (
              <div key={u.id} className="urgent-row">
                <div className="urgent-row-name">{u.name}</div>
                <div className="urgent-row-actions">
                  <button className="btn sm" onClick={() => urgentToToday(u.id)} title="加入今日（置顶）">
                    <Icon name="arrow-day" size={12}/> 今日
                  </button>
                  <button className="btn sm" onClick={() => urgentToLater(u.id)} title="放入活动清单">
                    <Icon name="clock" size={12}/> 之后
                  </button>
                  <button className="btn sm" onClick={() => deleteUrgent(u.id)} title="删除">
                    <Icon name="x" size={12}/> 删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2-column kanban */}
      <div className="kanban" style={{gridTemplateColumns:'1fr 1fr'}}>
        {/* col 1: 活动清单 */}
        <div className={`kan-col activity-list-col${listColActive ? ' drop-active' : ''}`}>
          <div className="kan-head">
            <span><Icon name="list" size={13}/> &nbsp;活动清单</span>
            <span className="kan-head-right">
              <button className="icon-btn kan-head-add" onClick={startAddDraft} title="新建任务">
                <Icon name="plus" size={14}/>
              </button>
            </span>
          </div>

          {listRows.length === 0 && (
            <div className="empty">清单里暂时没有活动，点击右上角 + 新建。</div>
          )}

          <div className="activity-tree" {...listColProps}>
            {listRows.map((row, i) => (
              <React.Fragment key={row.key}>
                {dropLine(i)}
                <div data-row-index={i}
                  className={`activity-tree-row ${row.kind === 'group' ? 'atr-group' : 'atr-item'} ${drag?.key === row.key && drag?.from === 'list' ? 'drag-source' : ''}`}
                  {...listRowDrag(row)}
                  title="拖动可排序 / 缩进，或拖到今日待办">
                  {row.kind === 'group' ? (
                    <span className="atr-bullet" />
                  ) : (
                    <span className={`atr-check ${row.done ? 'is-done' : ''}`} />
                  )}
                  {editingKey === row.key ? (
                    <input className="input atr-input" autoFocus defaultValue={row.name}
                      placeholder={row.kind === 'group' ? '任务名称，回车继续添加…' : ''}
                      onMouseDown={e => e.stopPropagation()}
                      onBlur={e => {
                        if (row.kind === 'group') {
                          if (skipBlurRef.current === row.key) { skipBlurRef.current = null; return; }
                          skipBlurRef.current = null;
                          commitGroupEdit(row, e.target.value, false);
                        } else {
                          updateSubtask(row.taskId, row.subId, e.target.value.trim() || row.name);
                          setEditingKey(null);
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (row.kind === 'group') { e.preventDefault(); skipBlurRef.current = row.key; commitGroupEdit(row, e.target.value, true); }
                          else e.target.blur();
                        } else if (e.key === 'Escape') {
                          if (row.kind === 'group') { e.preventDefault(); skipBlurRef.current = row.key; cancelGroupEdit(row); }
                          else setEditingKey(null);
                        }
                      }}/>
                  ) : (
                    <span className={row.kind === 'group' ? 'atr-name' : 'atr-item-name'}
                      style={row.kind === 'item' && row.done ? {textDecoration:'line-through', color:'var(--muted-2)', opacity:0.6} : undefined}
                      onClick={() => beginEditingKey(row.key)}>
                      {row.name}
                    </span>
                  )}
                  <span className="atr-actions" onMouseDown={e => e.stopPropagation()}>
                    {row.kind === 'group' && (
                      <button className="icon-btn" title="添加子任务" onClick={() => addChild(row.taskId)}>
                        <Icon name="plus" size={12}/>
                      </button>
                    )}
                    <button className="icon-btn" title="删除"
                      onClick={() => row.kind === 'group' ? deleteTask(row.taskId) : deleteSubtask(row.taskId, row.subId)}>
                      <Icon name="x" size={12}/>
                    </button>
                  </span>
                </div>
              </React.Fragment>
            ))}
            {dropLine(listRows.length)}
          </div>
        </div>

        {/* col 2: 今日待办 */}
        <div className={`kan-col today-list-col ${todayColActive ? 'drop-active' : ''}`} {...todayColProps}>
          <div className="kan-head">
            <span><Icon name="arrow-day" size={13}/> &nbsp;今日待办</span>
            <span className="kan-count" style={{color: remaining < 0 ? 'var(--accent-ink)' : 'var(--muted)'}}>余 {remaining}</span>
          </div>

          {activeToday.length === 0 && doneToday.length === 0 && (
            <div className="empty">从活动清单拖入事项。</div>
          )}

          {activeToday.map((t, idx) => {
            const est = t.estimates.reduce((a,b)=>a+b,0);
            const isEditing = editingTodayId === t.id;
            const hasPomoHistory = t.completed > 0 || (t.cancelledPomos || 0) > 0 || normalizePomoEvents(t.pomoEvents).length > 0;
            const isInProgress = t.estimates.length > 1 || hasPomoHistory;
            return (
              <div key={t.id} className="today-task-block">
                <div className={todayItemCls(idx)} {...todayRowDrag(t, idx)} {...todayDropProps(idx)}>
                  <span className="atr-bullet" />
                  <TodayNameCell name={t.name} onSave={(name) => updateTaskName(t.id, name)}/>
                  <div className="today-task-tools" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                    <span className="today-est-pill">
                      {isEditing ? (
                        <input className="mono today-est-input" type="text" inputMode="numeric"
                          autoFocus defaultValue={est}
                          onFocus={e => e.target.select()}
                          onBlur={e => {
                            const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
                            if (Number.isFinite(n) && n >= 1 && n <= 9) setEstimate(t.id, n);
                            setEditingTodayId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') setEditingTodayId(null);
                          }}/>
                      ) : (
                        <button className={`mono today-est-num-btn ${isInProgress ? 'locked' : ''}`}
                          title={isInProgress ? '已开始，不可改预估' : '点击编辑预估番茄数'}
                          onClick={() => { if (isInProgress) showEstimateHint(t.id); else setEditingTodayId(t.id); }}>
                          {est}
                        </button>
                      )}
                      {estimateHintId === t.id && (
                        <span className="today-est-hint">已开始后不可改预估</span>
                      )}
                    </span>
                  </div>
                </div>

                {t.subtasks.length > 0 && (
                  <div className="today-subtasks">
                    {t.subtasks.map(st => (
                      <div key={st.id} className="activity-tree-row atr-item today-subtask-row">
                        <span className={`atr-check today-subtask-check ${st.done ? 'is-done' : ''}`}
                          onClick={() => toggleSubtask(t.id, st.id, !st.done)} />
                        {editingKey === `${t.id}:${st.id}` ? (
                          <input className="input atr-input" autoFocus defaultValue={st.name}
                            onBlur={e => { updateSubtask(t.id, st.id, e.target.value.trim() || st.name); setEditingKey(null); }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.target.blur();
                              if (e.key === 'Escape') setEditingKey(null);
                            }}/>
                        ) : (
                          <span className="atr-item-name today-subtask-name"
                            style={st.done ? {textDecoration:'line-through', color:'var(--muted-2)', opacity:0.6} : undefined}
                            onClick={() => beginEditingKey(`${t.id}:${st.id}`)}>
                            {st.name}
                          </span>
                        )}
                        <button className="icon-btn today-subtask-del" onClick={() => retireSubtaskToList(t.id, st.id)} title="移回活动清单">
                          <Icon name="x" size={11}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        </div>
      </div>

      <div style={{marginTop: 14, fontSize: 12, color: 'var(--muted-2)', textAlign:'center'}}>
        清单内拖动可排序或缩进为子任务；两栏之间互相拖动即可在「活动清单」与「今日待办」间移动。
      </div>

      {doneToday.length > 0 && (
        <div className="completed-section">
          <div className="section-h">
            <h3><Icon name="check" size={12}/> &nbsp;已完成</h3>
            <span className="count">{doneToday.length} 个</span>
          </div>
          <div className="card completed-card">
            {doneToday.map(t => (
              <div key={t.id} className="completed-row-item">
                <div className="completed-row-head">
                  <span className="completed-done-name">{t.name}</span>
                  <span className="completed-done-date">已完成：{fmtCompletedStamp(t)}</span>
                </div>
                {t.subtasks.length > 0 && (
                  <div className="completed-subtasks">
                    {t.subtasks.map(st => (
                      <div key={st.id} className="completed-subtask">
                        <span className="completed-subtask-mark" style={{color: st.done ? 'var(--success)' : 'var(--muted-2)'}}>
                          {st.done ? '☑' : '☐'}
                        </span>
                        <span className="completed-subtask-name" style={st.done ? {textDecoration:'line-through'} : undefined}>
                          {st.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showPlanner && (
        <Modal onClose={() => setShowPlanner(false)}>
          <h2>估算今日可用时间</h2>
          <div className="sub">先框出工作时段，再扣掉今天不能专注的时间。</div>
          <div style={{marginTop: 18, marginBottom: 18}}>
            <div className="planner-row">
              <div className="planner-l">工作时段</div>
              <div className="time-pill">
                <input className="mono" value={budget.start} onChange={e => updateBudget({ start: e.target.value })}/>
                <span style={{color:'var(--muted)'}}>—</span>
                <input className="mono" value={budget.end} onChange={e => updateBudget({ end: e.target.value })}/>
              </div>
              <div className="planner-eq">= {(totalMin/60).toFixed(1)} h</div>
            </div>
            <div className="planner-row">
              <div className="planner-l">扣除时长</div>
              <div className="time-pill" style={{padding:'2px 4px', gap:4}}>
                <button className="icon-btn" style={{width:20, height:20}} onClick={() => bumpDeduction(-0.5)}>
                  <Icon name="minus" size={11}/>
                </button>
                <span className="mono" style={{minWidth:36, textAlign:'center'}}>{dedHours.toFixed(1)}h</span>
                <button className="icon-btn" style={{width:20, height:20}} onClick={() => bumpDeduction(0.5)}>
                  <Icon name="plus" size={11}/>
                </button>
              </div>
              <div className="planner-eq" style={{color:'var(--muted-2)'}}>会议 / 午休 / 其他</div>
            </div>
          </div>
          <div className="budget-summary">
            <div className="stat">
              <div className="l">总时长</div>
              <div className="v">{(totalMin/60).toFixed(1)}<span className="unit">h</span></div>
            </div>
            <div className="stat">
              <div className="l">自由时长</div>
              <div className="v" style={{color:'var(--accent-ink)'}}>{(freeMin/60).toFixed(1)}<span className="unit">h</span></div>
            </div>
            <div className="stat">
              <div className="l">番茄预算</div>
              <div className="v">{pomos}<span className="unit">个</span></div>
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'flex-end', marginTop:18}}>
            <button className="btn primary" onClick={() => setShowPlanner(false)}>完成</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// Inline-editable today task name
const TodayNameCell = ({ name, onSave }) => {
  const [editing, setEditing] = React.useState(false);
  if (editing) {
    return (
      <input className="input today-name-input" autoFocus defaultValue={name}
        onBlur={e => { onSave(e.target.value.trim() || name); setEditing(false); }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      />
    );
  }
  return <span className="atr-name today-name-text" onClick={() => setEditing(true)}>{name}</span>;
};

Object.assign(window, { ActivitiesView });
