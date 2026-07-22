import { EVENT_STORE, STORE } from '../dataStore';
import {
  makeDayPlan,
  makeEvent,
  makeSettings,
  makeTask,
  type DailyTaskTemplate,
  type DayPlan,
  type Event,
  type IsoDateTime,
  type Settings,
  type Task,
} from '../schema';
import { deriveAppDate, type IsoDate } from '../time';
import {
  executeAtomicWrite,
  type ValidatedAtomicWriteTransaction,
} from '../writes/executeAtomicWrite';

export interface InitializationClock {
  now: IsoDateTime;
  timezone: string;
}

export interface EnsureSettingsResult {
  settings: Settings;
  created: boolean;
}

export interface EnsureDayPlanResult {
  dayPlan: DayPlan;
  created: boolean;
}

export interface DailyTemplateTasksResult {
  dayPlan: DayPlan;
  createdTasks: Task[];
}

export interface CurrentAppDateInitializationResult {
  appDate: IsoDate;
  settings: Settings;
  dayPlan: DayPlan;
  createdTasks: Task[];
  settingsCreated: boolean;
  dayPlanCreated: boolean;
  correlationId: string;
}

/** S11 事务步骤 1：只在不存在有效 Settings 时创建默认单例并写初始化 Event。 */
export async function ensureSettingsInitialized(
  transaction: ValidatedAtomicWriteTransaction,
  clock: InitializationClock,
): Promise<EnsureSettingsResult> {
  const existing = (await transaction.getAll<Settings>(STORE.settings))[0];
  if (existing) return { settings: existing, created: false };
  const historical = await transaction.getAllIncludingDeleted<Settings>(STORE.settings);
  if (historical.length > 0) {
    // v4/plan 明确：异常重建不冒充首次初始化；Phase 1 也不实现自动修复。
    throw new Error('存在 Settings tombstone，不能通过首次初始化路径自动重建');
  }

  const settings = makeSettings({ now: clock.now });
  await transaction.put(STORE.settings, settings);
  await transaction.appendEvent(
    makeEvent({
      now: clock.now,
      timezone: clock.timezone,
      type: 'settings.initialized',
      settingsId: settings.id,
      correlationId: transaction.correlationId,
      payload: {
        focusMinutes: settings.focusMinutes,
        shortBreakMinutes: settings.shortBreakMinutes,
        longBreakMinutes: settings.longBreakMinutes,
        longBreakEvery: settings.longBreakEvery,
        restSuggestionsCount: settings.restSuggestions.length,
        dailyTaskTemplatesCount: settings.dailyTaskTemplates.length,
      },
    }),
  );
  return { settings, created: true };
}

/** S11 事务步骤 2：按 appDate 查找或创建 DayPlan；Settings 快照只在创建时固化。 */
export async function ensureDayPlanForAppDate(
  transaction: ValidatedAtomicWriteTransaction,
  input: InitializationClock & { appDate: IsoDate; settings: Settings },
): Promise<EnsureDayPlanResult> {
  const existing = (await transaction.getAll<DayPlan>(STORE.dayPlans)).find(
    (dayPlan) => dayPlan.appDate === input.appDate,
  );
  if (existing) return { dayPlan: existing, created: false };

  const dayPlan = makeDayPlan({
    now: input.now,
    timezone: input.timezone,
    appDayStartOffsetMinutes: input.settings.appDayStartOffsetMinutes,
    settingsSnapshot: {
      focusMinutes: input.settings.focusMinutes,
      shortBreakMinutes: input.settings.shortBreakMinutes,
      longBreakMinutes: input.settings.longBreakMinutes,
      longBreakEvery: input.settings.longBreakEvery,
    },
  });
  if (dayPlan.appDate !== input.appDate) {
    throw new Error('ensureDayPlanForAppDate 的 appDate 必须由当前 Settings 与时钟派生');
  }
  await transaction.put(STORE.dayPlans, dayPlan);
  await transaction.appendEvent(
    makeEvent({
      now: input.now,
      timezone: input.timezone,
      type: 'dayPlan.created',
      dayPlanId: dayPlan.id,
      correlationId: transaction.correlationId,
      payload: {
        appDate: dayPlan.appDate,
        localDate: dayPlan.localDate,
        budgetMode: dayPlan.budgetMode,
      },
    }),
  );
  return { dayPlan, created: true };
}

function templateOrder(left: DailyTaskTemplate, right: DailyTaskTemplate): number {
  return left.sortIndex - right.sortIndex || left.templateKey.localeCompare(right.templateKey);
}

