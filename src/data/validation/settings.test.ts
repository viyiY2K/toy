import { describe, expect, it } from 'vitest';
import { makeSettings, type Settings } from '../schema';
import { newId } from '../id';
import type { ValidationContext } from './context';
import { collectSettingsValidationIssues, validateSettings } from './settings';

const NOW = '2026-06-05T14:00:00+08:00';

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...makeSettings({ now: NOW }), ...overrides };
}

function context(options: {
  previous?: Settings;
  active?: Settings;
  referenced?: boolean;
} = {}): ValidationContext {
  return {
    getSettings: async (id) => (options.previous?.id === id ? options.previous : undefined),
    getActiveSettings: async () => options.active,
    isRestSuggestionReferenced: async () => options.referenced ?? false,
  };
}

async function expectCode(value: unknown, code: string, ctx = context()): Promise<void> {
  const issues = await collectSettingsValidationIssues(value, ctx);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateSettings (S6b, v4 §3.7)', () => {
  it('accepts default Settings and valid custom rest/template entries', async () => {
    const customRestId = newId();
    const customTemplateId = newId();
    const value = settings({
      restSuggestions: [
        ...makeSettings({ now: NOW }).restSuggestions,
        {
          key: `short_custom_${customRestId}`,
          label: 'look outside',
          appliesTo: ['shortBreak'],
          isBuiltIn: false,
          isEnabled: true,
          sortIndex: 16000,
          icon: null,
        },
      ],
      dailyTaskTemplates: [
        ...makeSettings({ now: NOW }).dailyTaskTemplates,
        {
          templateKey: `custom_${customTemplateId}`,
          title: 'review',
          estimatedPomodoros: 2,
          autoAddToDayPlan: false,
          sortPosition: 'last',
          sortIndex: 1000,
          isBuiltIn: false,
        },
      ],
      appDayStartOffsetMinutes: 1439,
    });
    await expect(validateSettings(value, context())).resolves.toBe(value);
  });

  it.each([
    [{ focusMinutes: 4 }, 'number.min'],
    [{ focusMinutes: 121 }, 'number.max'],
    [{ shortBreakMinutes: 0 }, 'number.min'],
    [{ longBreakMinutes: 25 }, 'settings.longBreakMinutes'],
    [{ longBreakEvery: 3 }, 'settings.longBreakEvery'],
    [{ lifetimePomodoroBaseline: -1 }, 'number.min'],
    [{ lifetimePomodoroBaseline: 1.5 }, 'number.integer'],
    [{ restSuggestionDisplayMode: 'alphabetical' }, 'settings.restSuggestionDisplayMode'],
    [{ appDayStartOffsetMinutes: 1440 }, 'number.max'],
  ] as const)('rejects invalid top-level Settings value %#', async (overrides, code) => {
    await expectCode(settings(overrides as Partial<Settings>), code);
  });

  it('enforces singleton identity for active Settings', async () => {
    const value = settings();
    await expect(validateSettings(value, context({ active: value }))).resolves.toBe(value);
    await expectCode(value, 'settings.singleton', context({ active: settings() }));
  });

  it('validates rest suggestion shape, unique keys, scopes, and custom UUID v7 format', async () => {
    const base = makeSettings({ now: NOW }).restSuggestions[0]!;
    await expectCode(settings({ restSuggestions: [base, { ...base }] }), 'settings.rest.key.duplicate');
    await expectCode(settings({ restSuggestions: [{ ...base, appliesTo: [] }] }), 'settings.rest.appliesTo.empty');
    await expectCode(
      settings({ restSuggestions: [{ ...base, appliesTo: ['longBreak'] }] }),
      'settings.rest.scope',
    );
    await expectCode(
      settings({ restSuggestions: [{ ...base, appliesTo: ['shortBreak', 'shortBreak'] }] }),
      'settings.rest.appliesTo.duplicate',
    );
    await expectCode(
      settings({
        restSuggestions: [{ ...base, key: `short_custom_${newId()}`, isBuiltIn: false, appliesTo: ['longBreak'] }],
      }),
      'settings.rest.customScope',
    );
    await expectCode(
      settings({ restSuggestions: [{ ...base, key: 'short_custom_not-v7', isBuiltIn: false }] }),
      'id.uuidV7',
    );
    await expectCode(
      settings({ restSuggestions: [{ ...base, key: `custom_${newId()}`, isBuiltIn: false }] }),
      'settings.rest.customKey',
    );
  });

  it('validates daily template shape, ranges, unique keys, and custom UUID v7 format', async () => {
    const base = makeSettings({ now: NOW }).dailyTaskTemplates[0]!;
    await expectCode(settings({ dailyTaskTemplates: [base, { ...base }] }), 'settings.template.key.duplicate');
    await expectCode(settings({ dailyTaskTemplates: [{ ...base, estimatedPomodoros: 8 }] }), 'number.max');
    await expectCode(settings({ dailyTaskTemplates: [{ ...base, sortPosition: 'middle' as never }] }), 'settings.template.sortPosition');
    await expectCode(
      settings({ dailyTaskTemplates: [{ ...base, templateKey: 'custom_not-v7', isBuiltIn: false }] }),
      'id.uuidV7',
    );
  });

  it('retains built-ins and referenced custom rest suggestions across updates', async () => {
    const previous = settings();
    const withoutBuiltInRest = { ...previous, restSuggestions: previous.restSuggestions.slice(1) };
    await expectCode(
      withoutBuiltInRest,
      'settings.rest.builtin.retained',
      context({ previous, active: previous }),
    );
    const withoutBuiltInTemplate = { ...previous, dailyTaskTemplates: [] };
    await expectCode(
      withoutBuiltInTemplate,
      'settings.template.builtin.retained',
      context({ previous, active: previous }),
    );

    const custom = {
      key: `long_custom_${newId()}`,
      label: 'custom',
      appliesTo: ['longBreak'] as ['longBreak'],
      isBuiltIn: false,
      isEnabled: true,
      sortIndex: 14000,
      icon: null,
    };
    const previousWithCustom = settings({ restSuggestions: [...previous.restSuggestions, custom] });
    const removed = { ...previousWithCustom, restSuggestions: previous.restSuggestions };
    await expectCode(
      removed,
      'settings.rest.referenced.retained',
      context({ previous: previousWithCustom, active: previousWithCustom, referenced: true }),
    );
    await expect(
      validateSettings(
        removed,
        context({ previous: previousWithCustom, active: previousWithCustom, referenced: false }),
      ),
    ).resolves.toBe(removed);
  });

  it('rejects extra nested fields', async () => {
    const base = makeSettings({ now: NOW }).restSuggestions[0]!;
    await expectCode(settings({ restSuggestions: [{ ...base, usageCount: 1 } as never] }), 'field.extra');
  });
});
