import { deriveAppDate } from '../time';
import type { Session, Settings } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  requireRecord,
  validateExactKeys,
  validateIanaTimeZone,
  validateInteger,
  validateIsoDateTime,
  validateStoredLocalDate,
  validateSyncableBase,
  validateUuidV7,
  type ValidationIssue,
} from './primitives';

const SESSION_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'timezone',
  'localDate',
  'type',
  'status',
  'taskIds',
  'mergeGroupId',
  'startedAt',
  'endedAt',
  'plannedDuration',
  'actualDuration',
  'pomodoroIndex',
  'skipKind',
  'originIntervalId',
  'sourceFocusSessionId',
  'suggestedRest',
  'actualRest',
  'dayPlanId',
] as const;

const TYPES = new Set(['focus', 'shortBreak', 'longBreak', 'extraFocus', 'extraRest']);
const STATUSES = new Set(['active', 'completed', 'discarded', 'skipped']);
const SKIP_KINDS = new Set(['explicitSkip', 'noResponse', 'appClosed', 'missed']);
const STANDARD_TYPES = new Set(['focus', 'shortBreak', 'longBreak']);
const BREAK_TYPES = new Set(['shortBreak', 'longBreak']);
const EXTRA_TYPES = new Set(['extraFocus', 'extraRest']);

function checkNull(
  value: unknown,
  path: string,
  collector: ValidationCollector,
  code = 'session.field.notApplicable',
): void {
  collector.check(value === null, code, path, '此 type/status 下必须为 null');
}

/** 关联任务列表的通用形状校验（§3.3 taskIds 取值约束）；按 type 的长度要求在下方分流。 */
function validateTaskIds(value: unknown, collector: ValidationCollector): void {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'taskIds', '必须为数组');
    return;
  }
  value.forEach((taskId, index) => validateUuidV7(taskId, `taskIds[${index}]`, collector));
  collector.check(
    new Set(value).size === value.length,
    'session.taskIds.duplicate',
    'taskIds',
    '关联任务不得重复',
  );
}

/** 不适用该 type 的 `taskIds`（break 类）必须是空数组，不是 null、不是省略（§3.3 关键规则 1）。 */
function checkEmptyTaskIds(value: unknown, collector: ValidationCollector): void {
  collector.check(
    Array.isArray(value) && value.length === 0,
    'session.taskIds.notApplicable',
    'taskIds',
    '此 type 下必须为空数组',
  );
}

async function validateRestKeys(
  session: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  const keys = [session.suggestedRest, session.actualRest].filter(
    (value): value is string => typeof value === 'string',
  );
  if (keys.length === 0) return;
  if (!context?.getActiveSettings) {
    collector.add('validation.context.required', 'suggestedRest', '校验休息项需要有效 Settings 查询');
    return;
  }
  const settings = await context.getActiveSettings();
  if (!settings) {
    collector.add('session.settings.missing', 'suggestedRest', '不存在有效 Settings');
    return;
  }
  for (const field of ['suggestedRest', 'actualRest'] as const) {
    const key = session[field];
    if (typeof key !== 'string') continue;
    const item = settings.restSuggestions.find((candidate) => candidate.key === key);
    collector.check(item !== undefined, 'session.restKey.missing', field, 'Settings 中不存在该休息项 key');
    if (item && BREAK_TYPES.has(String(session.type))) {
      collector.check(
        item.appliesTo.includes(session.type as 'shortBreak' | 'longBreak'),
        'session.restKey.appliesTo',
        field,
        '休息项不适用于该 break type',
      );
    }
  }
}

