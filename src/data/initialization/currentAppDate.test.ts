import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { makeDayPlan, type DayPlan, type Event, type Settings, type Task } from '../schema';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import {
  createDailyTemplateTasksForDayPlan,
  ensureCurrentAppDateInitialized,
  ensureDayPlanForAppDate,
  ensureSettingsInitialized,
} from './currentAppDate';

const TIMEZONE = 'Asia/Shanghai';
const FIRST_DAY = '2026-08-01T09:00:00+08:00';
const SAME_DAY_LATER = '2026-08-01T18:00:00+08:00';
const SECOND_DAY = '2026-08-02T09:00:00+08:00';
const THIRD_DAY = '2026-08-03T09:00:00+08:00';
const FOURTH_DAY = '2026-08-04T09:00:00+08:00';
const FIFTH_DAY = '2026-08-05T09:00:00+08:00';

function eventsWithCorrelation(events: Event[], correlationId: string): Event[] {
  return events.filter((event) => event.correlationId === correlationId);
}

describe('S11 当前 appDate 初始化闭环', () => {
  it('空库并发首启只创建一套 Settings/DayPlan/计划准备和四类同关联 Event', async () => {
    const [left, right] = await Promise.all([
      ensureCurrentAppDateInitialized({ now: FIRST_DAY, timezone: TIMEZONE }),
      ensureCurrentAppDateInitialized({ now: FIRST_DAY, timezone: TIMEZONE }),
    ]);
    const creator = left.dayPlanCreated ? left : right;
    const follower = left.dayPlanCreated ? right : left;

    expect(creator.settingsCreated).toBe(true);
    expect(creator.dayPlanCreated).toBe(true);
    expect(creator.createdTasks).toHaveLength(1);
    expect(follower.settingsCreated).toBe(false);
    expect(follower.dayPlanCreated).toBe(false);
    expect(follower.createdTasks).toHaveLength(0);

    const settings = await dataStore.getAll<Settings>(STORE.settings);
    const dayPlans = await dataStore.getAll<DayPlan>(STORE.dayPlans);
    const tasks = await dataStore.getAll<Task>(STORE.tasks);
    expect(settings).toHaveLength(1);
    expect(dayPlans.filter(({ appDate }) => appDate === '2026-08-01')).toHaveLength(1);
    expect(tasks).toHaveLength(1);

    expect(settings[0]).toMatchObject({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      appDayStartOffsetMinutes: 0,
    });
    expect(settings[0]?.restSuggestions).toHaveLength(28);
    expect(settings[0]?.dailyTaskTemplates).toHaveLength(1);

    const task = tasks[0]!;
    expect(task).toMatchObject({
      title: '计划准备',
      estimatedPomodoros: 1,
      metadata: { templateKey: 'planningPreparation', source: 'systemDailyTemplate' },
    });
    expect(task.estimateRounds).toEqual([{ index: 1, pomodoros: 1, occurredAt: FIRST_DAY }]);
    expect(dayPlans.find(({ appDate }) => appDate === '2026-08-01')?.taskIds[0]).toBe(task.id);

    const events = await dataStore.getAll<Event>(EVENT_STORE);
    expect(eventsWithCorrelation(events, creator.correlationId).map(({ type }) => type)).toEqual([
      'settings.initialized',
      'dayPlan.created',
      'task.created',
      'dayPlan.taskAdded',
    ]);
    expect(eventsWithCorrelation(events, follower.correlationId)).toHaveLength(0);
  });

  it('同一 appDate 重复进入完全只读，不更新实体也不追加 Event', async () => {
    const beforeEvents = await dataStore.getAll<Event>(EVENT_STORE);
    const beforeDayPlan = (await dataStore.getAll<DayPlan>(STORE.dayPlans)).find(
      ({ appDate }) => appDate === '2026-08-01',
    );
    const result = await ensureCurrentAppDateInitialized({
      now: SAME_DAY_LATER,
      timezone: TIMEZONE,
    });

    expect(result.settingsCreated).toBe(false);
    expect(result.dayPlanCreated).toBe(false);
    expect(result.createdTasks).toHaveLength(0);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(beforeEvents.length);
    expect(await dataStore.get<DayPlan>(STORE.dayPlans, result.dayPlan.id)).toEqual(beforeDayPlan);
  });

  it('非首个产品日复用 Settings，只创建新 DayPlan/模板 Task 和三条 Event', async () => {
    const beforeEvents = await dataStore.getAll<Event>(EVENT_STORE);
    const beforeSettings = await dataStore.getAll<Settings>(STORE.settings);
    const result = await ensureCurrentAppDateInitialized({ now: SECOND_DAY, timezone: TIMEZONE });

    expect(result.appDate).toBe('2026-08-02');
    expect(result.settingsCreated).toBe(false);
    expect(result.dayPlanCreated).toBe(true);
    expect(result.createdTasks).toHaveLength(1);
    expect(await dataStore.getAll<Settings>(STORE.settings)).toEqual(beforeSettings);
    const newEvents = eventsWithCorrelation(
      await dataStore.getAll<Event>(EVENT_STORE),
      result.correlationId,
    );
    expect((await dataStore.getAll<Event>(EVENT_STORE)).length - beforeEvents.length).toBe(3);
    expect(newEvents.map(({ type }) => type)).toEqual([
      'dayPlan.created',
      'task.created',
      'dayPlan.taskAdded',
    ]);
    expect(new Set(newEvents.map(({ correlationId }) => correlationId)).size).toBe(1);
    expect(newEvents[0]?.correlationId).toBe(result.correlationId);
  });

  it('当前 appDate 已有 DayPlan 时不补模板、不改 DayPlan、不发 Event', async () => {
    const [settings] = await dataStore.getAll<Settings>(STORE.settings);
    expect(settings).toBeDefined();
    const preexisting = makeDayPlan({
      now: THIRD_DAY,
      timezone: TIMEZONE,
      appDayStartOffsetMinutes: settings!.appDayStartOffsetMinutes,
      settingsSnapshot: {
        focusMinutes: settings!.focusMinutes,
        shortBreakMinutes: settings!.shortBreakMinutes,
        longBreakMinutes: settings!.longBreakMinutes,
        longBreakEvery: settings!.longBreakEvery,
      },
    });
    await executeAtomicWrite(
      { storeNames: [STORE.dayPlans], now: THIRD_DAY, timezone: TIMEZONE },
      (transaction) => transaction.put(STORE.dayPlans, preexisting),
    );
    const beforeEvents = await dataStore.getAll<Event>(EVENT_STORE);

    const result = await ensureCurrentAppDateInitialized({ now: THIRD_DAY, timezone: TIMEZONE });
    expect(result.dayPlanCreated).toBe(false);
    expect(result.createdTasks).toHaveLength(0);
    expect(result.dayPlan).toEqual(preexisting);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(beforeEvents.length);
  });

  it('三个事务步骤在同一事务内重入时均不重复创建或发事件', async () => {
    const result = await executeAtomicWrite(
      {
        storeNames: [STORE.settings, STORE.dayPlans, STORE.tasks, EVENT_STORE],
        now: FOURTH_DAY,
        timezone: TIMEZONE,
      },
      async (transaction) => {
        const settingsFirst = await ensureSettingsInitialized(transaction, {
          now: FOURTH_DAY,
          timezone: TIMEZONE,
        });
        const settingsSecond = await ensureSettingsInitialized(transaction, {
          now: FOURTH_DAY,
          timezone: TIMEZONE,
        });
        const dayFirst = await ensureDayPlanForAppDate(transaction, {
          now: FOURTH_DAY,
          timezone: TIMEZONE,
          appDate: '2026-08-04',
          settings: settingsFirst.settings,
        });
        const daySecond = await ensureDayPlanForAppDate(transaction, {
          now: FOURTH_DAY,
          timezone: TIMEZONE,
          appDate: '2026-08-04',
          settings: settingsFirst.settings,
        });
        const tasksFirst = await createDailyTemplateTasksForDayPlan(transaction, {
          now: FOURTH_DAY,
          timezone: TIMEZONE,
          settings: settingsFirst.settings,
          dayPlan: dayFirst.dayPlan,
        });
        const tasksSecond = await createDailyTemplateTasksForDayPlan(transaction, {
          now: FOURTH_DAY,
          timezone: TIMEZONE,
          settings: settingsFirst.settings,
          dayPlan: tasksFirst.dayPlan,
        });
        return {
          correlationId: transaction.correlationId,
          settingsFirst,
          settingsSecond,
          dayFirst,
          daySecond,
          tasksFirst,
          tasksSecond,
        };
      },
    );

    expect(result.settingsFirst.created).toBe(false);
    expect(result.settingsSecond.created).toBe(false);
    expect(result.dayFirst.created).toBe(true);
    expect(result.daySecond.created).toBe(false);
    expect(result.daySecond.dayPlan.id).toBe(result.dayFirst.dayPlan.id);
    expect(result.tasksFirst.createdTasks).toHaveLength(1);
    expect(result.tasksSecond.createdTasks).toHaveLength(0);
    expect(
      eventsWithCorrelation(await dataStore.getAll<Event>(EVENT_STORE), result.correlationId).map(
        ({ type }) => type,
      ),
    ).toEqual(['dayPlan.created', 'task.created', 'dayPlan.taskAdded']);
  });

  it('只有 tombstone 时拒绝把异常重建冒充 settings.initialized', async () => {
    const [settings] = await dataStore.getAll<Settings>(STORE.settings);
    expect(settings).toBeDefined();
    await executeAtomicWrite(
      { storeNames: [STORE.settings], now: FIFTH_DAY, timezone: TIMEZONE },
      (transaction) => transaction.softDelete(STORE.settings, settings!.id, FIFTH_DAY),
    );
    const beforeEvents = await dataStore.getAll<Event>(EVENT_STORE);

    await expect(
      ensureCurrentAppDateInitialized({ now: FIFTH_DAY, timezone: TIMEZONE }),
    ).rejects.toThrow(/不能通过首次初始化路径自动重建/);
    expect(await dataStore.getAll<Settings>(STORE.settings)).toHaveLength(0);
    expect(await dataStore.getAllIncludingDeleted<Settings>(STORE.settings)).toHaveLength(1);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(beforeEvents.length);
  });
});
