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

export function formatDuration(seconds) {
  if (seconds <= 0) return '0 分钟';
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return '<1 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
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