async function validateReferences(
  session: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  if (Array.isArray(session.taskIds) && session.taskIds.length > 0) {
    if (context?.getTask) {
      for (const [index, taskId] of session.taskIds.entries()) {
        if (typeof taskId !== 'string') continue;
        collector.check(
          (await context.getTask(taskId)) !== undefined,
          'session.task.missing',
          `taskIds[${index}]`,
          '引用的 Task 不存在',
        );
      }
    } else {
      collector.add('validation.context.required', 'taskIds', '校验 Task 引用需要事务查询上下文');
    }
  }
  if (typeof session.mergeGroupId === 'string') {
    if (context?.getMergeGroup) {
      collector.check(
        (await context.getMergeGroup(session.mergeGroupId)) !== undefined,
        'session.mergeGroup.missing',
        'mergeGroupId',
        '引用的 MergeGroup 不存在',
      );
    } else {
      collector.add('validation.context.required', 'mergeGroupId', '校验合并组引用需要事务查询上下文');
    }
  }
  if (typeof session.originIntervalId === 'string') {
    if (context?.getUnresolvedInterval) {
      collector.check(
        (await context.getUnresolvedInterval(session.originIntervalId)) !== undefined,
        'session.interval.missing',
        'originIntervalId',
        '引用的 UnresolvedInterval 不存在',
      );
    } else {
      collector.add('validation.context.required', 'originIntervalId', '校验 interval 引用需要事务查询上下文');
    }
  }
  if (typeof session.sourceFocusSessionId === 'string') {
    if (context?.getSession) {
      const focus = await context.getSession(session.sourceFocusSessionId);
      collector.check(
        focus?.type === 'focus' && focus.status === 'completed',
        'session.sourceFocus.invalid',
        'sourceFocusSessionId',
        '必须引用 completed 标准 focus',
      );
    } else {
      collector.add('validation.context.required', 'sourceFocusSessionId', '校验来源 focus 需要事务查询上下文');
    }
  }
  if (typeof session.dayPlanId === 'string') {
    if (context?.getDayPlan) {
      collector.check(
        (await context.getDayPlan(session.dayPlanId)) !== undefined,
        'session.dayPlan.missing',
        'dayPlanId',
        '引用的 DayPlan 不存在',
      );
    } else {
      collector.add('validation.context.required', 'dayPlanId', '校验 DayPlan 引用需要事务查询上下文');
    }
  }
}

