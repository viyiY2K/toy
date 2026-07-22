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
  'taskId',
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
  if (typeof session.taskId === 'string') {
    if (context?.getTask) {
      collector.check((await context.getTask(session.taskId)) !== undefined, 'session.task.missing', 'taskId', '引用的 Task 不存在');
    } else {
      collector.add('validation.context.required', 'taskId', '校验 Task 引用需要事务查询上下文');
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
    'taskId',
    'startedAt',
    'plannedDuration',
    'pomodoroIndex',
    'originIntervalId',
    'sourceFocusSessionId',
    'dayPlanId',
  ] as const) {
    collector.check(session[field] === previous[field], `session.${field}.immutable`, field, '创建后不可修改');
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
  validateUuidV7(session.taskId, 'taskId', collector, true);
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
    collector.check(session.taskId !== null, 'session.task.required', 'taskId', 'focus 必须关联 Task');
    collector.check(session.pomodoroIndex !== null, 'session.pomodoroIndex.required', 'pomodoroIndex', 'focus 必须非 null');
    for (const field of ['sourceFocusSessionId', 'originIntervalId', 'skipKind', 'suggestedRest', 'actualRest'] as const) checkNull(session[field], field, collector);
  } else if (session.type === 'extraFocus') {
    collector.check(session.status === 'completed', 'session.extra.status', 'status', 'extraFocus 固定 completed');
    collector.check(session.taskId !== null, 'session.task.required', 'taskId', 'extraFocus 必须关联 Task');
    collector.check(session.originIntervalId !== null, 'session.interval.required', 'originIntervalId', 'extraFocus 必须关联 interval');
    for (const field of ['pomodoroIndex', 'sourceFocusSessionId', 'skipKind', 'suggestedRest', 'actualRest'] as const) checkNull(session[field], field, collector);
  } else if (BREAK_TYPES.has(String(session.type))) {
    collector.check(session.status === 'active' || session.status === 'completed' || session.status === 'skipped', 'session.status.type', 'status', 'break 状态非法');
    for (const field of ['taskId', 'pomodoroIndex', 'originIntervalId'] as const) checkNull(session[field], field, collector);
    collector.check(session.sourceFocusSessionId !== null, 'session.sourceFocus.required', 'sourceFocusSessionId', 'break 必须关联来源 focus');
  } else if (session.type === 'extraRest') {
    collector.check(session.status === 'completed', 'session.extra.status', 'status', 'extraRest 固定 completed');
    collector.check(session.originIntervalId !== null, 'session.interval.required', 'originIntervalId', 'extraRest 必须关联 interval');
    for (const field of ['taskId', 'pomodoroIndex', 'sourceFocusSessionId', 'skipKind'] as const) checkNull(session[field], field, collector);
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
