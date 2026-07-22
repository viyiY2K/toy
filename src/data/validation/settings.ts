import type { Settings } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  requireRecord,
  validateExactKeys,
  validateInteger,
  validateSyncableBase,
  validateUuidV7,
  type ValidationIssue,
} from './primitives';

const SETTINGS_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'focusMinutes',
  'shortBreakMinutes',
  'longBreakMinutes',
  'longBreakEvery',
  'restSuggestions',
  'dailyTaskTemplates',
  'lifetimePomodoroBaseline',
  'restSuggestionDisplayMode',
  'appDayStartOffsetMinutes',
] as const;

function validateRestSuggestions(value: unknown, collector: ValidationCollector): void {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'restSuggestions', '必须为数组');
    return;
  }
  const keys = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `restSuggestions[${index}]`;
    const item = requireRecord(candidate, path, collector);
    if (!item) return;
    validateExactKeys(item, ['key', 'label', 'appliesTo', 'isBuiltIn', 'isEnabled', 'sortIndex', 'icon'], path, collector);
    const keyIsString = typeof item.key === 'string' && item.key.length > 0;
    collector.check(keyIsString, 'settings.rest.key', `${path}.key`, '必须为非空字符串');
    if (keyIsString) {
      collector.check(!keys.has(item.key as string), 'settings.rest.key.duplicate', `${path}.key`, 'key 不得重复');
      keys.add(item.key as string);
      const prefixScope = (item.key as string).startsWith('short_')
        ? 'shortBreak'
        : (item.key as string).startsWith('long_')
          ? 'longBreak'
          : undefined;
      collector.check(prefixScope !== undefined, 'settings.rest.keyPrefix', `${path}.key`, 'key 必须以 short_ 或 long_ 开头');
      if (prefixScope && Array.isArray(item.appliesTo)) {
        collector.check(
          item.appliesTo.length === 1 && item.appliesTo[0] === prefixScope,
          'settings.rest.scope',
          `${path}.appliesTo`,
          'key 前缀必须与唯一 appliesTo 一致',
        );
      }
    }
    collector.check(typeof item.label === 'string' && item.label.trim().length > 0, 'settings.rest.label', `${path}.label`, '必须为非空字符串');
    if (!Array.isArray(item.appliesTo)) {
      collector.add('type.array', `${path}.appliesTo`, '必须为数组');
    } else {
      collector.check(item.appliesTo.length > 0, 'settings.rest.appliesTo.empty', `${path}.appliesTo`, '不得为空');
      collector.check(
        item.appliesTo.every((scope) => scope === 'shortBreak' || scope === 'longBreak'),
        'settings.rest.appliesTo.value',
        `${path}.appliesTo`,
        '仅允许 shortBreak/longBreak',
      );
      collector.check(
        new Set(item.appliesTo).size === item.appliesTo.length,
        'settings.rest.appliesTo.duplicate',
        `${path}.appliesTo`,
        'appliesTo 不得重复',
      );
    }
    collector.check(typeof item.isBuiltIn === 'boolean', 'type.boolean', `${path}.isBuiltIn`, '必须为 boolean');
    collector.check(typeof item.isEnabled === 'boolean', 'type.boolean', `${path}.isEnabled`, '必须为 boolean');
    validateInteger(item.sortIndex, `${path}.sortIndex`, collector, 0);
    collector.check(item.icon === null || typeof item.icon === 'string', 'type.stringOrNull', `${path}.icon`, '必须为 string 或 null');

    if (item.isBuiltIn === false && typeof item.key === 'string') {
      const shortPrefix = 'short_custom_';
      const longPrefix = 'long_custom_';
      const scope = item.key.startsWith(shortPrefix)
        ? 'shortBreak'
        : item.key.startsWith(longPrefix)
          ? 'longBreak'
          : undefined;
      collector.check(scope !== undefined, 'settings.rest.customKey', `${path}.key`, '自定义 key 必须使用 short_custom_/long_custom_ + UUID v7');
      if (scope && Array.isArray(item.appliesTo)) {
        collector.check(
          item.appliesTo.length === 1 && item.appliesTo[0] === scope,
          'settings.rest.customScope',
          `${path}.appliesTo`,
          '自定义 key 前缀必须与唯一 appliesTo 一致',
        );
        validateUuidV7(
          item.key.slice(scope === 'shortBreak' ? shortPrefix.length : longPrefix.length),
          `${path}.key`,
          collector,
        );
      }
    }
  });
}