async function alreadyGeneratedTemplateKeys(
  transaction: ValidatedAtomicWriteTransaction,
  dayPlan: DayPlan,
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const taskId of dayPlan.taskIds) {
    const task = await transaction.getIncludingDeleted<Task>(STORE.tasks, taskId);
    if (task?.metadata.templateKey) keys.add(task.metadata.templateKey);
  }

  // 即使用户已从今日移除模板任务，也不得在同一天重新生成；Event 是持久幂等凭据。
  const creationEvents = (await transaction.getAll<Event<'task.created'>>(EVENT_STORE)).filter(
    (event) =>
      event.type === 'task.created' &&
      event.dayPlanId === dayPlan.id &&
      event.payload.source === 'systemDailyTemplate' &&
      event.taskId !== null,
  );
  for (const event of creationEvents) {
    const task = await transaction.getIncludingDeleted<Task>(STORE.tasks, event.taskId!);
    if (task?.metadata.templateKey) keys.add(task.metadata.templateKey);
  }
  return keys;
}

/**
 * S11 事务步骤 3：为刚创建的 DayPlan 生成 autoAdd 模板 Task。
 * 该步骤自身也可重入；同一 DayPlan 已经有创建 Event 的模板不会再次生成。
 */
export async function createDailyTemplateTasksForDayPlan(
  transaction: ValidatedAtomicWriteTransaction,
  input: InitializationClock & { settings: Settings; dayPlan: DayPlan },
): Promise<DailyTemplateTasksResult> {
  const generatedKeys = await alreadyGeneratedTemplateKeys(transaction, input.dayPlan);
  const templates = input.settings.dailyTaskTemplates
    .filter((template) => template.autoAddToDayPlan && !generatedKeys.has(template.templateKey))
    .sort(templateOrder);
  if (templates.length === 0) return { dayPlan: input.dayPlan, createdTasks: [] };

  const generated = templates.map((template) => ({
    template,
    task: makeTask({
      now: input.now,
      title: template.title,
      estimatedPomodoros: template.estimatedPomodoros,
      metadata: {
        templateKey: template.templateKey,
        source: 'systemDailyTemplate',
      },
    }),
  }));
  const first = generated.filter(({ template }) => template.sortPosition === 'first');
  const last = generated.filter(({ template }) => template.sortPosition === 'last');
  const taskIds = [
    ...first.map(({ task }) => task.id),
    ...input.dayPlan.taskIds,
    ...last.map(({ task }) => task.id),
  ];
  const dayPlan: DayPlan = { ...input.dayPlan, taskIds, updatedAt: input.now };

  for (const { task } of generated) await transaction.put(STORE.tasks, task);
  await transaction.put(STORE.dayPlans, dayPlan);

  for (const { task } of generated) {
    const addedAtIndex = taskIds.indexOf(task.id);
    await transaction.appendEvent(
      makeEvent({
        now: input.now,
        timezone: input.timezone,
        type: 'task.created',
        taskId: task.id,
        dayPlanId: dayPlan.id,
        correlationId: transaction.correlationId,
        payload: {
          title: task.title,
          parentId: task.parentId,
          estimatedPomodoros: task.estimatedPomodoros,
          source: 'systemDailyTemplate',
        },
      }),
    );
    await transaction.appendEvent(
      makeEvent({
        now: input.now,
        timezone: input.timezone,
        type: 'dayPlan.taskAdded',
        taskId: task.id,
        dayPlanId: dayPlan.id,
        correlationId: transaction.correlationId,
        payload: { addedAtIndex, source: 'systemDailyTemplate' },
      }),
    );
  }
  return { dayPlan, createdTasks: generated.map(({ task }) => task) };
}

/** 首次进入/首次读取当前产品日的单一组合入口；四类初始化 Event 共用一个事务/correlationId。 */
export async function ensureCurrentAppDateInitialized(
  clock: InitializationClock,
): Promise<CurrentAppDateInitializationResult> {
  return executeAtomicWrite(
    {
      storeNames: [STORE.settings, STORE.dayPlans, STORE.tasks, EVENT_STORE],
      now: clock.now,
      timezone: clock.timezone,
      diagnosticContext: { entityType: 'AtomicWrite' },
    },
    async (transaction) => {
      const settingsResult = await ensureSettingsInitialized(transaction, clock);
      const appDate = deriveAppDate(
        clock.now,
        clock.timezone,
        settingsResult.settings.appDayStartOffsetMinutes,
      );
      const dayPlanResult = await ensureDayPlanForAppDate(transaction, {
        ...clock,
        appDate,
        settings: settingsResult.settings,
      });
      const templateResult = dayPlanResult.created
        ? await createDailyTemplateTasksForDayPlan(transaction, {
            ...clock,
            settings: settingsResult.settings,
            dayPlan: dayPlanResult.dayPlan,
          })
        : { dayPlan: dayPlanResult.dayPlan, createdTasks: [] };
      return {
        appDate,
        settings: settingsResult.settings,
        dayPlan: templateResult.dayPlan,
        createdTasks: templateResult.createdTasks,
        settingsCreated: settingsResult.created,
        dayPlanCreated: dayPlanResult.created,
        correlationId: transaction.correlationId,
      };
    },
  );
}
