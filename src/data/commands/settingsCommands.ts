import { EVENT_STORE, STORE } from '../dataStore';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import { makeEvent, type Settings } from '../schema';
import {
  executeAtomicWrite,
  type ValidatedAtomicWriteTransaction,
} from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';

export type TimerSettingField = 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes';

async function currentSettings(
  transaction: ValidatedAtomicWriteTransaction,
  settingsId: string,
): Promise<Settings> {
  const settings = await transaction.get<Settings>(STORE.settings, settingsId);
  if (!settings) throw new Error('当前 Settings 不存在');
  return settings;
}

/** 修改专注 / 短休 / 长休时长（v4 §7.12 settings.timerUpdated，P2）。 */
export async function updateTimerSetting(
  input: InitializationClock & { field: TimerSettingField; value: number },
): Promise<TaskCommandResult<Settings>> {
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.settings, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'Settings',
        entityId: initialized.settings.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const settings = await currentSettings(transaction, initialized.settings.id);
      const oldValue = settings[input.field];
      if (oldValue === input.value) throw new Error('新值必须与旧值不同');
      const updated: Settings = { ...settings, [input.field]: input.value, updatedAt: input.now };
      await transaction.put(STORE.settings, updated);
      await transaction.appendEvent(
        makeEvent({
          now: input.now,
          timezone: input.timezone,
          type: 'settings.timerUpdated',
          settingsId: settings.id,
          correlationId: transaction.correlationId,
          payload: { field: input.field, oldValue, newValue: input.value },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}

/** 手动校正累计完整番茄基数（v4 §7.13 statsBaseline.updated，P2）；只改展示基数，不生成 Session。 */
export async function updateLifetimePomodoroBaseline(
  input: InitializationClock & { value: number },
): Promise<TaskCommandResult<Settings>> {
  if (!Number.isInteger(input.value) || input.value < 0) {
    throw new Error('value 必须是非负整数');
  }
  const initialized = await ensureCurrentAppDateInitialized(input);
  return executeAtomicWrite(
    {
      storeNames: [STORE.settings, EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'Settings',
        entityId: initialized.settings.id,
        operation: 'update',
      },
    },
    async (transaction) => {
      const settings = await currentSettings(transaction, initialized.settings.id);
      const oldValue = settings.lifetimePomodoroBaseline;
      if (oldValue === input.value) throw new Error('新值必须与旧值不同');
      const updated: Settings = {
        ...settings,
        lifetimePomodoroBaseline: input.value,
        updatedAt: input.now,
      };
      await transaction.put(STORE.settings, updated);
      await transaction.appendEvent(
        makeEvent({
          now: input.now,
          timezone: input.timezone,
          type: 'statsBaseline.updated',
          settingsId: settings.id,
          correlationId: transaction.correlationId,
          payload: { oldValue, newValue: input.value },
        }),
      );
      return { value: updated, correlationId: transaction.correlationId };
    },
  );
}