async function validateCreationFacts(
  session: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<Session | undefined> {
  if (typeof session.id !== 'string') return undefined;
  if (!context?.getSession) {
    collector.add('validation.context.required', 'Session.id', '校验 Session 创建事实需要事务查询上下文');
    return undefined;
  }
  const previous = await context.getSession(session.id);
  if (!previous) return undefined;
  for (const field of [
    'timezone',
    'localDate',
    'type',
    'mergeGroupId',
    'startedAt',
    'plannedDuration',
    'pomodoroIndex',
    'originIntervalId',
    'sourceFocusSessionId',
    'dayPlanId',
  ] as const) {
    collector.check(session[field] === previous[field], `session.${field}.immutable`, field, '创建后不可修改');
  }
  /*
   * taskIds 不是无条件不可变：合并番茄钟允许计时途中往组里补任务，其快照按 §3.3
   * 关键规则 11 取"Session 终结那一刻"的成员，因此 active 的合并 Session 可以改。
   * 非合并 Session、以及任何已终结的 Session，taskIds 都是固定的历史事实。
   */
  const mutableTaskIds = previous.status === 'active' && previous.mergeGroupId !== null;
  if (!mutableTaskIds) {
    const current = Array.isArray(session.taskIds) ? session.taskIds : undefined;
    collector.check(
      current !== undefined &&
        current.length === previous.taskIds.length &&
        current.every((taskId, index) => taskId === previous.taskIds[index]),
      'session.taskIds.immutable',
      'taskIds',
      '创建后不可修改（合并 Session 只在进行中可增删成员）',
    );
  }
  return previous;
}

async function validateNewStandardSession(
  session: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  if (!STANDARD_TYPES.has(String(session.type))) return;
  if (!context?.getActiveSettings || !context.getActiveDayPlanByAppDate) {
    collector.add('validation.context.required', 'Session', '新标准 Session 需要 Settings 与 DayPlan 查询上下文');
    return;
  }
  const settings = await context.getActiveSettings();
  if (!settings) {
    collector.add('session.settings.missing', 'Session', '不存在有效 Settings');
    return;
  }
  const durationField =
    session.type === 'focus'
      ? 'focusMinutes'
      : session.type === 'shortBreak'
        ? 'shortBreakMinutes'
        : 'longBreakMinutes';
  collector.check(
    session.plannedDuration === settings[durationField] * 60,
    'session.plannedDuration.settings',
    'plannedDuration',
    '必须取创建时 Settings 对应分钟数 × 60',
  );
  if (
    typeof session.startedAt === 'string' &&
    typeof session.timezone === 'string' &&
    validateIsoDateTimeSilently(session.startedAt) &&
    validateIanaTimeZoneSilently(session.timezone)
  ) {
    const appDate = deriveAppDate(
      session.startedAt,
      session.timezone,
      settings.appDayStartOffsetMinutes,
    );
    const dayPlan = await context.getActiveDayPlanByAppDate(appDate);
    collector.check(
      session.dayPlanId === (dayPlan?.id ?? null),
      'session.dayPlan.current',
      'dayPlanId',
      '必须匹配该产品日的有效 DayPlan；不存在时为 null',
    );
  }
}

function validateIsoDateTimeSilently(value: string): boolean {
  const collector = new ValidationCollector();
  return validateIsoDateTime(value, 'time', collector) && collector.issues.length === 0;
}

function validateIanaTimeZoneSilently(value: string): boolean {
  const collector = new ValidationCollector();
  return validateIanaTimeZone(value, 'timezone', collector) && collector.issues.length === 0;
}

export async function collectSessionValidationIssues(
  value: unknown,
  context?: ValidationContext,
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const session = requireRecord(value, 'Session', collector);
  if (!session) return collector.issues;
  validateExactKeys(session, SESSION_KEYS, 'Session', collector);
  validateSyncableBase(session, collector);
  collector.check(typeof session.type === 'string' && TYPES.has(session.type), 'session.type', 'type', '非法 Session type');
  collector.check(typeof session.status === 'string' && STATUSES.has(session.status), 'session.status', 'status', '非法 Session status');
  validateTaskIds(session.taskIds, collector);
  validateUuidV7(session.mergeGroupId, 'mergeGroupId', collector, true);
  validateIsoDateTime(session.startedAt, 'startedAt', collector);
  validateIsoDateTime(session.endedAt, 'endedAt', collector, true);
  if (session.plannedDuration !== null) validateInteger(session.plannedDuration, 'plannedDuration', collector, 1);
  if (session.actualDuration !== null) validateInteger(session.actualDuration, 'actualDuration', collector, 0);
  if (session.pomodoroIndex !== null) validateInteger(session.pomodoroIndex, 'pomodoroIndex', collector, 1);
  collector.check(
    session.skipKind === null || (typeof session.skipKind === 'string' && SKIP_KINDS.has(session.skipKind)),
    'session.skipKind',
    'skipKind',
    '非法 skipKind',
  );
  validateUuidV7(session.originIntervalId, 'originIntervalId', collector, true);
  validateUuidV7(session.sourceFocusSessionId, 'sourceFocusSessionId', collector, true);
  collector.check(session.suggestedRest === null || typeof session.suggestedRest === 'string', 'type.stringOrNull', 'suggestedRest', '必须为 string 或 null');
  collector.check(session.actualRest === null || typeof session.actualRest === 'string', 'type.stringOrNull', 'actualRest', '必须为 string 或 null');
  validateUuidV7(session.dayPlanId, 'dayPlanId', collector, true);
  validateStoredLocalDate(session.localDate, session.startedAt, session.timezone, collector);

  if (session.status === 'active') {
    checkNull(session.endedAt, 'endedAt', collector, 'session.active.endedAt');
    checkNull(session.actualDuration, 'actualDuration', collector, 'session.active.actualDuration');
  } else if (session.status === 'completed' || session.status === 'discarded' || session.status === 'skipped') {
    collector.check(session.endedAt !== null, 'session.endedAt.required', 'endedAt', '终结状态必须非 null');
    collector.check(session.actualDuration !== null, 'session.actualDuration.required', 'actualDuration', '终结状态必须非 null');
  }
  if (session.status === 'skipped') {
    collector.check(session.actualDuration === 0, 'session.skipped.duration', 'actualDuration', 'skipped 必须为 0');
    collector.check(session.skipKind !== null, 'session.skipped.kind', 'skipKind', 'skipped 必须非 null');
  } else {
    checkNull(session.skipKind, 'skipKind', collector, 'session.skipKind.state');
  }

  if (session.type === 'focus') {
    collector.check(session.status === 'active' || session.status === 'completed' || session.status === 'discarded', 'session.status.type', 'status', 'focus 状态非法');
    collector.check(
      Array.isArray(session.taskIds) && session.taskIds.length >= 1,
      'session.task.required',
      'taskIds',
      'focus 必须关联至少 1 个 Task',
    );
    collector.check(session.pomodoroIndex !== null, 'session.pomodoroIndex.required', 'pomodoroIndex', 'focus 必须非 null');
    for (const field of ['sourceFocusSessionId', 'originIntervalId', 'skipKind', 'suggestedRest', 'actualRest'] as const) checkNull(session[field], field, collector);
  } else if (session.type === 'extraFocus') {
    collector.check(session.status === 'completed', 'session.extra.status', 'status', 'extraFocus 固定 completed');
    collector.check(
      Array.isArray(session.taskIds) && session.taskIds.length === 1,
      'session.task.required',
      'taskIds',
      'extraFocus 必须恰好关联 1 个 Task（不支持合并）',
    );
    collector.check(session.originIntervalId !== null, 'session.interval.required', 'originIntervalId', 'extraFocus 必须关联 interval');
    for (const field of ['pomodoroIndex', 'sourceFocusSessionId', 'skipKind', 'suggestedRest', 'actualRest'] as const) checkNull(session[field], field, collector);
  } else if (BREAK_TYPES.has(String(session.type))) {
    collector.check(session.status === 'active' || session.status === 'completed' || session.status === 'skipped', 'session.status.type', 'status', 'break 状态非法');
    checkEmptyTaskIds(session.taskIds, collector);
    for (const field of ['pomodoroIndex', 'originIntervalId'] as const) checkNull(session[field], field, collector);
    collector.check(session.sourceFocusSessionId !== null, 'session.sourceFocus.required', 'sourceFocusSessionId', 'break 必须关联来源 focus');
  } else if (session.type === 'extraRest') {
    collector.check(session.status === 'completed', 'session.extra.status', 'status', 'extraRest 固定 completed');
    collector.check(session.originIntervalId !== null, 'session.interval.required', 'originIntervalId', 'extraRest 必须关联 interval');
    checkEmptyTaskIds(session.taskIds, collector);
    for (const field of ['pomodoroIndex', 'sourceFocusSessionId', 'skipKind'] as const) checkNull(session[field], field, collector);
  }

  // §3.3 字段一致性约束 15：合并只存在于标准 focus，且必须真的是"多个任务一起做"。
  if (session.mergeGroupId === null) {
    collector.check(
      !Array.isArray(session.taskIds) || session.taskIds.length <= 1 || session.type !== 'focus',
      'session.mergeGroup.required',
      'mergeGroupId',
      '多任务 focus 必须关联合并组',
    );
  } else {
    collector.check(
      session.type === 'focus',
      'session.mergeGroup.type',
      'mergeGroupId',
      '只有标准 focus 可以关联合并组',
    );
    collector.check(
      Array.isArray(session.taskIds) && session.taskIds.length >= 2,
      'session.mergeGroup.taskIds',
      'taskIds',
      '合并 focus 必须关联至少 2 个 Task',
    );
  }

  if (EXTRA_TYPES.has(String(session.type))) {
    checkNull(session.plannedDuration, 'plannedDuration', collector, 'session.plannedDuration.extra');
    collector.check(
      typeof session.actualDuration === 'number' && Number.isInteger(session.actualDuration) && session.actualDuration > 0,
      'session.actualDuration.extra',
      'actualDuration',
      'extra Session 必须为正整数',
    );
  } else if (STANDARD_TYPES.has(String(session.type))) {
    collector.check(
      typeof session.plannedDuration === 'number' && Number.isInteger(session.plannedDuration) && session.plannedDuration > 0,
      'session.plannedDuration.standard',
      'plannedDuration',
      '标准 Session 必须为正整数',
    );
  }

  const previous = await validateCreationFacts(session, context, collector);
  await validateReferences(session, context, collector);
  await validateRestKeys(session, context, collector);
  if (!previous) await validateNewStandardSession(session, context, collector);
  return collector.issues;
}

export async function validateSession(value: unknown, context?: ValidationContext): Promise<Session> {
  const issues = await collectSessionValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('Session', issues);
  return value as Session;
}