function validateDailyTaskTemplates(value: unknown, collector: ValidationCollector): void {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'dailyTaskTemplates', '必须为数组');
    return;
  }
  const keys = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `dailyTaskTemplates[${index}]`;
    const item = requireRecord(candidate, path, collector);
    if (!item) return;
    validateExactKeys(
      item,
      ['templateKey', 'title', 'estimatedPomodoros', 'autoAddToDayPlan', 'sortPosition', 'sortIndex', 'isBuiltIn'],
      path,
      collector,
    );
    const keyIsString = typeof item.templateKey === 'string' && item.templateKey.length > 0;
    collector.check(keyIsString, 'settings.template.key', `${path}.templateKey`, '必须为非空字符串');
    if (keyIsString) {
      collector.check(!keys.has(item.templateKey as string), 'settings.template.key.duplicate', `${path}.templateKey`, 'templateKey 不得重复');
      keys.add(item.templateKey as string);
    }
    collector.check(typeof item.title === 'string' && item.title.trim().length > 0, 'settings.template.title', `${path}.title`, '必须为非空字符串');
    validateInteger(item.estimatedPomodoros, `${path}.estimatedPomodoros`, collector, 1, 7);
    collector.check(typeof item.autoAddToDayPlan === 'boolean', 'type.boolean', `${path}.autoAddToDayPlan`, '必须为 boolean');
    collector.check(item.sortPosition === 'first' || item.sortPosition === 'last', 'settings.template.sortPosition', `${path}.sortPosition`, '仅允许 first/last');
    validateInteger(item.sortIndex, `${path}.sortIndex`, collector, 0);
    collector.check(typeof item.isBuiltIn === 'boolean', 'type.boolean', `${path}.isBuiltIn`, '必须为 boolean');
    if (item.isBuiltIn === false && typeof item.templateKey === 'string') {
      collector.check(item.templateKey.startsWith('custom_'), 'settings.template.customKey', `${path}.templateKey`, '自定义模板必须为 custom_ + UUID v7');
      if (item.templateKey.startsWith('custom_')) {
        validateUuidV7(item.templateKey.slice('custom_'.length), `${path}.templateKey`, collector);
      }
    }
  });
}

async function validatePreviousSettings(
  settings: Record<string, unknown>,
  previous: Settings,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  if (!Array.isArray(settings.restSuggestions) || !Array.isArray(settings.dailyTaskTemplates)) return;
  const nextRest = new Map(
    settings.restSuggestions
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => [item.key, item]),
  );
  for (const item of previous.restSuggestions) {
    const next = nextRest.get(item.key);
    if (item.isBuiltIn) {
      collector.check(next?.isBuiltIn === true, 'settings.rest.builtin.retained', 'restSuggestions', `内置休息项 ${item.key} 不得删除或改 key`);
    } else if (!next) {
      if (context?.isRestSuggestionReferenced) {
        collector.check(
          !(await context.isRestSuggestionReferenced(item.key)),
          'settings.rest.referenced.retained',
          'restSuggestions',
          `已被 Session 引用的休息项 ${item.key} 不得删除`,
        );
      } else {
        collector.add('validation.context.required', 'restSuggestions', '删除自定义休息项前必须查询历史 Session 引用');
      }
    }
  }
  const nextTemplates = new Map(
    settings.dailyTaskTemplates
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => [item.templateKey, item]),
  );
  for (const template of previous.dailyTaskTemplates) {
    if (template.isBuiltIn) {
      collector.check(
        nextTemplates.get(template.templateKey)?.isBuiltIn === true,
        'settings.template.builtin.retained',
        'dailyTaskTemplates',
        `内置模板 ${template.templateKey} 不得删除或改 key`,
      );
    }
  }
}

export async function collectSettingsValidationIssues(
  value: unknown,
  context?: ValidationContext,
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const settings = requireRecord(value, 'Settings', collector);
  if (!settings) return collector.issues;
  validateExactKeys(settings, SETTINGS_KEYS, 'Settings', collector);
  validateSyncableBase(settings, collector);
  validateInteger(settings.focusMinutes, 'focusMinutes', collector, 5, 120);
  validateInteger(settings.shortBreakMinutes, 'shortBreakMinutes', collector, 1, 30);
  collector.check(settings.longBreakMinutes === 15 || settings.longBreakMinutes === 20 || settings.longBreakMinutes === 30, 'settings.longBreakMinutes', 'longBreakMinutes', '只允许 15/20/30');
  collector.check(settings.longBreakEvery === 4, 'settings.longBreakEvery', 'longBreakEvery', 'Phase 1–4 普通写入必须为 4');
  validateRestSuggestions(settings.restSuggestions, collector);
  validateDailyTaskTemplates(settings.dailyTaskTemplates, collector);
  validateInteger(settings.lifetimePomodoroBaseline, 'lifetimePomodoroBaseline', collector, 0);
  collector.check(settings.restSuggestionDisplayMode === 'customOrder' || settings.restSuggestionDisplayMode === 'usageFrequency', 'settings.restSuggestionDisplayMode', 'restSuggestionDisplayMode', '非法展示排序模式');
  validateInteger(settings.appDayStartOffsetMinutes, 'appDayStartOffsetMinutes', collector, 0, 1439);

  if (typeof settings.id === 'string') {
    let previous: Settings | undefined;
    if (context?.getSettings) {
      previous = await context.getSettings(settings.id);
      if (previous) await validatePreviousSettings(settings, previous, context, collector);
    } else {
      collector.add('validation.context.required', 'Settings.id', '校验 Settings 更新需要事务查询上下文');
    }
    if (settings.deletedAt === null) {
      if (context?.getActiveSettings) {
        const active = await context.getActiveSettings();
        collector.check(active === undefined || active.id === settings.id, 'settings.singleton', 'Settings.id', '最多一条有效 Settings');
      } else {
        collector.add('validation.context.required', 'Settings.id', '校验 Settings 单例需要事务查询上下文');
      }
    }
  }
  return collector.issues;
}

export async function validateSettings(value: unknown, context?: ValidationContext): Promise<Settings> {
  const issues = await collectSettingsValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('Settings', issues);
  return value as Settings;
}
