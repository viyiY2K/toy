import { deriveAppDate, type Instant, type IsoDate } from '../time';

export type StatsRangeKind = 'day' | 'week' | 'month';

export interface StatsRange {
  kind: StatsRangeKind;
  startAppDate: IsoDate;
  endAppDate: IsoDate;
}

function parseDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10) as IsoDate;
}

function addDays(value: IsoDate, days: number): IsoDate {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function makeStatsRange(kind: StatsRangeKind, anchorAppDate: IsoDate): StatsRange {
  if (kind === 'day') {
    return { kind, startAppDate: anchorAppDate, endAppDate: anchorAppDate };
  }
  const anchor = parseDate(anchorAppDate);
  if (kind === 'week') {
    const daysAfterMonday = (anchor.getUTCDay() + 6) % 7;
    const startAppDate = addDays(anchorAppDate, -daysAfterMonday);
    return { kind, startAppDate, endAppDate: addDays(startAppDate, 6) };
  }
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  return {
    kind,
    startAppDate: formatDate(new Date(Date.UTC(year, month, 1))),
    endAppDate: formatDate(new Date(Date.UTC(year, month + 1, 0))),
  };
}

export function statsRangeContains(range: StatsRange, appDate: IsoDate): boolean {
  return appDate >= range.startAppDate && appDate <= range.endAppDate;
}

export function statsRangeDates(range: StatsRange): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let current = range.startAppDate; current <= range.endAppDate; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

export function statsAppDate(
  businessTime: Instant,
  timezone: string,
  appDayStartOffsetMinutes: number,
): IsoDate {
  return deriveAppDate(businessTime, timezone, appDayStartOffsetMinutes);
}
