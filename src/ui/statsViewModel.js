function parseAppDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toAppDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = parseAppDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toAppDate(date);
}

export function shiftStatsAnchor(anchorAppDate, kind, direction) {
  if (kind === 'day') return addDays(anchorAppDate, direction);
  if (kind === 'week') return addDays(anchorAppDate, direction * 7);

  const anchor = parseAppDate(anchorAppDate);
  const day = anchor.getUTCDate();
  const target = new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth() + direction,
    1,
  ));
  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toAppDate(target);
}

function dateParts(value) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function dotDate({ year, month, day }) {
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

function dotMonth({ year, month }) {
  return `${year}.${String(month).padStart(2, '0')}`;
}

export function formatStatsRange(range) {
  const start = dateParts(range.startAppDate);
  const end = dateParts(range.endAppDate);
  if (range.kind === 'day') return dotDate(start);
  if (range.kind === 'month') return dotMonth(start);
  return `${start.month}.${String(start.day).padStart(2, '0')} - ${end.month}.${String(end.day).padStart(2, '0')}`;
}

// 时长拆成「数字 + 单位」两段，让 UI 能把单位排成小号灰字。
// formatDuration 仍返回同样的纯文本，供 title / 明细行等纯字符串场景使用。
export function durationParts(seconds) {
  if (seconds <= 0) return [{ value: '0', unit: '分钟' }];
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return [{ value: '<1', unit: '分钟' }];
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return [{ value: String(minutes), unit: '分钟' }];
  if (rest === 0) return [{ value: String(hours), unit: '小时' }];
  return [{ value: String(hours), unit: '小时' }, { value: String(rest), unit: '分钟' }];
}

export function formatDuration(seconds) {
  return durationParts(seconds).map(({ value, unit }) => `${value} ${unit}`).join(' ');
}

export function formatRatio(value) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function formatDecimal(value, digits = 1) {
  return value === null ? '—' : value.toFixed(digits).replace(/\.0$/, '');
}

export function chartPoints(values, width, height) {
  const finite = values.filter((value) => value !== null);
  if (finite.length === 0) return values.map(() => null);
  const maximum = Math.max(...finite);
  const minimum = Math.min(...finite);
  const spread = maximum - minimum;
  return values.map((value, index) => {
    if (value === null) return null;
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = spread === 0 ? height / 2 : height - ((value - minimum) / spread) * height;
    return { x, y };
  });
}

export function energyTrendPresentation(kind, energy) {
  if (kind === 'day') {
    const rows = [...energy.timeline]
      .sort((left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
        || left.energyRecordId.localeCompare(right.energyRecordId))
      .map((record) => ({
        key: record.energyRecordId,
        label: record.localTime,
        value: record.energyLevel,
        detail: record.source,
      }));
    return {
      values: rows.map(({ value }) => value),
      labels: rows.map(({ label }) => label),
      rows,
    };
  }
  const rows = energy.dailyTrend
    .filter(({ averageEnergy }) => averageEnergy !== null)
    .map((day) => ({
      key: day.appDate,
      label: day.appDate.slice(5),
      value: day.averageEnergy,
      detail: `${day.sampleCount} 条`,
    }));
  return {
    values: energy.dailyTrend.map(({ averageEnergy }) => averageEnergy),
    labels: energy.dailyTrend.map(({ appDate }) => appDate.slice(5)),
    rows,
  };
}

const TIMER_FIELD_LABELS = {
  focusMinutes: '专注时长',
  shortBreakMinutes: '短休时长',
  longBreakMinutes: '长休时长',
};

// 番茄大小（专注/休息时长）变过之后，「个数」就不再是跨前后可比的固定单位——
// 有效番茄数 / 完整循环数只看流程是否走完，不看时长，这是数据层的既定口径（不在这里重算）。
// 这里只负责把「统计范围内发生过几次计时参数变更」翻成人话，提醒用户别拿个数直接比强度。
export function timerSettingChangeNotice(kind, timerSettingChanges) {
  if (!timerSettingChanges || timerSettingChanges.length === 0) return null;
  const lines = timerSettingChanges.map((change) => {
    const label = TIMER_FIELD_LABELS[change.field] ?? change.field;
    const prefix = kind === 'day' ? '' : `${change.appDate.slice(5)} `;
    return `${prefix}${label} ${change.oldValue} → ${change.newValue} 分钟`;
  });
  const caveat = kind === 'day'
    ? '如果「有效番茄」个数比预算少，可能是因为番茄变大了，不代表这段时间没在专注。'
    : `${kind === 'week' ? '本周' : '本月'}内番茄大小不完全一样，用"个数"直接比较前后专注量时要注意这一点。`;
  return { lines, caveat };
}

export function statsHasRangeActivity({
  focusSeconds,
  restSeconds,
  completionCount,
  interruptCount,
  energyCount,
}) {
  return focusSeconds > 0
    || restSeconds > 0
    || completionCount > 0
    || interruptCount > 0
    || energyCount > 0;
}
