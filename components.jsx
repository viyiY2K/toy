// Shared atoms: tiny stateless components + helpers shared across views.

// === icons (inline SVG, 16px standard) ===
const Icon = ({ name, size = 16, stroke = 1.5 }) => {
  const s = size;
  const props = {
    width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke,
    strokeLinecap: 'round', strokeLinejoin: 'round'
  };
  switch (name) {
    case 'play':return <svg {...props}><path d="M8 5l11 7-11 7V5z" fill="currentColor" stroke="none" /></svg>;
    case 'pause':return <svg {...props}><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></svg>;
    case 'skip':return <svg {...props}><path d="M5 5l9 7-9 7V5z" /><path d="M19 5v14" /></svg>;
    case 'plus':return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>;
    case 'minus':return <svg {...props}><path d="M5 12h14" /></svg>;
    case 'x':return <svg {...props}><path d="M18 6L6 18M6 6l12 12" /></svg>;
    case 'arrow-right':return <svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'arrow-left': return <svg {...props}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
    case 'grip':       return <svg {...props}><circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/></svg>;
    case 'arrow-up':return <svg {...props}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
    case 'arrow-down':return <svg {...props}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
    case 'check':return <svg {...props}><path d="M5 12l4 4L19 6" /></svg>;
    case 'archive':return <svg {...props}><rect x="3" y="5" width="18" height="4" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></svg>;
    case 'brain':return <svg {...props}><path d="M9 6a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 4 12a2.5 2.5 0 0 0 2 2.45V15a3 3 0 0 0 3 3h.5" /><path d="M15 6a3 3 0 0 1 3 3v.5A2.5 2.5 0 0 1 20 12a2.5 2.5 0 0 1-2 2.45V15a3 3 0 0 1-3 3h-.5" /><path d="M12 6v12" /></svg>;
    case 'bell':return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7zM10 19a2 2 0 0 0 4 0" /></svg>;
    case 'inbox':return <svg {...props}><path d="M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 3h6l1-3h5" /></svg>;
    case 'flame':return <svg {...props}><path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-3 2-4 2-6 1 2 3 2 3-3z" /></svg>;
    case 'clock':return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'list':return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01" /></svg>;
    case 'calendar':return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M9 3v4M15 3v4" /></svg>;
    case 'chart':return <svg {...props}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
    case 'sparkle':return <svg {...props}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" /></svg>;
    case 'shuffle':return <svg {...props}><path d="M16 4l4 4-4 4M4 8h6l2 2M20 16l-4 4-4-4M4 16h6l2-2" /></svg>;
    case 'urgent':return <svg {...props}><path d="M12 3L2 21h20L12 3z" /><path d="M12 10v4M12 17v.01" /></svg>;
    case 'split':return <svg {...props}><path d="M12 4v16M4 8l4-4 4 4M16 16l4 4-4 4" /></svg>;
    case 'history':return <svg {...props}><path d="M3 4v6h6" /><path d="M3 10a9 9 0 1 0 3-7" /><path d="M12 7v5l3 2" /></svg>;
    case 'arrow-day':return <svg {...props}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2" /></svg>;
    case 'chevron':return <svg {...props}><path d="M9 6l6 6-6 6" /></svg>;
    case 'chevron-down':return <svg {...props}><path d="M6 9l6 6 6-6" /></svg>;
    case 'coffee':return <svg {...props}><path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" /><path d="M16 11h2a2 2 0 0 1 0 4h-2" /><path d="M7 3v3M10 4v2M13 3v3" /></svg>;
    case 'folder':return <svg {...props}><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" /></svg>;
    default:return <svg {...props} />;
  }
};

// === pomodoro markers ===
const normalizeEstimates = (estimates) => (
  Array.isArray(estimates) && estimates.length ? estimates : [0]
).map((n) => Math.max(0, Math.floor(Number(n) || 0)));

const normalizePomoEvents = (events) => (Array.isArray(events) ? events : [])
  .filter((e) => e && (e.kind === 'done' || e.kind === 'cancelled'))
  .map((e) => ({
    kind: e.kind,
    attempt: Math.max(0, Math.floor(Number(e.attempt) || 0)),
    t: e.t || null,
  }));

