import { describe, expect, it } from 'vitest';
import {
  chartPoints,
  energyTrendPresentation,
  formatDuration,
  formatRatio,
  formatStatsRange,
  shiftStatsAnchor,
  statsHasRangeActivity,
} from './statsViewModel';

describe('S4 stats view model', () => {
  it('moves day, week and clamped calendar-month anchors without using local time', () => {
    expect(shiftStatsAnchor('2026-07-21', 'day', -1)).toBe('2026-07-20');
    expect(shiftStatsAnchor('2026-07-21', 'week', 1)).toBe('2026-07-28');
    expect(shiftStatsAnchor('2026-03-31', 'month', -1)).toBe('2026-02-28');
    expect(shiftStatsAnchor('2024-01-31', 'month', 1)).toBe('2024-02-29');
  });

  it('formats appDate ranges, durations and nullable ratios explicitly', () => {
    expect(formatStatsRange({
      kind: 'day',
      startAppDate: '2026-07-21',
      endAppDate: '2026-07-21',
    })).toBe('2026.07.21');
    expect(formatStatsRange({
      kind: 'week',
      startAppDate: '2026-07-20',
      endAppDate: '2026-07-26',
    })).toBe('7.20 - 7.26');
    expect(formatStatsRange({
      kind: 'month',
      startAppDate: '2026-07-01',
      endAppDate: '2026-07-31',
    })).toBe('2026.07');
    expect(formatDuration(0)).toBe('0 分钟');
    expect(formatDuration(59)).toBe('<1 分钟');
    expect(formatDuration(5_400)).toBe('1 小时 30 分钟');
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(0.625)).toBe('63%');
  });

  it('creates gap-preserving SVG points and an honest empty-range signal', () => {
    expect(chartPoints([null, 5, 10], 100, 40)).toEqual([
      null,
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ]);
    expect(chartPoints([4], 100, 40)).toEqual([{ x: 50, y: 20 }]);
    expect(chartPoints([null, null], 100, 40)).toEqual([null, null]);

    const empty = {
      focusSeconds: 0,
      restSeconds: 0,
      completionCount: 0,
      interruptCount: 0,
      energyCount: 0,
    };
    expect(statsHasRangeActivity(empty)).toBe(false);
    expect(statsHasRangeActivity({
      ...empty,
      completionCount: 1,
    })).toBe(true);
  });

  it('keeps every day EnergyRecord in occurredAt order and uses daily averages for longer ranges', () => {
    const timeline = Array.from({ length: 7 }, (_, index) => ({
      energyRecordId: `energy-${index}`,
      occurredAt: `2026-07-21T0${6 - index}:00:00.000Z`,
      localTime: `0${6 - index}:00`,
      energyLevel: 7 - index,
      source: 'onReturn',
    }));
    const dailyTrend = [
      { appDate: '2026-07-20', averageEnergy: null, sampleCount: 0 },
      { appDate: '2026-07-21', averageEnergy: 6.5, sampleCount: 7 },
    ];

    const day = energyTrendPresentation('day', { timeline, dailyTrend });
    expect(day.values).toHaveLength(7);
    expect(day.labels).toEqual(['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00']);
    expect(day.rows.map(({ key }) => key)).toEqual([
      'energy-6', 'energy-5', 'energy-4', 'energy-3', 'energy-2', 'energy-1', 'energy-0',
    ]);

    expect(energyTrendPresentation('week', { timeline, dailyTrend })).toEqual({
      values: [null, 6.5],
      labels: ['07-20', '07-21'],
      rows: [{ key: '2026-07-21', label: '07-21', value: 6.5, detail: '7 条' }],
    });
  });
});
