import { describe, expect, it } from 'vitest';
import { BUILTIN_DAILY_TASK_TEMPLATES, BUILTIN_REST_SUGGESTIONS } from './builtins';

describe('BUILTIN_REST_SUGGESTIONS (S5d, §3.7 内置默认清单)', () => {
  const shortItems = BUILTIN_REST_SUGGESTIONS.filter((r) => r.appliesTo.includes('shortBreak'));
  const longItems = BUILTIN_REST_SUGGESTIONS.filter((r) => r.appliesTo.includes('longBreak'));

  it('共 28 项：短休 15 + 长休 13', () => {
    expect(BUILTIN_REST_SUGGESTIONS).toHaveLength(28);
    expect(shortItems).toHaveLength(15);
    expect(longItems).toHaveLength(13);
  });

  it('key 在数组内唯一', () => {
    const keys = BUILTIN_REST_SUGGESTIONS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('全部 isBuiltIn=true / isEnabled=true / icon=null', () => {
    for (const r of BUILTIN_REST_SUGGESTIONS) {
      expect(r.isBuiltIn).toBe(true);
      expect(r.isEnabled).toBe(true);
      expect(r.icon).toBeNull();
    }
  });

  it('每项 appliesTo 恰好单一类型；key 前缀与 appliesTo 一致（红线 20）', () => {
    for (const r of BUILTIN_REST_SUGGESTIONS) {
      expect(r.appliesTo).toHaveLength(1);
      if (r.key.startsWith('short_')) {
        expect(r.appliesTo).toEqual(['shortBreak']);
      } else if (r.key.startsWith('long_')) {
        expect(r.appliesTo).toEqual(['longBreak']);
      } else {
        throw new Error(`内置 restSuggestion key 前缀异常: ${r.key}`);
      }
    }
  });

  it('短休 sortIndex 1000→15000 步长 1000；长休 1000→13000 步长 1000（组内互不干扰）', () => {
    expect(shortItems.map((r) => r.sortIndex)).toEqual(
      Array.from({ length: 15 }, (_, i) => (i + 1) * 1000),
    );
    expect(longItems.map((r) => r.sortIndex)).toEqual(
      Array.from({ length: 13 }, (_, i) => (i + 1) * 1000),
    );
  });

  it('public 导出深冻结：数组 / 元素 / appliesTo 均不可原地修改（防外部 mutation）', () => {
    expect(Object.isFrozen(BUILTIN_REST_SUGGESTIONS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_REST_SUGGESTIONS[0])).toBe(true);
    expect(Object.isFrozen(BUILTIN_REST_SUGGESTIONS[0]!.appliesTo)).toBe(true);
  });
});

describe('BUILTIN_DAILY_TASK_TEMPLATES (S5d, §3.7)', () => {
  it('共 1 项，planningPreparation 字段逐项精确', () => {
    expect(BUILTIN_DAILY_TASK_TEMPLATES).toHaveLength(1);
    expect(BUILTIN_DAILY_TASK_TEMPLATES[0]).toEqual({
      templateKey: 'planningPreparation',
      title: '计划准备',
      estimatedPomodoros: 1,
      autoAddToDayPlan: true,
      sortPosition: 'first',
      sortIndex: 0,
      isBuiltIn: true,
    });
  });

  it('public 导出深冻结：数组 / 元素不可原地修改（防外部 mutation）', () => {
    expect(Object.isFrozen(BUILTIN_DAILY_TASK_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(BUILTIN_DAILY_TASK_TEMPLATES[0])).toBe(true);
  });
});