const buildSlotsFromEvents = (estimates, events) => {
  const slots = [];
  normalizeEstimates(estimates).forEach((count, attempt) => {
    for (let i = 0; i < count; i++) slots.push({ attempt, status: 'pending' });
  });

  normalizePomoEvents(events).forEach((event, eventIndex) => {
    let slotIndex = slots.findIndex((slot) => slot.status === 'pending');
    if (slotIndex < 0) {
      slots.push({ attempt: event.attempt, status: 'pending' });
      slotIndex = slots.length - 1;
    }

    const attempt = Number.isFinite(event.attempt) ? event.attempt : slots[slotIndex].attempt;
    slots[slotIndex] = { ...slots[slotIndex], attempt, status: event.kind, eventIndex };
    if (event.kind === 'cancelled') {
      slots.splice(slotIndex + 1, 0, { attempt, status: 'pending', replacement: true });
    }
  });

  return slots;
};

const getNextPomoAttemptFromEvents = (estimates, events) => {
  const slots = buildSlotsFromEvents(estimates, events);
  const next = slots.find((slot) => slot.status === 'pending');
  if (next) return next.attempt;
  return Math.max(0, normalizeEstimates(estimates).length - 1);
};

const trimPomoEventsToTaskTotals = (task = {}, events = []) => {
  const targetDone = Math.max(0, Math.floor(Number(task.completed) || 0));
  const targetCancelled = Math.max(0, Math.floor(Number(task.cancelledPomos ?? task.cancelled) || 0));
  let done = 0;
  let cancelled = 0;
  const kept = [];

  normalizePomoEvents(events).slice().reverse().forEach((event) => {
    if (event.kind === 'done' && done < targetDone) {
      done += 1;
      kept.push(event);
    } else if (event.kind === 'cancelled' && cancelled < targetCancelled) {
      cancelled += 1;
      kept.push(event);
    }
  });

  return kept.reverse().reduce((rebuilt, event) => ([
    ...rebuilt,
    { ...event, attempt: getNextPomoAttemptFromEvents(task.estimates, rebuilt) },
  ]), []);
};

const seedPomoEvents = (task = {}) => {
  const estimates = normalizeEstimates(task.estimates);
  const events = trimPomoEventsToTaskTotals(task, task.pomoEvents || task.events);
  const targetDone = Math.max(0, Math.floor(Number(task.completed) || 0));
  const targetCancelled = Math.max(0, Math.floor(Number(task.cancelledPomos ?? task.cancelled) || 0));
  const doneInEvents = events.filter((e) => e.kind === 'done').length;
  const cancelledInEvents = events.filter((e) => e.kind === 'cancelled').length;

  const append = (kind) => {
    events.push({ kind, attempt: getNextPomoAttemptFromEvents(estimates, events) });
  };

  for (let i = cancelledInEvents; i < targetCancelled; i++) append('cancelled');
  for (let i = doneInEvents; i < targetDone; i++) append('done');
  return events;
};

const appendPomoEvent = (task = {}, kind, extra = {}) => {
  const history = seedPomoEvents(task);
  const attempt = getNextPomoAttemptFromEvents(task.estimates, history);
  return [...history, { kind, attempt, t: extra.t || null }];
};

const isDonePomoLog = (kind) => kind === 'focus-end' || kind === 'focus-early-end';
const isCancelledPomoLog = (kind) => kind === 'focus-discarded';

const derivePomoEventsFromLog = (task = {}, log = []) => {
  const events = [];
  (Array.isArray(log) ? log : []).forEach((entry) => {
    if (!entry || entry.taskId !== task.id) return;
    if (!isDonePomoLog(entry.kind) && !isCancelledPomoLog(entry.kind)) return;

    const kind = isCancelledPomoLog(entry.kind) ? 'cancelled' : 'done';
    events.push({
      kind,
      attempt: getNextPomoAttemptFromEvents(task.estimates, events),
      t: entry.t || null,
    });
  });
  return events;
};

const migratePomoState = (state = {}) => ({
  ...state,
  tasks: (state.tasks || []).map((task) => {
    const existing = trimPomoEventsToTaskTotals(task, task.pomoEvents || task.events);
    if (existing.length) return { ...task, pomoEvents: existing };

    const hasAggregateHistory = (task.completed || 0) > 0 || (task.cancelledPomos || task.cancelled || 0) > 0;
    if (!hasAggregateHistory && (Array.isArray(task.pomoEvents) || Array.isArray(task.events))) {
      return { ...task, pomoEvents: [] };
    }

    const fromLog = trimPomoEventsToTaskTotals(task, derivePomoEventsFromLog(task, state.log));
    if (fromLog.length) return { ...task, pomoEvents: fromLog };

    return { ...task, pomoEvents: seedPomoEvents(task) };
  }),
});

