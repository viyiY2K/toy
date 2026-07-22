import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { BUILTIN_DAILY_TASK_TEMPLATES, BUILTIN_REST_SUGGESTIONS } from './builtins';
import { makeSettings } from './settings';

const NOW = '2026-06-05T14:37:12+08:00';

const ALL_SETTINGS_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
  'focusMinutes',
  'shortBreakMinutes',
  'longBreakMinutes',
  'longBreakEvery',
  'restSuggestions',
  'dailyTaskTemplates',
  'lifetimePomodoroBaseline',
  'restSuggestionDisplayMode',
  'appDayStartOffsetMinutes',
].sort();

describe('makeSettings (S5d, §3.7)', () => {
  it('产出含 Settings 全部字段键（含同步预留）', () => {
    const s = makeSettings({ now: NOW });
    expect(Object.keys(s).sort()).toEqual(ALL_SETTINGS_KEYS);
  });

  it('Settings 不带 timezone / localDate（§3.7 字段表无此两行）', () => {
    const s = makeSettings({ now: NOW });
    expect('timezone' in s).toBe(false);
    expect('localDate' in s).toBe(false);
  });

  it('默认值逐项对齐 v4', () => {
    const s = makeSettings({ now: NOW });
    expect(s.focusMinutes).toBe(25);
    expect(s.shortBreakMinutes).toBe(5);
    expect(s.longBreakMinutes).toBe(15);
    expect(s.longBreakEvery).toBe(4);
    expect(s.lifetimePomodoroBaseline).toBe(0);
    expect(s.restSuggestionDisplayMode).toBe('customOrder');
    expect(s.appDayStartOffsetMinutes).toBe(0);
    // 同步预留（§2.3）
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(s.deletedAt).toBeNull();
    expect(s.deviceId).toBeNull();
    expect(s.syncedAt).toBeNull();
    expect(s.createdAt).toBe(NOW);
    expect(s.updatedAt).toBe(NOW);
  });

  it('默认含两套内置种子（restSuggestions 28 / dailyTaskTemplates 1，§3.7 关键规则 2）', () => {
    const s = makeSettings({ now: NOW });
    expect(s.restSuggestions).toHaveLength(28);
    expect(s.dailyTaskTemplates).toHaveLength(1);
    expect(s.restSuggestions).toEqual(BUILTIN_REST_SUGGESTIONS);
    expect(s.dailyTaskTemplates).toEqual(BUILTIN_DAILY_TASK_TEMPLATES);
  });

  it('内置种子为深拷贝：改返回值不影响常量，也不影响下一次 makeSettings', () => {
    const s1 = makeSettings({ now: NOW });
    const firstRest = s1.restSuggestions[0]!;
    firstRest.label = 'MUTATED';
    firstRest.appliesTo.push('longBreak');
    s1.dailyTaskTemplates[0]!.title = 'MUTATED';
    // 常量不受影响
    expect(BUILTIN_REST_SUGGESTIONS[0]!.label).not.toBe('MUTATED');
    expect(BUILTIN_REST_SUGGESTIONS[0]!.appliesTo).toEqual(['shortBreak']);
    expect(BUILTIN_DAILY_TASK_TEMPLATES[0]!.title).toBe('计划准备');
    // 新实例也不受影响
    const s2 = makeSettings({ now: NOW });
    expect(s2.restSuggestions[0]!.label).not.toBe('MUTATED');
    expect(s2.dailyTaskTemplates[0]!.title).toBe('计划准备');
  });

  it('覆盖入口生效：计时参数 / baseline / 自定义 restSuggestions', () => {
    const s = makeSettings({
      now: NOW,
      focusMinutes: 50,
      longBreakMinutes: 30,
      lifetimePomodoroBaseline: 120,
      restSuggestions: [],
      dailyTaskTemplates: [],
    });
    expect(s.focusMinutes).toBe(50);
    expect(s.longBreakMinutes).toBe(30);
    expect(s.lifetimePomodoroBaseline).toBe(120);
    expect(s.restSuggestions).toEqual([]);
    expect(s.dailyTaskTemplates).toEqual([]);
  });
});
