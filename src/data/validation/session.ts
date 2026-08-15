import { deriveAppDate } from '../time';
import type { Session, Settings } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  isRecord,
  requireRecord,
  validateExactKeys,
  validateIanaTimeZone,
  validateInteger,
  validateIsoDateTime,
  validateStoredLocalDate,
  validateSyncableBase,
  validateUuidV7,
  type SyncWriteMode,
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
  'taskSegments',
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

/**
 * 成员分段的形状与内部一致性（§3.3 taskSegments 结构 + 字段一致性约束 16）。
 * 适用性（何时必须为空、何时必须与 taskIds 对齐、总和是否等于 actualDuration）在下方分流。
 */
function validateTaskSegmentShapes(value: unknown, collector: ValidationCollector): void {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'taskSegments', '必须为数组');
    return;
  }
  value.forEach((segment, index) => {
    const path = `taskSegments[${index}]`;
    const record = requireRecord(segment, path, collector);
    if (!record) return;
    validateExactKeys(record, ['taskId', 'startedAt', 'endedAt', 'actualDuration'], path, collector);
    validateUuidV7(record.taskId, `${path}.taskId`, collector);
    const startedOk = validateIsoDateTime(record.startedAt, `${path}.startedAt`, collector);
    const endedOk = validateIsoDateTime(record.endedAt, `${path}.endedAt`, collector);
    if (startedOk && endedOk) {
      collector.check(
        Date.parse(String(record.endedAt)) >= Date.parse(String(record.startedAt)),
        'session.taskSegments.order',
        `${path}.endedAt`,
        '分段结束时刻不得早于开始时刻',
      );
    }
    // 未轮到的成员保留显式 0 分段（§3.3 关键规则 13），故下限是 0 而不是 1。
    validateInteger(record.actualDuration, `${path}.actualDuration`, collector, 0);
  });
  const taskIds = value.flatMap((segment) =>
    isRecord(segment) && typeof segment.taskId === 'string' ? [segment.taskId] : [],
  );
  collector.check(
    new Set(taskIds).size === taskIds.length,
    'session.taskSegments.duplicate',
    'taskSegments',
    '同一 Session 内不允许出现两条 taskId 相同的分段',
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
   * taskIds 不是无条件不可变：合并番茄钟允许计时途中编辑**未来队列**（补新任务、移出
   * 还没轮到的成员），其快照按 §3.3 关键规则 11 取"Session 终结那一刻"的成员，因此
   * active 的合并 Session 可以改。当前成员本身被锁定，但那是 command 层按 §3.3 关键
   * 规则 14 拒绝的事——validator 只认"这条记录的形状合不合法"，看不到"谁是当前成员"
   * 所需的 Task 完成时刻上下文，不在这里重复判断。
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
      '创建后不可修改（合并 Session 只在进行中可增删未来成员）',
    );
  }
  /*
   * §3.3 关键规则 13 末段：Session 终结后 taskSegments 固定，不随此后 MergeGroup 的
   * 任何变化而改写。终结那一次写入（active → completed/discarded）除外。
   */
  if (previous.status !== 'active') {
    const current = Array.isArray(session.taskSegments) ? session.taskSegments : undefined;
    collector.check(
      current !== undefined &&
        current.length === previous.taskSegments.length &&
        current.every((segment, index) => {
          const before = previous.taskSegments[index];
          return (
            isRecord(segment) &&
            before !== undefined &&
            segment.taskId === before.taskId &&
            segment.startedAt === before.startedAt &&
            segment.endedAt === before.endedAt &&
            segment.actualDuration === before.actualDuration
          );
        }),
      'session.taskSegments.immutable',
      'taskSegments',
      'Session 终结后成员分段固定，不随后续合并组变化而改写',
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
  mode: SyncWriteMode = 'local',
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const session = requireRecord(value, 'Session', collector);
  if (!session) return collector.issues;
  validateExactKeys(session, SESSION_KEYS, 'Session', collector);
  validateSyncableBase(session, collector, mode);
  collector.check(typeof session.type === 'string' && TYPES.has(session.type), 'session.type', 'type', '非法 Session type');
  collector.check(typeof session.status === 'string' && STATUSES.has(session.status), 'session.status', 'status', '非法 Session status');
  validateTaskIds(session.taskIds, collector);
  validateUuidV7(session.mergeGroupId, 'mergeGroupId', collector, true);
  validateTaskSegmentShapes(session.taskSegments, collector);
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
    /*
     * §3.3 一致性约束 16：非合并 Session（含全部非 focus type）不存在成员分段——
     * 单任务专注的任务耗时就是 actualDuration 本身，不需要拆。
     */
    collector.check(
      Array.isArray(session.taskSegments) && session.taskSegments.length === 0,
      'session.taskSegments.notApplicable',
      'taskSegments',
      '非合并 Session 必须为空数组',
    );
  } else {
    collector.check(
      session.type === 'focus',
      'session.mergeGroup.type',
      'mergeGroupId',
      '只有标准 focus 可以关联合并组',
    );
    /*
     * 开轮命令要求至少 2 个未完成成员；这里是已开跑 Session 的存储约束，必须保持 ≥ 1。
     * 进行中移出未来成员后，终结快照可合法缩到 1（§3.8 关键规则 15）。
     */
    collector.check(
      Array.isArray(session.taskIds) && session.taskIds.length >= 1,
      'session.mergeGroup.taskIds',
      'taskIds',
      '合并 focus 必须关联至少 1 个 Task',
    );
    /*
     * §3.3 一致性约束 16：分段在 Session **终结时**才一次性写入，因此 active 必须为空；
     * 终结后每个参与本轮的成员都必须有且只有一条分段（哪怕耗时为 0），且各段之和
     * 必须精确等于 Session.actualDuration——对不上的写入一律拒绝，避免"任务维度加总
     * 与全局对不上账"这类旧口径缺陷以另一种形式复活。
     */
    if (session.status === 'active') {
      collector.check(
        Array.isArray(session.taskSegments) && session.taskSegments.length === 0,
        'session.taskSegments.active',
        'taskSegments',
        '进行中的合并 Session 必须为空数组（分段在终结时才写入）',
      );
    } else if (session.status === 'completed' || session.status === 'discarded') {
      const segments = Array.isArray(session.taskSegments) ? session.taskSegments : [];
      const taskIds = Array.isArray(session.taskIds) ? session.taskIds : [];
      const segmentIds = segments.flatMap((segment) =>
        isRecord(segment) && typeof segment.taskId === 'string' ? [segment.taskId] : [],
      );
      collector.check(
        segmentIds.length === taskIds.length &&
          new Set(segmentIds).size === new Set(taskIds).size &&
          taskIds.every((taskId) => segmentIds.includes(String(taskId))),
        'session.taskSegments.coverage',
        'taskSegments',
        '终结的合并 Session 必须为每个参与成员各写一条分段，taskId 集合须与 taskIds 完全一致',
      );
      if (typeof session.actualDuration === 'number') {
        const total = segments.reduce(
          (sum, segment) =>
            sum + (isRecord(segment) && typeof segment.actualDuration === 'number' ? segment.actualDuration : 0),
          0,
        );
        collector.check(
          total === session.actualDuration,
          'session.taskSegments.total',
          'taskSegments',
          '各分段 actualDuration 之和必须精确等于 Session.actualDuration',
        );
      }
    }
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

export async function validateSession(
  value: unknown,
  context?: ValidationContext,
  mode: SyncWriteMode = 'local',
): Promise<Session> {
  const issues = await collectSessionValidationIssues(value, context, mode);
  if (issues.length > 0) throw new EntityValidationError('Session', issues);
  return value as Session;
}
