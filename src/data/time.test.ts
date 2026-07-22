import { describe, expect, it } from 'vitest';
import { deriveAppDate, deriveLocalDate, getDeviceTimeZone } from './time';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

describe('time / localDate / appDate (S3, §2.5)', () => {
  it('localDate 取记录本地日历日，不取 UTC 日期', () => {
    // 北京 23:50（= 15:50Z），localDate 属当日，不取 UTC 日期
    expect(deriveLocalDate('2026-05-24T23:50:00+08:00', SH)).toBe('2026-05-24');
  });

  it('§2.5 示例：offset=240 凌晨 02:00 归前一个产品日，localDate 仍为当日', () => {
    const t = '2026-06-04T02:00:00+08:00';
    expect(deriveLocalDate(t, SH)).toBe('2026-06-04');
    expect(deriveAppDate(t, SH, 240)).toBe('2026-06-03');
  });

  it('offset=240 产品日起点(04:00)之后归当日', () => {
    expect(deriveAppDate('2026-06-04T05:00:00+08:00', SH, 240)).toBe('2026-06-04');
  });

  it('offset=0 时 appDate == localDate（多个时刻）', () => {
    for (const t of [
      '2026-06-04T00:10:00+08:00',
      '2026-06-04T23:50:00+08:00',
      '2026-01-01T02:00:00+08:00',
    ]) {
      expect(deriveAppDate(t, SH, 0)).toBe(deriveLocalDate(t, SH));
    }
  });

  it('appDate 跨月 / 跨年正确进位', () => {
    // 北京 2026-01-01 02:00，offset=240 → 2025-12-31
    expect(deriveAppDate('2026-01-01T02:00:00+08:00', SH, 240)).toBe('2025-12-31');
    // 北京 2026-03-01 01:00，offset=240 → 2026-02-28（2026 非闰年）
    expect(deriveAppDate('2026-03-01T01:00:00+08:00', SH, 240)).toBe('2026-02-28');
  });

  it('派生只依赖入参 timezone：同一 instant 不同时区得不同 localDate', () => {
    const instant = '2026-05-24T02:00:00Z'; // 上海 10:00(05-24)，纽约 22:00(05-23)
    expect(deriveLocalDate(instant, SH)).toBe('2026-05-24');
    expect(deriveLocalDate(instant, NY)).toBe('2026-05-23');
  });

  it('DST 时区抽检（America/New_York 春令时切换日仍取正确日历日）', () => {
    expect(deriveLocalDate('2026-03-08T07:30:00Z', NY)).toBe('2026-03-08');
  });

  it('getDeviceTimeZone 返回非空字符串（IANA 时区名）', () => {
    const tz = getDeviceTimeZone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });

  it('非法业务时间抛错', () => {
    expect(() => deriveLocalDate('not-a-date', SH)).toThrow();
  });

  it('拒绝无时区的 datetime string（会被运行环境隐式解释）', () => {
    expect(() => deriveLocalDate('2026-06-04T02:00:00', SH)).toThrow();
    expect(() => deriveAppDate('2026-06-04T02:00:00', SH, 0)).toThrow();
  });

  it('拒绝 date-only string', () => {
    expect(() => deriveLocalDate('2026-06-04', SH)).toThrow();
    expect(() => deriveAppDate('2026-06-04', SH, 240)).toThrow();
  });

  it('接受带 Z 或 ±HH:MM 偏移的合法字符串', () => {
    // Z=02:00 UTC → 上海 10:00；+08:00=上海 02:00；-07:00 02:00=09:00Z → 上海 17:00；均属 06-04
    expect(deriveLocalDate('2026-06-04T02:00:00Z', SH)).toBe('2026-06-04');
    expect(deriveLocalDate('2026-06-04T02:00:00+08:00', SH)).toBe('2026-06-04');
    expect(deriveLocalDate('2026-06-04T02:00:00-07:00', SH)).toBe('2026-06-04');
  });

  it('接受 Date 实例', () => {
    expect(deriveLocalDate(new Date('2026-06-04T02:00:00Z'), SH)).toBe('2026-06-04');
  });
});
