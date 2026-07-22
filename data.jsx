// Initial mock data so the prototype shows realistic state on load.
const today = new Date();
const todayKey = today.toISOString().slice(0, 10);

const INITIAL = {
  __v: 5,           // bump to invalidate sessionStorage cache
  view: 'timer',
  // === unified task list ===
  // One array. Each task carries `bucket`: 'today' (今日待办) or 'list' (活动清单).
  // Subtasks (子任务) live on the task. Moving between columns just flips `bucket`.
  tasks: [
    // ——— 今日待办 ———
    {
      id: 't1', bucket: 'today', name: '设计稿走查 — 移动端首页',
      estimates: [2], estimated: true, completed: 2, status: 'done',
      interrupts: { internal: 1, external: 2 }, subtasks: [], cancelledPomos: 0,
      finishedAt: '10:42', completedDate: todayKey,
    },
    {
      id: 't2', bucket: 'today', name: '写月度复盘',
      estimates: [3, 1], estimated: true, completed: 4, status: 'done',
      interrupts: { internal: 2, external: 1 }, subtasks: [], cancelledPomos: 0,
      finishedAt: '13:20', completedDate: todayKey,
    },
    {
      id: 't3', bucket: 'today', name: '阅读《心流》第 4 章',
      estimates: [2], estimated: true, completed: 1, status: 'active',
      interrupts: { internal: 0, external: 0 }, cancelledPomos: 0,
      finishedAt: null, completedDate: null,
      subtasks: [
        { id: 'st1', name: '回复 Slack 上 Lin 的消息', done: false, doneAt: null },
        { id: 'st2', name: '把昨天的笔记归档', done: false, doneAt: null },
        { id: 'st3', name: '订咖啡豆', done: false, doneAt: null },
      ],
    },
    {
      id: 't4', bucket: 'today', name: '复习西语动词变位',
      estimates: [2], estimated: false, completed: 0, status: 'active',
      interrupts: { internal: 0, external: 0 }, subtasks: [], cancelledPomos: 0,
      finishedAt: null, completedDate: null,
    },
    // ——— 活动清单 ———
    {
      id: 'ag1', bucket: 'list', name: '阅读与学习',
      estimates: [2], estimated: true, completed: 0, status: 'active',
      interrupts: { internal: 0, external: 0 }, cancelledPomos: 0,
      finishedAt: null, completedDate: null,
      subtasks: [
        { id: 'agi1', name: '读《把时间当作朋友》', done: false, doneAt: null },
        { id: 'agi2', name: '整理读书笔记模板', done: false, doneAt: null },
      ],
    },
    {
      id: 'ag2', bucket: 'list', name: '设计工作',
      estimates: [3], estimated: true, completed: 0, status: 'active',
      interrupts: { internal: 0, external: 0 }, cancelledPomos: 0,
      finishedAt: null, completedDate: null,
      subtasks: [
        { id: 'agi3', name: '整理摄影素材库', done: false, doneAt: null },
        { id: 'agi4', name: '组件库走查', done: false, doneAt: null },
      ],
    },
    {
      id: 'ag3', bucket: 'list', name: '写作计划',
      estimates: [4], estimated: true, completed: 0, status: 'active',
      interrupts: { internal: 0, external: 0 }, cancelledPomos: 0,
      finishedAt: null, completedDate: null,
      subtasks: [
        { id: 'agi6', name: '列下半年选题', done: false, doneAt: null },
      ],
    },
  ],
  urgent: [
    { id: 'u1', name: '@Lin 的 PR review' },
  ],
  history: [],
  // === timer ===
  timer: {
    running: false,
    mode: 'focus',
    elapsed: 0,
    round: 1,
    currentTaskId: 't3',
    sessionStartedAt: null,
  },
  // === budget ===
  budget: {
    start: '09:30',
    end: '19:00',
    adjust: 0,
    deductions: [
      { id: 'd1', label: '午餐 + 散步', hours: 1.0 },
      { id: 'd2', label: '11:00 团队站会', hours: 0.5 },
      { id: 'd3', label: '下午 4 点会议', hours: 1.0 },
    ],
  },
  // === stats log ===
  log: [
    { t: '09:25', kind: 'energy-check', energy: 7 },
    { t: '09:55', kind: 'focus-end', taskId: 't1', energy: 8, dur: 25 },
    { t: '10:00', kind: 'break-end', energy: 9, suggestion: '远眺 20 秒 × 3' },
    { t: '10:25', kind: 'focus-end', taskId: 't1', energy: 7, dur: 25 },
    { t: '10:30', kind: 'break-end', energy: 6, suggestion: '梳头皮' },
    { t: '12:30', kind: 'energy-check', energy: 6 },
    { t: '12:55', kind: 'focus-end', taskId: 't2', energy: 8, dur: 25 },
    { t: '13:00', kind: 'break-end', energy: 9, suggestion: '散步' },
    { t: '13:25', kind: 'focus-end', taskId: 't2', energy: 7, dur: 25 },
    { t: '13:30', kind: 'long-break-end', energy: 9, suggestion: '听音乐' },
    { t: '13:55', kind: 'focus-end', taskId: 't2', energy: 5, dur: 25 },
    { t: '14:00', kind: 'break-end', energy: 8, suggestion: '散步' },
    { t: '14:25', kind: 'focus-end', taskId: 't2', energy: 6, dur: 25 },
    { t: '14:30', kind: 'break-end', energy: 5, suggestion: '收拾桌面' },
    { t: '17:30', kind: 'energy-check', energy: 5 },
    { t: '17:55', kind: 'focus-end', taskId: 't3', energy: 7, dur: 25 },
  ],
  // === settings ===
  settings: {
    focusMin: 25,
    shortMin: 5,
    longMin: 20,
    earlyBreakThresholdMin: 5,
    lifetimePomos: 47,
  },
};

const REST_SUGGESTIONS = {
  short: [
    '梳头皮','绕肩','原地踏步','一个拥抱','揉太阳穴','蝴蝶拍','伸懒腰','深呼吸',
    '脚趾舞','原地伸展','手指舞','喝水','看远景','抚摸物品','远眺 20 秒 × 3','拉伸肩颈',
    '写一行此刻的感受',
  ],
  long: [
    '听音乐','品尝小零食','散步','喝水看风景','正念呼吸','拼拼图','把玩毛绒玩具',
    '慢慢吃点水果','做舒缓瑜伽','简单拉伸','靠墙站立 1 分钟','阳台站一会儿',
    '收拾桌面','不看屏幕的散步','一杯咖啡的时间发呆',
  ],
};

window.INITIAL = INITIAL;
window.REST_SUGGESTIONS = REST_SUGGESTIONS;
INITIAL.restSuggestions = REST_SUGGESTIONS;
