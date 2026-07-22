import { describe, expect, it } from 'vitest';
import { makeStatsRange, statsAppDate, statsRangeDates } from './dateRange';

describe('Phase 3 S3a stats date ranges', () => {
  it('builds day, Monday-first week, and calendar-month ranges', () => {
    expect(makeStatsRange('day', '2026-06-03')).toEqual({
      kind: 'day', startAppDate: '2026-06-03', endAppDate: '2026-06-03',
    });
    expect(makeStatsRange('week', '2026-06-03')).toEqual({
      kind: 'week', startAppDate: '2026-06-01', endAppDate: '2026-06-07',
    });
    expect(makeStatsRange('month', '2026-02-18')).toEqual({
      kind: 'month', startAppDate: '2026-02-01', endAppDate: '2026-02-28',
    });
    expect(statsRangeDates(makeStatsRange('week', '2026-06-03'))).toHaveLength(7);
    expect(statsRangeDates(makeStatsRange('month', '2026-02-18'))).toHaveLength(28);
  });

  it('derives appDate from business time, record timezone, and offset instead of localDate', () => {
    expect(statsAppDate('2026-06-01T02:30:00+08:00', 'Asia/Shanghai', 240)).toBe('2026-05-31');
    expect(statsAppDate('2026-06-01T05:00:00+08:00', 'Asia/Shanghai', 240)).toBe('2026-06-01');
  });
});
