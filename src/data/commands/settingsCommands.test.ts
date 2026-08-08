import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { Event, Settings } from '../schema';
import { updateLifetimePomodoroBaseline, updateTimerSetting } from './settingsCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) =>
  `2027-02-01T09:${String(minute).padStart(2, '0')}:00+08:00`;

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

describe('Settings commands (settings page: timer + lifetime baseline)', () => {
  it('updates a timer field and appends a matching settings.timerUpdated Event', async () => {
    const result = await updateTimerSetting({
      now: at(0), timezone: TIMEZONE, field: 'focusMinutes', value: 30,
    });
    expect(result.value.focusMinutes).toBe(30);
    expect((await eventsFor(result.correlationId))).toMatchObject([
      {
        type: 'settings.timerUpdated',
        settingsId: result.value.id,
        payload: { field: 'focusMinutes', oldValue: 25, newValue: 30 },
      },
    ]);

    const longBreak = await updateTimerSetting({
      now: at(1), timezone: TIMEZONE, field: 'longBreakMinutes', value: 20,
    });
    expect(longBreak.value.longBreakMinutes).toBe(20);
    expect((await eventsFor(longBreak.correlationId))[0]).toMatchObject({
      type: 'settings.timerUpdated',
      payload: { field: 'longBreakMinutes', oldValue: 15, newValue: 20 },
    });
  });

  it('rolls back an out-of-range timer value, leaving Settings untouched', async () => {
    const before = (await dataStore.getAll<Settings>(STORE.settings))[0]!;
    await expect(updateTimerSetting({
      now: at(2), timezone: TIMEZONE, field: 'longBreakMinutes', value: 25,
    })).rejects.toThrow();
    expect(await dataStore.get<Settings>(STORE.settings, before.id)).toEqual(before);
  });

  it('rejects a no-op timer update', async () => {
    const before = (await dataStore.getAll<Settings>(STORE.settings))[0]!;
    await expect(updateTimerSetting({
      now: at(3), timezone: TIMEZONE, field: 'focusMinutes', value: before.focusMinutes,
    })).rejects.toThrow(/必须与旧值不同/);
  });

  it('updates lifetimePomodoroBaseline and appends a statsBaseline.updated Event', async () => {
    const result = await updateLifetimePomodoroBaseline({ now: at(4), timezone: TIMEZONE, value: 300 });
    expect(result.value.lifetimePomodoroBaseline).toBe(300);
    expect((await eventsFor(result.correlationId))).toMatchObject([
      {
        type: 'statsBaseline.updated',
        settingsId: result.value.id,
        payload: { oldValue: 0, newValue: 300 },
      },
    ]);

    const corrected = await updateLifetimePomodoroBaseline({ now: at(5), timezone: TIMEZONE, value: 280 });
    expect(corrected.value.lifetimePomodoroBaseline).toBe(280);
  });

  it('rejects a negative, non-integer, or no-op lifetimePomodoroBaseline value', async () => {
    const before = (await dataStore.getAll<Settings>(STORE.settings))[0]!;
    await expect(updateLifetimePomodoroBaseline({
      now: at(6), timezone: TIMEZONE, value: -1,
    })).rejects.toThrow(/非负整数/);
    await expect(updateLifetimePomodoroBaseline({
      now: at(7), timezone: TIMEZONE, value: 1.5,
    })).rejects.toThrow(/非负整数/);
    await expect(updateLifetimePomodoroBaseline({
      now: at(8), timezone: TIMEZONE, value: before.lifetimePomodoroBaseline,
    })).rejects.toThrow(/必须与旧值不同/);
  });
});