const buildPomoSlots = ({ estimates, completed = 0, cancelled = 0, events } = {}) => {
  const history = seedPomoEvents({
    estimates,
    completed,
    cancelledPomos: cancelled,
    pomoEvents: events,
  });
  return buildSlotsFromEvents(estimates, history);
};

const getNextPomoAttempt = (task = {}) => (
  getNextPomoAttemptFromEvents(task.estimates, seedPomoEvents(task))
);

const PomoMarkers = ({ estimates, completed = 0, cancelled = 0, events }) => {
  const slots = buildPomoSlots({ estimates, completed, cancelled, events });
  return (
    <span className="pomo-row">
      {slots.map((slot, i) => (
        <PomoMark key={`${slot.attempt}-${slot.status}-${i}`} status={slot.status} attempt={slot.attempt} />
      ))}
    </span>
  );
};

const PomoMark = ({ status, attempt }) => {
  const shape = attempt === 0 ? 'square' : attempt === 1 ? 'circle' : 'triangle';
  return (
    <span className={`pomo ${status} shape-${shape}`} aria-hidden="true">
      <svg viewBox="0 0 10 10" focusable="false">
        {shape === 'square' && <rect className="pomo-shape" x="2" y="2" width="6" height="6" rx="0.9" />}
        {shape === 'circle' && <circle className="pomo-shape" cx="5" cy="5" r="3.2" />}
        {shape === 'triangle' && <path className="pomo-shape" d="M5 1.7L8.5 8.1H1.5Z" />}
        {status === 'cancelled' && <path className="pomo-x" d="M3.1 3.1l3.8 3.8M6.9 3.1L3.1 6.9" />}
      </svg>
    </span>
  );
};

// === scale 1..5 ===
const Scale = ({ value, onChange, lowLabel = '低', highLabel = '高' }) =>
<div>
    <div className="scale">
      {[1, 2, 3, 4, 5].map((n) =>
    <button key={n} className={value === n ? 'sel' : ''} onClick={() => onChange(n)}>{n}</button>
    )}
    </div>
    <div className="scale" style={{ justifyContent: 'space-between', padding: '4px 2px 0' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lowLabel}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{highLabel}</span>
    </div>
  </div>;


// === energy bar 1..10 ===
const Bar10 = ({ value, onChange, lowLabel = '耗尽', highLabel = '充满' }) => {
  const [hover, setHover] = React.useState(null);
  const shown = hover ?? value;
  return (
    <div className="bar10">
      <div className="bar10-track" onMouseLeave={() => setHover(null)}>
        {[1,2,3,4,5,6,7,8,9,10].map(n => (
          <button key={n}
            className={`bar10-seg ${shown && n <= shown ? 'on' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            title={`${n} / 10`}/>
        ))}
      </div>
      <div className="bar10-labels">
        <span>{lowLabel}</span>
        <span className="bar10-value mono">{shown ? `${shown}/10` : '— / 10'}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
};


// === helpers ===
const fmtMMSS = (totalSec) => {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const hhmmToMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const minToHHMM = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const uid = () => Math.random().toString(36).slice(2, 9);

// Unified task + subtask factories. Every task (母任务) is the same shape and lives
// in one bucket: 'list' (活动清单) or 'today' (今日待办). Subtasks (子任务) live on the task.
const makeSubtask = (name) => ({ id: uid(), name, done: false, doneAt: null });
const makeTask = (props = {}) => ({
  id: uid(),
  name: '',
  bucket: 'list',
  subtasks: [],
  estimates: [1],
  estimated: false,
  completed: 0,
  pomoEvents: [],
  status: 'active',
  interrupts: { internal: 0, external: 0 },
  cancelledPomos: 0,
  finishedAt: null,
  completedDate: null,
  ...props,
});

// === Modal wrapper ===
const Modal = ({ children, onClose }) =>
<div className="modal-bg" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>;


Object.assign(window, { Icon, PomoMarkers, Scale, Bar10, Modal, fmtMMSS, hhmmToMin, minToHHMM, uid, makeTask, makeSubtask });
