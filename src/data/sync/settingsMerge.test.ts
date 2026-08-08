import { describe, expect, it } from 'vitest';
import { makeSettings, type Settings } from '../schema';
import { mergeSettings, settingsContentEquals } from './settingsMerge';

const NOW = '2026-10-01T09:00:00+08:00';
const LATER = '2026-10-01T10:00:00+08:00';

function settingsAt(now: string, overrides: Partial<Settings> = {}): Settings {
  return { ...makeSettings({ now }), ...overrides };
}

describe('mergeSettings (S6)', () => {
  it('内容完全一致时，合并结果与本地相同，也没有 baseline 冲突', () => {
    const local = settingsAt(NOW);
    const remote = settingsAt(NOW);
    const { merged, baselineConflict } = mergeSettings(local, remote);
    expect(baselineConflict).toBeNull();
    expect(settingsContentEquals(merged, local)).toBe(true);
  });

  it('远端 updatedAt 更新时，非 baseline 字段整体取远端', () => {
    const local = settingsAt(NOW, { focusMinutes: 25, updatedAt: NOW });
    const remote = settingsAt(NOW, { focusMinutes: 50, updatedAt: LATER });
    const { merged } = mergeSettings(local, remote);
    expect(merged.focusMinutes).toBe(50);
  });

  it('本地 updatedAt 更新时，非 baseline 字段整体保留本地', () => {
    const local = settingsAt(NOW, { focusMinutes: 25, updatedAt: LATER });
    const remote = settingsAt(NOW, { focusMinutes: 50, updatedAt: NOW });
    const { merged } = mergeSettings(local, remote);
    expect(merged.focusMinutes).toBe(25);
  });

  it('合并结果恒定延续本地 id/createdAt，不吸收远端身份', () => {
    const local = settingsAt(NOW, { id: '018f5e2a-0000-7000-8000-0000000000a1', createdAt: NOW, updatedAt: NOW });
    const remote = settingsAt(NOW, {
      id: '018f5e2a-0000-7000-8000-0000000000b2', createdAt: LATER, updatedAt: LATER, focusMinutes: 50,
    });
    const { merged } = mergeSettings(local, remote);
    expect(merged.id).toBe(local.id);
    expect(merged.createdAt).toBe(local.createdAt);
    expect(merged.focusMinutes).toBe(50); // 内容仍然按 updatedAt 取较新一份
  });

  it('lifetimePomodoroBaseline 不同：检测为冲突，合并结果暂缓保留本地值', () => {
    const local = settingsAt(NOW, { lifetimePomodoroBaseline: 10, updatedAt: NOW });
    const remote = settingsAt(NOW, { lifetimePomodoroBaseline: 25, updatedAt: LATER });
    const { merged, baselineConflict } = mergeSettings(local, remote);
    expect(baselineConflict).toEqual({ local: 10, remote: 25 });
    expect(merged.lifetimePomodoroBaseline).toBe(10);
  });

  it('lifetimePomodoroBaseline 相同：不算冲突', () => {
    const local = settingsAt(NOW, { lifetimePomodoroBaseline: 10 });
    const remote = settingsAt(NOW, { lifetimePomodoroBaseline: 10, updatedAt: LATER });
    const { baselineConflict } = mergeSettings(local, remote);
    expect(baselineConflict).toBeNull();
  });
});

describe('settingsContentEquals (S6)', () => {
  it('忽略同步簿记字段（id/createdAt/updatedAt/deviceId/syncedAt），只比较业务字段', () => {
    const a = settingsAt(NOW, { id: 'a-id', deviceId: null, syncedAt: null });
    const b = settingsAt(LATER, { id: 'b-id', deviceId: '018f5e2a-0000-7000-8000-0000000000cc', syncedAt: LATER });
    expect(settingsContentEquals(a, b)).toBe(true);
  });

  it('业务字段（如 focusMinutes）不同时判定不相等', () => {
    const a = settingsAt(NOW, { focusMinutes: 25 });
    const b = settingsAt(NOW, { focusMinutes: 30 });
    expect(settingsContentEquals(a, b)).toBe(false);
  });

  it('restSuggestions 数组内容不同时判定不相等', () => {
    const a = settingsAt(NOW);
    const b = settingsAt(NOW, {
      restSuggestions: a.restSuggestions.map((item, index) =>
        index === 0 ? { ...item, isEnabled: !item.isEnabled } : item,
      ),
    });
    expect(settingsContentEquals(a, b)).toBe(false);
  });
});
