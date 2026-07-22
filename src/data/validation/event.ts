import { EVENT_TYPES, type EventType } from '../events';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import type { Event } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  ValidationCollector,
  isRecord,
  requireRecord,
  validateAllowedKeys,
  validateExactKeys,
  validateFiniteNumber,
  validateInteger,
  validateIsoDate,
  validateIsoDateTime,
  validateStoredLocalDate,
  validateUuidV7,
} from './primitives';

type Rule = (value: unknown, path: string, collector: ValidationCollector) => void;

interface PayloadSchema {
  required: Readonly<Record<string, Rule>>;
  optional?: Readonly<Record<string, Rule>>;
  validate?: (payload: Record<string, unknown>, collector: ValidationCollector) => void;
}

const stringRule = (options: { nullable?: boolean; nonEmpty?: boolean; max?: number } = {}): Rule =>
  (value, path, collector) => {
    if (options.nullable && value === null) return;
    const ok = typeof value === 'string';
    collector.check(ok, options.nullable ? 'type.stringOrNull' : 'type.string', path, '必须为 string');
    if (!ok) return;
    if (options.nonEmpty) collector.check(value.trim().length > 0, 'string.nonEmpty', path, '不得为空');
    if (options.max !== undefined) collector.check(value.length <= options.max, 'string.maxLength', path, `长度不得超过 ${options.max}`);
  };

const booleanRule: Rule = (value, path, collector) =>
  collector.check(typeof value === 'boolean', 'type.boolean', path, '必须为 boolean');
const unknownRule: Rule = () => undefined;
const objectRule: Rule = (value, path, collector) => {
  requireRecord(value, path, collector);
};
const uuidRule = (nullable = false): Rule => (value, path, collector) => {
  validateUuidV7(value, path, collector, nullable);
};
const isoRule = (nullable = false): Rule => (value, path, collector) => {
  validateIsoDateTime(value, path, collector, nullable);
};
const dateRule: Rule = (value, path, collector) => {
  validateIsoDate(value, path, collector);
};
const integerRule = (min?: number, max?: number, nullable = false): Rule =>
  (value, path, collector) => {
    if (nullable && value === null) return;
    validateInteger(value, path, collector, min, max);
  };
const finiteRule = (minExclusive?: number): Rule => (value, path, collector) => {
  validateFiniteNumber(value, path, collector, minExclusive);
};
const enumRule = <T extends string>(values: readonly T[], nullable = false): Rule => {
  const allowed = new Set<string>(values);
  return (value, path, collector) => {
    if (nullable && value === null) return;
    collector.check(typeof value === 'string' && allowed.has(value), 'value.enum', path, `必须为 ${values.join(' / ')}`);
  };
};
const literalRule = (values: readonly unknown[], nullable = false): Rule => {
  const allowed = new Set(values);
  return (value, path, collector) => {
    if (nullable && value === null) return;
    collector.check(allowed.has(value), 'value.literal', path, `必须为 ${values.join(' / ')}`);
  };
};
const stringArrayRule = (options: { nonEmpty?: boolean; unique?: boolean } = {}): Rule =>
  (value, path, collector) => {
    const ok = Array.isArray(value) && value.every((item) => typeof item === 'string');
    collector.check(ok, 'type.stringArray', path, '必须为 string[]');
    if (!ok) return;
    if (options.nonEmpty) collector.check(value.length > 0, 'array.nonEmpty', path, '不得为空数组');
    if (options.unique) collector.check(new Set(value).size === value.length, 'array.unique', path, '不得包含重复值');
  };

const nonEmptyString = stringRule({ nonEmpty: true });
const nullableString = stringRule({ nullable: true });
const uuid = uuidRule();
const nullableUuid = uuidRule(true);
const nonNegativeInteger = integerRule(0);
const positiveInteger = integerRule(1);
const nullableNonNegativeInteger = integerRule(0, undefined, true);
const budgetMode = enumRule(['conservative', 'optimistic', 'manual'] as const);
const breakType = enumRule(['shortBreak', 'longBreak'] as const);
const deductionType = enumRule(['fixed', 'life'] as const);
const taskSource = enumRule([
  'manual',
  'systemDailyTemplate',
  'unresolvedIntervalClassification',
  'splitChild',
  'triageCapture',
] as const);
const energySource = enumRule([
  'dayStart',
  'beforeFocus',
  'afterFocus',
  'afterShortBreak',
  'afterLongBreak',
  'afterExtraFocus',
  'afterExtraRest',
  'onReturn',
  'manual',
] as const);
const promptType = enumRule(['taskCompletionCheck', 'energyRecording', 'taskSplitSuggestion'] as const);
const promptContext = enumRule([
  'beforeFocus',
  'afterFocus',
  'afterShortBreak',
  'afterLongBreak',
  'afterExtraFocus',
  'afterExtraRest',
  'dayStart',
  'onReturn',
] as const, true);

function schema(
  required: Readonly<Record<string, Rule>>,
  optional?: Readonly<Record<string, Rule>>,
  validate?: PayloadSchema['validate'],
): PayloadSchema {
  return { required, optional, validate };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (typeof left === 'object' && left !== null && !Array.isArray(left) && typeof right === 'object' && right !== null && !Array.isArray(right)) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    return leftKeys.length === Object.keys(rightRecord).length && leftKeys.every((key) => key in rightRecord && valuesEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function requireDifferent(payload: Record<string, unknown>, left: string, right: string, collector: ValidationCollector): void {
  collector.check(!valuesEqual(payload[left], payload[right]), 'event.payload.noChange', `payload.${right}`, `${left} 与 ${right} 不得相同`);
}

function validatePrompt(payload: Record<string, unknown>, collector: ValidationCollector): void {
  if (payload.promptType === 'energyRecording') {
    collector.check(payload.promptContext !== null, 'event.prompt.context.required', 'payload.promptContext', 'energyRecording 必须填写触发节点');
  } else if (typeof payload.promptType === 'string') {
    collector.check(payload.promptContext === null, 'event.prompt.context.null', 'payload.promptContext', '非 energyRecording 必须为 null');
  }
}

function validateRestChangedFields(value: unknown, path: string, collector: ValidationCollector): void {
  const changed = requireRecord(value, path, collector);
  if (!changed) return;
  validateAllowedKeys(changed, ['label', 'icon', 'sortIndex'], path, collector);
  collector.check(Object.keys(changed).length > 0, 'event.restItem.changedFields.nonEmpty', path, '至少包含一个变更字段');
  if ('label' in changed) nonEmptyString(changed.label, `${path}.label`, collector);
  if ('icon' in changed) nullableString(changed.icon, `${path}.icon`, collector);
  if ('sortIndex' in changed) nonNegativeInteger(changed.sortIndex, `${path}.sortIndex`, collector);
}

function validateSingleBreakScope(value: unknown, path: string, collector: ValidationCollector): void {
  const ok = Array.isArray(value) && value.length === 1 && (value[0] === 'shortBreak' || value[0] === 'longBreak');
  collector.check(ok, 'event.restItem.appliesTo', path, "必须为 ['shortBreak'] 或 ['longBreak']");
}

function validateDiagnosticTypes(value: unknown, path: string, collector: ValidationCollector): void {
  const ok = Array.isArray(value) && value.length > 0 && value.every((item) => item === 'error.dataWriteFailed' || item === 'error.unexpectedState');
  collector.check(ok, 'event.diagnostic.types', path, '必须为非空 error.* 事件类型数组');
  if (ok) collector.check(new Set(value).size === value.length, 'array.unique', path, '不得包含重复值');
}

function validateCustomKey(value: unknown, prefix: string, path: string, collector: ValidationCollector): void {
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    collector.add('event.customKey.prefix', path, `必须以 ${prefix} 开头`);
    return;
  }
  validateUuidV7(value.slice(prefix.length), path, collector);
}

function validateCreatedRestItem(payload: Record<string, unknown>, collector: ValidationCollector): void {
  if (!Array.isArray(payload.appliesTo) || typeof payload.key !== 'string') return;
  const prefix = payload.appliesTo[0] === 'shortBreak' ? 'short_custom_' : 'long_custom_';
  validateCustomKey(payload.key, prefix, 'payload.key', collector);
}

function validateTimerUpdate(payload: Record<string, unknown>, collector: ValidationCollector): void {
  requireDifferent(payload, 'oldValue', 'newValue', collector);
  for (const key of ['oldValue', 'newValue'] as const) {
    if (payload.field === 'focusMinutes') integerRule(5, 120)(payload[key], `payload.${key}`, collector);
    if (payload.field === 'shortBreakMinutes') integerRule(1, 30)(payload[key], `payload.${key}`, collector);
    if (payload.field === 'longBreakMinutes') literalRule([15, 20, 30])(payload[key], `payload.${key}`, collector);
  }
}

function validateTemplateUpdate(payload: Record<string, unknown>, collector: ValidationCollector): void {
  requireDifferent(payload, 'oldValue', 'newValue', collector);
  for (const key of ['oldValue', 'newValue'] as const) {
    const value = payload[key];
    if (payload.field === 'title') nonEmptyString(value, `payload.${key}`, collector);
    if (payload.field === 'estimatedPomodoros') integerRule(1, 7)(value, `payload.${key}`, collector);
    if (payload.field === 'autoAddToDayPlan') booleanRule(value, `payload.${key}`, collector);
    if (payload.field === 'sortPosition') enumRule(['first', 'last'] as const)(value, `payload.${key}`, collector);
  }
}

function validateTaskUpdate(payload: Record<string, unknown>, collector: ValidationCollector): void {
  requireDifferent(payload, 'oldValue', 'newValue', collector);
  for (const key of ['oldValue', 'newValue'] as const) {
    const value = payload[key];
    if (payload.field === 'title') stringRule({ nonEmpty: true, max: 200 })(value, `payload.${key}`, collector);
    if (payload.field === 'note' || payload.field === 'actualWorkNote') nullableString(value, `payload.${key}`, collector);
    if (payload.field === 'metadata') objectRule(value, `payload.${key}`, collector);
    if (payload.field === 'estimatedPomodoros') integerRule(1, 7)(value, `payload.${key}`, collector);
  }
}

export const EVENT_PAYLOAD_SCHEMAS = {
  'task.created': schema({ title: stringRule({ nonEmpty: true, max: 200 }), parentId: nullableUuid, estimatedPomodoros: integerRule(1, 7), source: taskSource }),
  'task.updated': schema({ field: enumRule(['title', 'note', 'actualWorkNote', 'metadata', 'estimatedPomodoros'] as const), oldValue: unknownRule, newValue: unknownRule }, undefined, validateTaskUpdate),
  'task.estimateAdjusted': schema({ round: literalRule([2, 3] as const), oldEstimate: integerRule(1, 7), newEstimate: integerRule(1, 7) }, undefined, (p, c) => requireDifferent(p, 'oldEstimate', 'newEstimate', c)),
  'task.completed': schema({ completionSource: enumRule(['manual', 'pomodoro'] as const), completedAt: isoRule(), validFocusCountAtCompletion: nonNegativeInteger }),
  'task.uncompleted': schema({ previousCompletedAt: isoRule(), previousCompletionSource: enumRule(['manual', 'pomodoro'] as const) }),
  'task.split': schema({ lineageId: uuid, newTaskId: uuid }),
  'task.archived': schema({ outcome: enumRule(['completed', 'split'] as const) }),
  'task.deleted': schema({}, { deletedReason: enumRule(['userDeleted', 'triageDismissed', 'dataCleanup'] as const, true) }),
  'task.restored': schema({ restoredFrom: enumRule(['deleted', 'archived'] as const) }),
  'subtask.added': schema({ parentId: uuid, title: stringRule({ nonEmpty: true, max: 200 }), estimatedPomodoros: integerRule(1, 7), source: enumRule(['listPage', 'timerPage'] as const) }),
  'subtask.reordered': schema({ parentId: uuid, fromIndex: nonNegativeInteger, toIndex: nonNegativeInteger }),
  'subtask.reparented': schema({ fromParentId: uuid, toParentId: uuid }),
  'subtask.unparented': schema({ previousParentId: uuid }),
  'dayPlan.created': schema({ appDate: dateRule, localDate: dateRule, budgetMode }),
  'dayPlan.updated': schema({ field: nonEmptyString, oldValue: unknownRule, newValue: unknownRule }, undefined, (p, c) => requireDifferent(p, 'oldValue', 'newValue', c)),
  // v4 §3.2 的精确公式在部分合法 Settings 快照下可使 conservative > optimistic；
  // payload 只分别要求两个值为非负整数，不额外发明顺序约束。
  'dayPlan.budgetEstimated': schema({ budgetMode, conservativePomodoros: nonNegativeInteger, optimisticPomodoros: nonNegativeInteger, workWindowMin: nonNegativeInteger }),
  'dayPlan.budgetAccepted': schema({ budgetPomodoros: nonNegativeInteger, budgetMode }),
  'dayPlan.budgetModeChanged': schema({ oldMode: budgetMode, newMode: budgetMode }, undefined, (p, c) => requireDifferent(p, 'oldMode', 'newMode', c)),
  'dayPlan.deductionAdded': schema({ deductionType, deductionId: uuid, label: nonEmptyString, hours: finiteRule(0) }),
  'dayPlan.deductionUpdated': schema({ deductionType, deductionId: uuid, label: nonEmptyString, oldHours: finiteRule(0), newHours: finiteRule(0) }, undefined, (p, c) => requireDifferent(p, 'oldHours', 'newHours', c)),
  'dayPlan.deductionRemoved': schema({ deductionType, deductionId: uuid, label: nonEmptyString, hours: finiteRule(0) }),
  'dayPlan.taskAdded': schema({ addedAtIndex: nonNegativeInteger, source: enumRule(['drag', 'button', 'systemDailyTemplate', 'unresolvedIntervalClassification'] as const) }),
  'dayPlan.taskRemoved': schema({ reason: enumRule(['userRemoved', 'taskDeleted', 'taskArchived'] as const) }),
  'dayPlan.taskReordered': schema({ fromIndex: nonNegativeInteger, toIndex: nonNegativeInteger }, undefined, (p, c) => requireDifferent(p, 'fromIndex', 'toIndex', c)),
  'dayPlan.workEnded': schema({ appDate: dateRule, localDate: dateRule, endedAfterFocusSessionId: nullableUuid, reason: enumRule(['userEndedWork'] as const) }),
  'task.reordered': schema({ fromIndex: nonNegativeInteger, toIndex: nonNegativeInteger }, undefined, (p, c) => requireDifferent(p, 'fromIndex', 'toIndex', c)),
  'task.reparented': schema({ fromParentId: (value, path, collector) => collector.check(value === null, 'value.null', path, '必须为 null'), toParentId: uuid, toIndex: nonNegativeInteger }),
  'task.movedToToday': schema({ appDate: dateRule, addedAtIndex: nonNegativeInteger }),
  'task.movedToList': schema({ fromAppDate: dateRule }),
  'focus.started': schema({ pomodoroIndex: positiveInteger, plannedDuration: positiveInteger, taskEstimateAtStart: integerRule(1, 7) }),
  'focus.completed': schema({ pomodoroIndex: positiveInteger, plannedDuration: positiveInteger, actualDuration: nonNegativeInteger }),
  'focus.discarded': schema({ pomodoroIndex: positiveInteger, actualDuration: nonNegativeInteger, reason: enumRule(['userInitiated', 'userConfirmedAfterRecovery'] as const, true), triggeredByInterruptEventId: nullableUuid }),
  'break.started': schema({ breakType, plannedDuration: positiveInteger, sourceFocusSessionId: uuid }),
  'break.completed': schema({ breakType, plannedDuration: positiveInteger, actualDuration: nonNegativeInteger, actualRest: nullableString }),
  'break.skipped': schema({ breakType, skipKind: enumRule(['explicitSkip', 'noResponse', 'appClosed', 'missed'] as const), plannedDuration: positiveInteger }),
  'restItem.shown': schema({ breakType, shownKeys: stringArrayRule({ nonEmpty: true, unique: true }), eligibleCount: nonNegativeInteger }, undefined, (p, c) => {
    if (Array.isArray(p.shownKeys) && typeof p.eligibleCount === 'number') c.check(p.eligibleCount >= p.shownKeys.length, 'event.restItem.eligibleCount', 'payload.eligibleCount', '不得小于 shownKeys 长度');
  }),
  'restItem.shuffled': schema({ breakType, shuffleCount: positiveInteger }),
  'restItem.selected': schema({ breakType, selectedKey: nonEmptyString, selectedIndex: integerRule(-1), sourceShownEventId: nullableUuid }),
  'restItem.selectionChanged': schema({ breakType, previousKey: nonEmptyString, newKey: nonEmptyString, newIndex: integerRule(-1), sourceShownEventId: nullableUuid }, undefined, (p, c) => requireDifferent(p, 'previousKey', 'newKey', c)),
  'restItem.created': schema({ key: nonEmptyString, label: nonEmptyString, appliesTo: validateSingleBreakScope, sortIndex: nonNegativeInteger }, undefined, validateCreatedRestItem),
  'restItem.updated': schema({ key: nonEmptyString, changedFields: validateRestChangedFields }),
  'restItem.disabled': schema({ key: nonEmptyString }),
  'restItem.enabled': schema({ key: nonEmptyString }),
  'restItem.deleted': schema({ key: nonEmptyString, label: nonEmptyString }, undefined, (p, c) => {
    if (typeof p.key === 'string') {
      const prefix = p.key.startsWith('short_custom_') ? 'short_custom_' : 'long_custom_';
      validateCustomKey(p.key, prefix, 'payload.key', c);
    }
  }),
  'restItem.reordered': schema({ breakType, orderedKeys: stringArrayRule({ nonEmpty: true, unique: true }) }),
  'interrupt.internal': schema({ offsetSeconds: nonNegativeInteger, note: nullableString }),
  'interrupt.external': schema({ offsetSeconds: nonNegativeInteger, note: nullableString }),
  'energy.recorded': schema({ source: energySource, energyLevel: integerRule(1, 10), mood: integerRule(1, 10, true), note: nullableString }),
  'triage.captured': schema({ title: stringRule({ nonEmpty: true, max: 200 }) }),
  'triage.movedToToday': schema({ addedAtIndex: nonNegativeInteger }),
  'triage.movedToList': schema({}),
  'triage.dismissed': schema({ dismissReason: nullableString }),
  'interval.detected': schema({ source: enumRule(['appReopened', 'systemRecovered', 'timerStateLost', 'userNoResponse'] as const), detectedSessionType: enumRule(['focus', 'shortBreak', 'longBreak'] as const, true) }),
  'interval.sessionResolved': schema({ sessionType: enumRule(['focus', 'shortBreak', 'longBreak'] as const), resolvedAs: enumRule(['completed', 'discarded', 'skipped'] as const) }, undefined, (p, c) => {
    const valid = p.resolvedAs === 'completed' || (p.sessionType === 'focus' ? p.resolvedAs === 'discarded' : p.resolvedAs === 'skipped');
    c.check(valid, 'event.interval.resolutionPair', 'payload.resolvedAs', 'sessionType 与 resolvedAs 组合非法');
  }),
  'interval.classified': schema({ classificationType: enumRule(['extraFocus', 'extraRest'] as const) }),
  'interval.ignored': schema({ ignoreReason: nullableString }),
  'settings.initialized': schema({ focusMinutes: integerRule(5, 120), shortBreakMinutes: integerRule(1, 30), longBreakMinutes: literalRule([15, 20, 30] as const), longBreakEvery: literalRule([4] as const), restSuggestionsCount: nonNegativeInteger, dailyTaskTemplatesCount: nonNegativeInteger }),
  'settings.timerUpdated': schema({ field: enumRule(['focusMinutes', 'shortBreakMinutes', 'longBreakMinutes'] as const), oldValue: positiveInteger, newValue: positiveInteger }, undefined, validateTimerUpdate),
  'settings.appDayStartOffsetUpdated': schema({ oldValue: integerRule(0, 1439), newValue: integerRule(0, 1439), changedBy: enumRule(['user', 'migration', 'system'] as const) }, undefined, (p, c) => requireDifferent(p, 'oldValue', 'newValue', c)),
  'settings.dailyTaskTemplateAdded': schema({ templateKey: nonEmptyString, title: nonEmptyString, estimatedPomodoros: integerRule(1, 7), autoAddToDayPlan: booleanRule, sortPosition: enumRule(['first', 'last'] as const), sortIndex: nonNegativeInteger }, undefined, (p, c) => validateCustomKey(p.templateKey, 'custom_', 'payload.templateKey', c)),
  'settings.dailyTaskTemplateUpdated': schema({ templateKey: nonEmptyString, field: enumRule(['title', 'estimatedPomodoros', 'autoAddToDayPlan', 'sortPosition'] as const), oldValue: unknownRule, newValue: unknownRule }, undefined, validateTemplateUpdate),
  'settings.dailyTaskTemplateRemoved': schema({ templateKey: nonEmptyString, title: nonEmptyString, wasAutoAddEnabled: booleanRule }, undefined, (p, c) => validateCustomKey(p.templateKey, 'custom_', 'payload.templateKey', c)),
  'settings.dailyTaskTemplateReordered': schema({ orderedTemplateKeys: stringArrayRule({ nonEmpty: true, unique: true }) }),
  'settings.restSuggestionDisplayModeUpdated': schema({ field: enumRule(['restSuggestionDisplayMode'] as const), oldValue: enumRule(['customOrder', 'usageFrequency'] as const), newValue: enumRule(['customOrder', 'usageFrequency'] as const), changedBy: enumRule(['user'] as const) }, undefined, (p, c) => requireDifferent(p, 'oldValue', 'newValue', c)),
  'statsBaseline.updated': schema({ oldValue: nonNegativeInteger, newValue: nonNegativeInteger }, undefined, (p, c) => requireDifferent(p, 'oldValue', 'newValue', c)),
  'data.migrationCompleted': schema({ fromSchemaVersion: nonEmptyString, toSchemaVersion: nonEmptyString, durationMs: nullableNonNegativeInteger }, undefined, (p, c) => requireDifferent(p, 'fromSchemaVersion', 'toSchemaVersion', c)),
  'data.migrationFailed': schema({ fromSchemaVersion: nonEmptyString, toSchemaVersion: nonEmptyString, errorCode: nullableString, errorMessage: nullableString }),
  'data.exported': schema({ format: enumRule(['json'] as const), schemaVersion: nonEmptyString, totalRecords: nullableNonNegativeInteger }),
  'data.imported': schema({ format: enumRule(['json'] as const), sourceSchemaVersion: nonEmptyString, totalRecords: nullableNonNegativeInteger }),
  'data.cleared': schema({ scope: enumRule(['allLocalData'] as const) }),
  'demo.loaded': schema({ demoVersion: nullableString, recordCount: nullableNonNegativeInteger }),
  'demo.cleared': schema({ recordCount: nullableNonNegativeInteger }),
  'notification.shown': schema({ notificationType: enumRule(['focusCompleted', 'breakCompleted'] as const) }),
  'prompt.shown': schema({ promptType, promptContext }, undefined, validatePrompt),
  'prompt.dismissed': schema({ promptType, promptContext }, undefined, validatePrompt),
  'error.dataWriteFailed': schema({ errorCode: nonEmptyString, errorMessage: nullableString, context: objectRule }),
  'error.unexpectedState': schema({ errorCode: nonEmptyString, errorMessage: nullableString, context: objectRule }),
  'diagnosticLog.exported': schema({ format: enumRule(['json'] as const), rangeDays: integerRule(1, 90), includedEventTypes: validateDiagnosticTypes, exportedEventCount: nullableNonNegativeInteger }),
} satisfies Record<EventType, PayloadSchema>;

export const EVENT_ENTITY_KEYS = [
  'id', 'createdAt', 'schemaVersion', 'timezone', 'localDate', 'type', 'occurredAt', 'payload',
  'taskId', 'sessionId', 'dayPlanId', 'energyRecordId', 'unresolvedIntervalId', 'settingsId', 'correlationId',
] as const;

type AssociationKey = 'taskId' | 'sessionId' | 'dayPlanId' | 'energyRecordId' | 'unresolvedIntervalId' | 'settingsId';
interface AssociationSchema { required: readonly AssociationKey[]; optional?: readonly AssociationKey[] }
const a = (required: readonly AssociationKey[], optional?: readonly AssociationKey[]): AssociationSchema => ({ required, optional });

export const EVENT_ASSOCIATION_SCHEMAS = {
  'task.created': a(['taskId'], ['dayPlanId', 'unresolvedIntervalId']),
  'task.updated': a(['taskId']), 'task.estimateAdjusted': a(['taskId']), 'task.completed': a(['taskId'], ['sessionId']),
  'task.uncompleted': a(['taskId']), 'task.split': a(['taskId']), 'task.archived': a(['taskId']), 'task.deleted': a(['taskId']), 'task.restored': a(['taskId']),
  'subtask.added': a(['taskId'], ['sessionId']), 'subtask.reordered': a(['taskId']), 'subtask.reparented': a(['taskId']), 'subtask.unparented': a(['taskId']),
  'dayPlan.created': a(['dayPlanId']), 'dayPlan.updated': a(['dayPlanId']), 'dayPlan.budgetEstimated': a(['dayPlanId']), 'dayPlan.budgetAccepted': a(['dayPlanId']), 'dayPlan.budgetModeChanged': a(['dayPlanId']),
  'dayPlan.deductionAdded': a(['dayPlanId']), 'dayPlan.deductionUpdated': a(['dayPlanId']), 'dayPlan.deductionRemoved': a(['dayPlanId']),
  'dayPlan.taskAdded': a(['dayPlanId', 'taskId'], ['unresolvedIntervalId']), 'dayPlan.taskRemoved': a(['dayPlanId', 'taskId']), 'dayPlan.taskReordered': a(['dayPlanId', 'taskId']),
  'dayPlan.workEnded': a(['dayPlanId'], ['taskId', 'sessionId']),
  'task.reordered': a(['taskId']), 'task.reparented': a(['taskId']), 'task.movedToToday': a(['taskId', 'dayPlanId']), 'task.movedToList': a(['taskId', 'dayPlanId']),
  'focus.started': a(['taskId', 'sessionId'], ['dayPlanId']), 'focus.completed': a(['taskId', 'sessionId'], ['dayPlanId']), 'focus.discarded': a(['taskId', 'sessionId'], ['dayPlanId']),
  'break.started': a(['sessionId'], ['dayPlanId']), 'break.completed': a(['sessionId'], ['dayPlanId']), 'break.skipped': a(['sessionId'], ['dayPlanId']),
  'restItem.shown': a(['sessionId', 'settingsId']), 'restItem.shuffled': a(['sessionId', 'settingsId']), 'restItem.selected': a(['sessionId', 'settingsId']), 'restItem.selectionChanged': a(['sessionId', 'settingsId']),
  'restItem.created': a(['settingsId']), 'restItem.updated': a(['settingsId']), 'restItem.disabled': a(['settingsId']), 'restItem.enabled': a(['settingsId']), 'restItem.deleted': a(['settingsId']), 'restItem.reordered': a(['settingsId']),
  'interrupt.internal': a(['sessionId', 'taskId'], ['dayPlanId']), 'interrupt.external': a(['sessionId', 'taskId'], ['dayPlanId']),
  'energy.recorded': a(['energyRecordId'], ['sessionId', 'taskId', 'dayPlanId']),
  'triage.captured': a(['taskId', 'sessionId'], ['dayPlanId']), 'triage.movedToToday': a(['taskId', 'dayPlanId']), 'triage.movedToList': a(['taskId']), 'triage.dismissed': a(['taskId']),
  'interval.detected': a(['unresolvedIntervalId'], ['sessionId', 'taskId', 'dayPlanId']), 'interval.sessionResolved': a(['unresolvedIntervalId', 'sessionId'], ['taskId', 'dayPlanId']),
  'interval.classified': a(['unresolvedIntervalId', 'sessionId'], ['taskId', 'dayPlanId']), 'interval.ignored': a(['unresolvedIntervalId']),
  'settings.initialized': a(['settingsId']), 'settings.timerUpdated': a(['settingsId']), 'settings.appDayStartOffsetUpdated': a(['settingsId']),
  'settings.dailyTaskTemplateAdded': a(['settingsId']), 'settings.dailyTaskTemplateUpdated': a(['settingsId']), 'settings.dailyTaskTemplateRemoved': a(['settingsId']),
  'settings.dailyTaskTemplateReordered': a(['settingsId']), 'settings.restSuggestionDisplayModeUpdated': a(['settingsId']), 'statsBaseline.updated': a(['settingsId']),
  'data.migrationCompleted': a([]), 'data.migrationFailed': a([]), 'data.exported': a([]), 'data.imported': a([]), 'data.cleared': a([]),
  'demo.loaded': a([]), 'demo.cleared': a([]), 'notification.shown': a([], ['sessionId', 'taskId']), 'prompt.shown': a([], ['taskId', 'sessionId']), 'prompt.dismissed': a([], ['taskId', 'sessionId']),
  'error.dataWriteFailed': a([], ['taskId', 'sessionId', 'dayPlanId', 'energyRecordId', 'unresolvedIntervalId', 'settingsId']),
  'error.unexpectedState': a([], ['taskId', 'sessionId', 'dayPlanId', 'energyRecordId', 'unresolvedIntervalId', 'settingsId']), 'diagnosticLog.exported': a([]),
} satisfies Record<EventType, AssociationSchema>;

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

function validatePayload(type: EventType, value: unknown, collector: ValidationCollector): Record<string, unknown> | undefined {
  const payload = requireRecord(value, 'payload', collector);
  if (!payload) return undefined;
  const payloadSchema = EVENT_PAYLOAD_SCHEMAS[type];
  const requiredKeys = Object.keys(payloadSchema.required);
  const optionalKeys = Object.keys(payloadSchema.optional ?? {});
  validateAllowedKeys(payload, [...requiredKeys, ...optionalKeys], 'payload', collector);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(payload, key)) collector.add('field.missing', `payload.${key}`, '缺少必填字段');
  }
  for (const [key, rule] of Object.entries(payloadSchema.required)) {
    if (Object.hasOwn(payload, key)) rule(payload[key], `payload.${key}`, collector);
  }
  for (const [key, rule] of Object.entries(payloadSchema.optional ?? {})) {
    if (Object.hasOwn(payload, key)) rule(payload[key], `payload.${key}`, collector);
  }
  payloadSchema.validate?.(payload, collector);
  return payload;
}

async function validateTopReference(key: AssociationKey, id: string, context: ValidationContext | undefined, collector: ValidationCollector): Promise<void> {
  const getter = key === 'taskId' ? context?.getTask : key === 'sessionId' ? context?.getSession : key === 'dayPlanId' ? context?.getDayPlan : key === 'energyRecordId' ? context?.getEnergyRecord : key === 'unresolvedIntervalId' ? context?.getUnresolvedInterval : context?.getSettings;
  if (!getter) {
    collector.add('validation.context.required', key, `校验 ${key} 引用需要事务查询上下文`);
    return;
  }
  const found = key === 'taskId'
    ? await context?.getTask?.(id)
    : key === 'sessionId'
      ? await context?.getSession?.(id)
      : key === 'dayPlanId'
        ? await context?.getDayPlan?.(id)
        : key === 'energyRecordId'
          ? await context?.getEnergyRecord?.(id)
          : key === 'unresolvedIntervalId'
            ? await context?.getUnresolvedInterval?.(id)
            : await context?.getSettings?.(id);
  collector.check(found !== undefined, 'event.association.missing', key, `引用的 ${key} 实体不存在`);
}

async function getReferencedSession(id: string, path: string, context: ValidationContext | undefined, collector: ValidationCollector) {
  if (!context?.getSession) {
    collector.add('validation.context.required', path, '校验 payload Session 引用需要事务查询上下文');
    return undefined;
  }
  const session = await context.getSession(id);
  collector.check(session !== undefined, 'event.payloadReference.missing', path, '引用的 Session 不存在');
  return session;
}

async function getReferencedEvent(id: string, path: string, context: ValidationContext | undefined, collector: ValidationCollector) {
  if (!context?.getEvent) {
    collector.add('validation.context.required', path, '校验 payload Event 引用需要事务查询上下文');
    return undefined;
  }
  const referenced = await context.getEvent(id);
  collector.check(referenced !== undefined, 'event.payloadReference.missing', path, '引用的 Event 不存在');
  return referenced;
}

async function validatePayloadReferences(
  type: EventType,
  event: Record<string, unknown>,
  payload: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  if (type === 'task.split' && typeof payload.newTaskId === 'string') {
    collector.check(event.taskId !== payload.newTaskId, 'event.task.split.newTask', 'payload.newTaskId', '新 Task 不得等于原 Task');
    if (!context?.getTask) collector.add('validation.context.required', 'payload.newTaskId', '校验新 Task 引用需要事务查询上下文');
    else collector.check((await context.getTask(payload.newTaskId)) !== undefined, 'event.payloadReference.missing', 'payload.newTaskId', '新 Task 不存在');
  }
  if (type === 'break.started' && typeof payload.sourceFocusSessionId === 'string') {
    const source = await getReferencedSession(payload.sourceFocusSessionId, 'payload.sourceFocusSessionId', context, collector);
    if (source) collector.check(source.type === 'focus' && source.status === 'completed', 'event.break.sourceFocus', 'payload.sourceFocusSessionId', '必须引用 completed focus');
  }
  if (type === 'dayPlan.workEnded' && typeof payload.endedAfterFocusSessionId === 'string') {
    const source = await getReferencedSession(payload.endedAfterFocusSessionId, 'payload.endedAfterFocusSessionId', context, collector);
    if (source) collector.check(source.type === 'focus' && source.status === 'completed', 'event.dayPlan.workEndedFocus', 'payload.endedAfterFocusSessionId', '必须引用 completed focus');
    if (event.sessionId !== null) collector.check(event.sessionId === payload.endedAfterFocusSessionId, 'event.dayPlan.workEndedSession', 'sessionId', '必须与 endedAfterFocusSessionId 一致');
  }
  if (type === 'focus.discarded' && typeof payload.triggeredByInterruptEventId === 'string') {
    const interrupt = await getReferencedEvent(payload.triggeredByInterruptEventId, 'payload.triggeredByInterruptEventId', context, collector);
    if (interrupt) {
      collector.check(interrupt.type === 'interrupt.internal' || interrupt.type === 'interrupt.external', 'event.focus.interruptType', 'payload.triggeredByInterruptEventId', '必须引用 interrupt 事件');
      collector.check(interrupt.sessionId === event.sessionId, 'event.focus.interruptSession', 'payload.triggeredByInterruptEventId', '必须引用同一 focus session 的 interrupt');
    }
  }
  if ((type === 'restItem.selected' || type === 'restItem.selectionChanged') && typeof payload.sourceShownEventId === 'string') {
    const shown = await getReferencedEvent(payload.sourceShownEventId, 'payload.sourceShownEventId', context, collector);
    if (shown) {
      collector.check(shown.type === 'restItem.shown', 'event.restItem.sourceType', 'payload.sourceShownEventId', '必须引用 restItem.shown');
      collector.check(shown.sessionId === event.sessionId, 'event.restItem.sourceSession', 'payload.sourceShownEventId', '必须引用同一 break session 的展示事件');
    }
  }
}

function checkSame(actual: unknown, expected: unknown, code: string, path: string, collector: ValidationCollector): void {
  collector.check(valuesEqual(actual, expected), code, path, '必须与事务内关联实体一致');
}

async function validateEntityConsistency(
  type: EventType,
  event: Record<string, unknown>,
  payload: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  const task = typeof event.taskId === 'string' ? await context?.getTask?.(event.taskId) : undefined;
  const session = typeof event.sessionId === 'string' ? await context?.getSession?.(event.sessionId) : undefined;
  const dayPlan = typeof event.dayPlanId === 'string' ? await context?.getDayPlan?.(event.dayPlanId) : undefined;
  const energy = typeof event.energyRecordId === 'string' ? await context?.getEnergyRecord?.(event.energyRecordId) : undefined;
  const interval = typeof event.unresolvedIntervalId === 'string' ? await context?.getUnresolvedInterval?.(event.unresolvedIntervalId) : undefined;
  const settings = typeof event.settingsId === 'string' ? await context?.getSettings?.(event.settingsId) : undefined;

  if (task) {
    if (type === 'task.created') {
      checkSame(task.title, payload.title, 'event.task.title', 'payload.title', collector);
      checkSame(task.parentId, payload.parentId, 'event.task.parentId', 'payload.parentId', collector);
      checkSame(task.estimatedPomodoros, payload.estimatedPomodoros, 'event.task.estimate', 'payload.estimatedPomodoros', collector);
      if (payload.source === 'triageCapture') {
        checkSame(task.status, 'active', 'event.triage.taskStatus', 'taskId', collector);
        checkSame(task.parentId, null, 'event.triage.parentId', 'taskId', collector);
        checkSame(task.estimatedPomodoros, 1, 'event.triage.estimate', 'taskId', collector);
        checkSame(task.metadata?.triageStatus, 'pending', 'event.triage.status', 'taskId', collector);
        checkSame(task.metadata?.source, 'triageCapture', 'event.triage.source', 'taskId', collector);
      }
      if (payload.source === 'splitChild') {
        checkSame(task.status, 'active', 'event.task.splitChild.status', 'taskId', collector);
        checkSame(task.metadata?.source, 'splitChild', 'event.task.splitChild.source', 'taskId', collector);
        collector.check(
          task.splitFromTaskId !== null && task.splitIndex >= 1,
          'event.task.splitChild.lineage',
          'taskId',
          'splitChild 必须关联来源并具有正 splitIndex',
        );
      }
    }
    if (type === 'task.split') {
      checkSame(task.status, 'archived', 'event.task.split.status', 'taskId', collector);
      checkSame(task.outcome, 'split', 'event.task.split.outcome', 'taskId', collector);
      checkSame(task.lineageId, payload.lineageId, 'event.task.split.lineage', 'payload.lineageId', collector);
      if (typeof payload.newTaskId === 'string' && context?.getTask) {
        const newTask = await context.getTask(payload.newTaskId);
        if (newTask) {
          checkSame(newTask.lineageId, payload.lineageId, 'event.task.split.newLineage', 'payload.newTaskId', collector);
          checkSame(newTask.splitFromTaskId, task.id, 'event.task.split.source', 'payload.newTaskId', collector);
          checkSame(newTask.status, 'active', 'event.task.split.newStatus', 'payload.newTaskId', collector);
        }
      }
    }
    if (type === 'focus.started') checkSame(task.estimatedPomodoros, payload.taskEstimateAtStart, 'event.focus.taskEstimateAtStart', 'payload.taskEstimateAtStart', collector);
    if (type === 'task.estimateAdjusted') checkSame(task.estimatedPomodoros, payload.newEstimate, 'event.task.estimate', 'payload.newEstimate', collector);
    if (type === 'task.updated' && typeof payload.field === 'string') {
      checkSame(
        task[payload.field as 'title' | 'note' | 'actualWorkNote' | 'metadata' | 'estimatedPomodoros'],
        payload.newValue,
        'event.task.updated.newValue',
        'payload.newValue',
        collector,
      );
    }
    if (type === 'task.completed') {
      checkSame(task.status, 'completed', 'event.task.status', 'taskId', collector);
      checkSame(task.completedAt, payload.completedAt, 'event.task.completedAt', 'payload.completedAt', collector);
      checkSame(task.completionSource, payload.completionSource, 'event.task.completionSource', 'payload.completionSource', collector);
    }
    if (type === 'task.archived') {
      checkSame(task.status, 'archived', 'event.task.status', 'taskId', collector);
      checkSame(task.outcome, payload.outcome, 'event.task.outcome', 'payload.outcome', collector);
    }
    if (type === 'task.deleted') {
      checkSame(task.status, 'deleted', 'event.task.status', 'taskId', collector);
      checkSame(task.deletedReason, payload.deletedReason ?? null, 'event.task.deletedReason', 'payload.deletedReason', collector);
    }
    if (type === 'task.restored' && payload.restoredFrom === 'archived') {
      collector.check(
        task.status === 'active' || task.status === 'completed',
        'event.task.restored.status',
        'taskId',
        '从 archived 恢复后必须为 active 或 completed',
      );
      checkSame(task.outcome, null, 'event.task.restored.outcome', 'taskId', collector);
      checkSame(task.archivedAt, null, 'event.task.restored.archivedAt', 'taskId', collector);
      checkSame(task.deletedAt, null, 'event.task.restored.deletedAt', 'taskId', collector);
      checkSame(task.deletedReason, null, 'event.task.restored.deletedReason', 'taskId', collector);
    }
    if (type === 'subtask.added') {
      checkSame(task.parentId, payload.parentId, 'event.task.parentId', 'payload.parentId', collector);
      checkSame(task.title, payload.title, 'event.task.title', 'payload.title', collector);
      checkSame(task.estimatedPomodoros, payload.estimatedPomodoros, 'event.task.estimate', 'payload.estimatedPomodoros', collector);
    }
    if (type === 'subtask.reordered') {
      checkSame(task.parentId, payload.parentId, 'event.task.parentId', 'payload.parentId', collector);
    }
    if (type === 'subtask.reparented' || type === 'task.reparented') checkSame(task.parentId, payload.toParentId, 'event.task.parentId', 'payload.toParentId', collector);
    if (type === 'subtask.unparented') checkSame(task.parentId, null, 'event.task.parentId', 'taskId', collector);
    if (type === 'triage.captured') {
      checkSame(task.title, payload.title, 'event.triage.title', 'payload.title', collector);
      checkSame(task.status, 'active', 'event.triage.taskStatus', 'taskId', collector);
      checkSame(task.parentId, null, 'event.triage.parentId', 'taskId', collector);
      checkSame(task.estimatedPomodoros, 1, 'event.triage.estimate', 'taskId', collector);
      checkSame(task.metadata?.triageStatus, 'pending', 'event.triage.status', 'taskId', collector);
    }
    if (type === 'triage.movedToToday' || type === 'triage.movedToList') {
      checkSame(task.status, 'active', 'event.triage.taskStatus', 'taskId', collector);
      checkSame(task.metadata?.triageStatus ?? null, null, 'event.triage.status', 'taskId', collector);
    }
    if (type === 'triage.dismissed') {
      checkSame(task.status, 'deleted', 'event.triage.dismissed.status', 'taskId', collector);
      checkSame(task.deletedReason, 'triageDismissed', 'event.triage.dismissed.reason', 'taskId', collector);
    }
  }

  if (dayPlan) {
    if (type === 'dayPlan.created') {
      checkSame(dayPlan.appDate, payload.appDate, 'event.dayPlan.appDate', 'payload.appDate', collector);
      checkSame(dayPlan.localDate, payload.localDate, 'event.dayPlan.localDate', 'payload.localDate', collector);
      checkSame(dayPlan.budgetMode, payload.budgetMode, 'event.dayPlan.budgetMode', 'payload.budgetMode', collector);
    }
    if (type === 'dayPlan.budgetAccepted') {
      checkSame(dayPlan.budgetPomodoros, payload.budgetPomodoros, 'event.dayPlan.budget', 'payload.budgetPomodoros', collector);
      checkSame(dayPlan.budgetMode, payload.budgetMode, 'event.dayPlan.budgetMode', 'payload.budgetMode', collector);
    }
    if (type === 'dayPlan.budgetModeChanged') checkSame(dayPlan.budgetMode, payload.newMode, 'event.dayPlan.budgetMode', 'payload.newMode', collector);
    if (type === 'dayPlan.workEnded' || type === 'task.movedToToday') checkSame(dayPlan.appDate, payload.appDate, 'event.dayPlan.appDate', 'payload.appDate', collector);
    if (type === 'task.movedToList') checkSame(dayPlan.appDate, payload.fromAppDate, 'event.dayPlan.appDate', 'payload.fromAppDate', collector);
    if (type === 'dayPlan.taskAdded' || type === 'triage.movedToToday' || type === 'task.movedToToday') {
      const index = payload.addedAtIndex;
      if (typeof index === 'number') checkSame(dayPlan.taskIds[index], event.taskId, 'event.dayPlan.taskIndex', 'payload.addedAtIndex', collector);
    }
    if (type === 'dayPlan.taskRemoved' || type === 'task.movedToList') {
      collector.check(!dayPlan.taskIds.includes(String(event.taskId)), 'event.dayPlan.taskRemoved', 'taskId', '移出后不得仍在 DayPlan.taskIds');
    }
    if (type === 'dayPlan.taskReordered' && typeof payload.toIndex === 'number') checkSame(dayPlan.taskIds[payload.toIndex], event.taskId, 'event.dayPlan.taskIndex', 'payload.toIndex', collector);
  }

  if (session) {
    const focusType = type === 'focus.started' || type === 'focus.completed' || type === 'focus.discarded';
    if (focusType) {
      checkSame(session.type, 'focus', 'event.session.type', 'sessionId', collector);
      checkSame(session.taskId, event.taskId, 'event.session.taskId', 'taskId', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
      checkSame(session.pomodoroIndex, payload.pomodoroIndex, 'event.session.pomodoroIndex', 'payload.pomodoroIndex', collector);
      if ('plannedDuration' in payload) checkSame(session.plannedDuration, payload.plannedDuration, 'event.session.plannedDuration', 'payload.plannedDuration', collector);
      if ('actualDuration' in payload) checkSame(session.actualDuration, payload.actualDuration, 'event.session.actualDuration', 'payload.actualDuration', collector);
      const expectedStatus = type === 'focus.started' ? 'active' : type === 'focus.completed' ? 'completed' : 'discarded';
      checkSame(session.status, expectedStatus, 'event.session.status', 'sessionId', collector);
    }
    const breakEvent = type === 'break.started' || type === 'break.completed' || type === 'break.skipped';
    if (breakEvent) {
      checkSame(session.type, payload.breakType, 'event.session.type', 'payload.breakType', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
      checkSame(session.plannedDuration, payload.plannedDuration, 'event.session.plannedDuration', 'payload.plannedDuration', collector);
      if (type === 'break.started') checkSame(session.sourceFocusSessionId, payload.sourceFocusSessionId, 'event.session.sourceFocus', 'payload.sourceFocusSessionId', collector);
      if (type === 'break.completed') {
        checkSame(session.status, 'completed', 'event.session.status', 'sessionId', collector);
        checkSame(session.actualDuration, payload.actualDuration, 'event.session.actualDuration', 'payload.actualDuration', collector);
        checkSame(session.actualRest, payload.actualRest, 'event.session.actualRest', 'payload.actualRest', collector);
      } else if (type === 'break.skipped') {
        checkSame(session.status, 'skipped', 'event.session.status', 'sessionId', collector);
        checkSame(session.skipKind, payload.skipKind, 'event.session.skipKind', 'payload.skipKind', collector);
      } else checkSame(session.status, 'active', 'event.session.status', 'sessionId', collector);
    }
    if (type === 'interrupt.internal' || type === 'interrupt.external') {
      checkSame(session.type, 'focus', 'event.session.type', 'sessionId', collector);
      checkSame(session.status, 'active', 'event.session.status', 'sessionId', collector);
      checkSame(session.taskId, event.taskId, 'event.session.taskId', 'taskId', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
    }
    if (type === 'triage.captured') {
      checkSame(session.type, 'focus', 'event.session.type', 'sessionId', collector);
      checkSame(session.status, 'active', 'event.session.status', 'sessionId', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
    }
    if (type === 'restItem.shown' || type === 'restItem.shuffled' || type === 'restItem.selected' || type === 'restItem.selectionChanged') {
      checkSame(session.type, payload.breakType, 'event.session.type', 'payload.breakType', collector);
      checkSame(session.status, 'active', 'event.session.status', 'sessionId', collector);
      if (type === 'restItem.selected') checkSame(session.actualRest, payload.selectedKey, 'event.session.actualRest', 'payload.selectedKey', collector);
      if (type === 'restItem.selectionChanged') checkSame(session.actualRest, payload.newKey, 'event.session.actualRest', 'payload.newKey', collector);
    }
    if (type === 'task.completed' && payload.completionSource === 'pomodoro') {
      checkSame(session.type, 'focus', 'event.taskCompletion.sessionType', 'sessionId', collector);
      checkSame(session.status, 'completed', 'event.taskCompletion.sessionStatus', 'sessionId', collector);
      checkSame(session.taskId, event.taskId, 'event.taskCompletion.taskId', 'taskId', collector);
    }
    if (type === 'energy.recorded' && typeof payload.source === 'string' && payload.source.startsWith('after')) {
      const expectedType: Record<string, string> = { afterFocus: 'focus', afterShortBreak: 'shortBreak', afterLongBreak: 'longBreak', afterExtraFocus: 'extraFocus', afterExtraRest: 'extraRest' };
      checkSame(session.type, expectedType[payload.source], 'event.energy.sessionType', 'sessionId', collector);
      checkSame(session.status, 'completed', 'event.energy.sessionStatus', 'sessionId', collector);
    }
    if ((type === 'prompt.shown' || type === 'prompt.dismissed') && payload.promptType === 'energyRecording' && typeof payload.promptContext === 'string' && payload.promptContext.startsWith('after')) {
      const expectedType: Record<string, string> = { afterFocus: 'focus', afterShortBreak: 'shortBreak', afterLongBreak: 'longBreak', afterExtraFocus: 'extraFocus', afterExtraRest: 'extraRest' };
      checkSame(session.type, expectedType[payload.promptContext], 'event.prompt.sessionType', 'sessionId', collector);
      checkSame(session.status, 'completed', 'event.prompt.sessionStatus', 'sessionId', collector);
    }
    if (type === 'interval.detected' && payload.detectedSessionType !== null) {
      checkSame(session.type, payload.detectedSessionType, 'event.session.type', 'payload.detectedSessionType', collector);
      checkSame(session.status, 'active', 'event.session.status', 'sessionId', collector);
      checkSame(session.taskId, event.taskId, 'event.session.taskId', 'taskId', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
    }
    if (type === 'interval.sessionResolved') {
      checkSame(session.type, payload.sessionType, 'event.session.type', 'payload.sessionType', collector);
      checkSame(session.status, payload.resolvedAs, 'event.session.status', 'payload.resolvedAs', collector);
      checkSame(session.taskId, event.taskId, 'event.session.taskId', 'taskId', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
    }
    if (type === 'interval.classified') {
      checkSame(session.type, payload.classificationType, 'event.session.type', 'payload.classificationType', collector);
      checkSame(session.status, 'completed', 'event.session.status', 'sessionId', collector);
      checkSame(session.originIntervalId, event.unresolvedIntervalId, 'event.session.originIntervalId', 'unresolvedIntervalId', collector);
      checkSame(session.taskId, event.taskId, 'event.session.taskId', 'taskId', collector);
      checkSame(session.dayPlanId, event.dayPlanId, 'event.session.dayPlanId', 'dayPlanId', collector);
    }
  }

  if (energy && type === 'energy.recorded') {
    for (const key of ['source', 'energyLevel', 'mood', 'note'] as const) checkSame(energy[key], payload[key], `event.energy.${key}`, `payload.${key}`, collector);
    checkSame(energy.sessionId, event.sessionId, 'event.energy.sessionId', 'sessionId', collector);
  }
  if (interval) {
    if (type === 'interval.detected') checkSame(interval.source, payload.source, 'event.interval.source', 'payload.source', collector);
    if (type === 'interval.ignored') {
      checkSame(interval.status, 'ignored', 'event.interval.status', 'unresolvedIntervalId', collector);
      checkSame(interval.ignoreReason, payload.ignoreReason, 'event.interval.ignoreReason', 'payload.ignoreReason', collector);
    }
  }

  if (settings) validateSettingsEventConsistency(type, event, payload, settings, context, collector);
}

async function validateSettingsEventConsistency(
  type: EventType,
  event: Record<string, unknown>,
  payload: Record<string, unknown>,
  settings: NonNullable<Awaited<ReturnType<NonNullable<ValidationContext['getSettings']>>>>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  if (type === 'settings.initialized') {
    for (const [key, expected] of [['focusMinutes', 25], ['shortBreakMinutes', 5], ['longBreakMinutes', 15], ['longBreakEvery', 4]] as const) {
      checkSame(payload[key], expected, `event.settings.${key}.default`, `payload.${key}`, collector);
      checkSame(settings[key], payload[key], `event.settings.${key}`, `payload.${key}`, collector);
    }
    checkSame(payload.restSuggestionsCount, settings.restSuggestions.length, 'event.settings.restCount', 'payload.restSuggestionsCount', collector);
    checkSame(payload.dailyTaskTemplatesCount, settings.dailyTaskTemplates.length, 'event.settings.templateCount', 'payload.dailyTaskTemplatesCount', collector);
    checkSame(payload.restSuggestionsCount, 28, 'event.settings.restCount.default', 'payload.restSuggestionsCount', collector);
    checkSame(payload.dailyTaskTemplatesCount, 1, 'event.settings.templateCount.default', 'payload.dailyTaskTemplatesCount', collector);
  }
  if (type === 'settings.timerUpdated' && typeof payload.field === 'string') checkSame(settings[payload.field as 'focusMinutes'], payload.newValue, 'event.settings.timerValue', 'payload.newValue', collector);
  if (type === 'settings.appDayStartOffsetUpdated') checkSame(settings.appDayStartOffsetMinutes, payload.newValue, 'event.settings.offset', 'payload.newValue', collector);
  if (type === 'settings.restSuggestionDisplayModeUpdated') checkSame(settings.restSuggestionDisplayMode, payload.newValue, 'event.settings.displayMode', 'payload.newValue', collector);
  if (type === 'statsBaseline.updated') checkSame(settings.lifetimePomodoroBaseline, payload.newValue, 'event.settings.baseline', 'payload.newValue', collector);

  const templates = new Map(settings.dailyTaskTemplates.map((item) => [item.templateKey, item]));
  if (type === 'settings.dailyTaskTemplateAdded') {
    const item = typeof payload.templateKey === 'string' ? templates.get(payload.templateKey) : undefined;
    collector.check(item !== undefined, 'event.settings.template.missing', 'payload.templateKey', '新增模板必须已存在于 Settings');
    if (item) for (const key of ['title', 'estimatedPomodoros', 'autoAddToDayPlan', 'sortPosition', 'sortIndex'] as const) checkSame(item[key], payload[key], `event.settings.template.${key}`, `payload.${key}`, collector);
  }
  if (type === 'settings.dailyTaskTemplateUpdated') {
    const item = typeof payload.templateKey === 'string' ? templates.get(payload.templateKey) : undefined;
    collector.check(item !== undefined, 'event.settings.template.missing', 'payload.templateKey', '被修改模板不存在');
    if (item && typeof payload.field === 'string') checkSame(item[payload.field as 'title'], payload.newValue, 'event.settings.template.newValue', 'payload.newValue', collector);
  }
  if (type === 'settings.dailyTaskTemplateRemoved') collector.check(!templates.has(String(payload.templateKey)), 'event.settings.template.retained', 'payload.templateKey', '已删除模板不得仍存在');
  if (type === 'settings.dailyTaskTemplateReordered' && Array.isArray(payload.orderedTemplateKeys)) {
    const ordered = [...settings.dailyTaskTemplates].sort((left, right) => left.sortIndex - right.sortIndex).map((item) => item.templateKey);
    checkSame(payload.orderedTemplateKeys, ordered, 'event.settings.template.order', 'payload.orderedTemplateKeys', collector);
  }

  const rest = new Map(settings.restSuggestions.map((item) => [item.key, item]));
  const restItem = typeof payload.key === 'string' ? rest.get(payload.key) : undefined;
  if (type === 'restItem.created' || type === 'restItem.updated' || type === 'restItem.disabled' || type === 'restItem.enabled') {
    collector.check(restItem !== undefined, 'event.restItem.key.missing', 'payload.key', '休息项不存在于 Settings');
  }
  if (type === 'restItem.created' && restItem) {
    for (const key of ['label', 'appliesTo', 'sortIndex'] as const) checkSame(restItem[key], payload[key], `event.restItem.${key}`, `payload.${key}`, collector);
  }
  if (type === 'restItem.updated' && restItem && isRecord(payload.changedFields)) {
    for (const [key, value] of Object.entries(payload.changedFields)) checkSame(restItem[key as 'label'], value, `event.restItem.changed.${key}`, `payload.changedFields.${key}`, collector);
  }
  if (type === 'restItem.disabled' && restItem) checkSame(restItem.isEnabled, false, 'event.restItem.disabled', 'payload.key', collector);
  if (type === 'restItem.enabled' && restItem) checkSame(restItem.isEnabled, true, 'event.restItem.enabled', 'payload.key', collector);
  if (type === 'restItem.deleted') collector.check(!rest.has(String(payload.key)), 'event.restItem.key.retained', 'payload.key', '已删除休息项不得仍存在');

  if (type === 'restItem.shown' && Array.isArray(payload.shownKeys)) {
    const eligible = settings.restSuggestions.filter((item) => item.isEnabled && item.appliesTo.includes(payload.breakType as 'shortBreak'));
    for (const key of payload.shownKeys) collector.check(typeof key === 'string' && eligible.some((item) => item.key === key), 'event.restItem.shownKey', 'payload.shownKeys', '展示 key 必须存在、启用且适用');
    checkSame(payload.eligibleCount, eligible.length, 'event.restItem.eligibleCount.exact', 'payload.eligibleCount', collector);
  }
  if ((type === 'restItem.selected' || type === 'restItem.selectionChanged')) {
    const key = type === 'restItem.selected' ? payload.selectedKey : payload.newKey;
    const item = typeof key === 'string' ? rest.get(key) : undefined;
    collector.check(item !== undefined && item.isEnabled && item.appliesTo.includes(payload.breakType as 'shortBreak'), 'event.restItem.selectedKey', type === 'restItem.selected' ? 'payload.selectedKey' : 'payload.newKey', '选择 key 必须存在、启用且适用');
    if (type === 'restItem.selectionChanged') {
      const previous = typeof payload.previousKey === 'string' ? rest.get(payload.previousKey) : undefined;
      collector.check(previous !== undefined, 'event.restItem.previousKey', 'payload.previousKey', 'previousKey 必须存在于 Settings');
    }
    if (typeof payload.sourceShownEventId === 'string' && context?.getEvent) {
      const shown = await context.getEvent(payload.sourceShownEventId);
      if (shown?.type === 'restItem.shown') {
        const index = shown.payload.shownKeys.indexOf(String(key));
        const payloadIndex = type === 'restItem.selected' ? payload.selectedIndex : payload.newIndex;
        checkSame(payloadIndex, index, 'event.restItem.selectedIndex', type === 'restItem.selected' ? 'payload.selectedIndex' : 'payload.newIndex', collector);
      }
    }
  }
  if (type === 'restItem.reordered' && Array.isArray(payload.orderedKeys)) {
    const ordered = settings.restSuggestions.filter((item) => item.isEnabled && item.appliesTo.includes(payload.breakType as 'shortBreak')).sort((left, right) => left.sortIndex - right.sortIndex).map((item) => item.key);
    checkSame(payload.orderedKeys, ordered, 'event.restItem.order', 'payload.orderedKeys', collector);
  }
}

async function validateAssociations(type: EventType, event: Record<string, unknown>, payload: Record<string, unknown> | undefined, context: ValidationContext | undefined, collector: ValidationCollector): Promise<void> {
  const associationSchema = EVENT_ASSOCIATION_SCHEMAS[type];
  const required = new Set(associationSchema.required);
  const allowed = new Set([...associationSchema.required, ...(associationSchema.optional ?? [])]);
  for (const key of ['taskId', 'sessionId', 'dayPlanId', 'energyRecordId', 'unresolvedIntervalId', 'settingsId'] as const) {
    const value = event[key];
    const valid = validateUuidV7(value, key, collector, true);
    if (required.has(key)) collector.check(value !== null, 'event.association.required', key, `${type} 必须填写 ${key}`);
    if (!allowed.has(key)) collector.check(value === null, 'event.association.forbidden', key, `${type} 不允许填写 ${key}`);
    if (valid && typeof value === 'string') await validateTopReference(key, value, context, collector);
  }

  if (!payload) return;
  if (type === 'task.created') {
    const source = payload.source;
    collector.check((source === 'systemDailyTemplate') === (event.dayPlanId !== null), 'event.association.dayPlanBySource', 'dayPlanId', '仅 systemDailyTemplate 必须填写 dayPlanId');
    collector.check((source === 'unresolvedIntervalClassification') === (event.unresolvedIntervalId !== null), 'event.association.intervalBySource', 'unresolvedIntervalId', '仅 unresolvedIntervalClassification 必须填写 unresolvedIntervalId');
  }
  if (type === 'task.completed' && payload.completionSource === 'pomodoro') {
    collector.check(event.sessionId !== null, 'event.association.completionSession', 'sessionId', 'pomodoro 完成必须填写 sessionId');
  }
  if (type === 'dayPlan.created' || type === 'dayPlan.workEnded') {
    collector.check(payload.localDate === event.localDate, 'event.payload.localDate', 'payload.localDate', '必须与 Event.localDate 一致');
  }
  if (type === 'subtask.added') collector.check((payload.source === 'timerPage') === (event.sessionId !== null), 'event.association.sessionBySource', 'sessionId', '仅 timerPage 必须填写 sessionId');
  if (type === 'dayPlan.taskAdded') collector.check((payload.source === 'unresolvedIntervalClassification') === (event.unresolvedIntervalId !== null), 'event.association.intervalBySource', 'unresolvedIntervalId', '归类来源必须填写 unresolvedIntervalId');
  if (type === 'energy.recorded') {
    const after = new Set(['afterFocus', 'afterShortBreak', 'afterLongBreak', 'afterExtraFocus', 'afterExtraRest']);
    collector.check(after.has(String(payload.source)) === (event.sessionId !== null), 'event.association.energySession', 'sessionId', 'after* 来源必须且仅能填写 sessionId');
  }
  if (type === 'interval.classified') collector.check((payload.classificationType === 'extraFocus') === (event.taskId !== null), 'event.association.classifiedTask', 'taskId', 'extraFocus 必须且仅能填写 taskId');
  if (type === 'interval.detected') collector.check((payload.detectedSessionType !== null) === (event.sessionId !== null), 'event.association.detectedSession', 'sessionId', 'detectedSessionType 与 sessionId 必须同时存在或同时为空');
  if (type === 'interval.detected' && payload.detectedSessionType === null) {
    collector.check(event.taskId === null, 'event.association.detectedTask', 'taskId', '无 active Session 时必须为 null');
    collector.check(event.dayPlanId === null, 'event.association.detectedDayPlan', 'dayPlanId', '无 active Session 时必须为 null');
  }
  if (type === 'notification.shown') {
    collector.check(payload.notificationType !== 'focusCompleted' || event.taskId !== null, 'event.association.notificationTask', 'taskId', 'focusCompleted 必须填写 taskId');
    collector.check(payload.notificationType === 'focusCompleted' || event.taskId === null, 'event.association.notificationTask', 'taskId', 'breakCompleted 不填写 taskId');
  }
  if (type === 'prompt.shown' || type === 'prompt.dismissed') {
    const prompt = payload.promptType;
    collector.check((prompt === 'taskCompletionCheck' || prompt === 'taskSplitSuggestion') === (event.taskId !== null), 'event.association.promptTask', 'taskId', 'promptType 与 taskId 不匹配');
    if (prompt === 'taskCompletionCheck') collector.check(event.sessionId !== null, 'event.association.promptSession', 'sessionId', 'taskCompletionCheck 必须填写 sessionId');
    if (prompt === 'taskSplitSuggestion') collector.check(event.sessionId === null, 'event.association.promptSession', 'sessionId', 'taskSplitSuggestion 不填写 sessionId');
    if (prompt === 'energyRecording') {
      const afterContext = typeof payload.promptContext === 'string' && payload.promptContext.startsWith('after');
      collector.check(afterContext === (event.sessionId !== null), 'event.association.energyPromptSession', 'sessionId', 'after* energy prompt 必须且仅能填写 sessionId');
    }
  }
  await validatePayloadReferences(type, event, payload, context, collector);
  await validateEntityConsistency(type, event, payload, context, collector);
}

export async function collectEventValidationIssues(value: unknown, context?: ValidationContext): Promise<readonly import('./primitives').ValidationIssue[]> {
  const collector = new ValidationCollector();
  const event = requireRecord(value, 'Event', collector);
  if (!event) return collector.issues;
  validateExactKeys(event, EVENT_ENTITY_KEYS, 'Event', collector);
  validateUuidV7(event.id, 'id', collector);
  validateIsoDateTime(event.createdAt, 'createdAt', collector);
  collector.check(event.schemaVersion === CURRENT_SCHEMA_VERSION, 'schemaVersion.current', 'schemaVersion', `必须为 ${CURRENT_SCHEMA_VERSION}`);
  validateStoredLocalDate(event.localDate, event.occurredAt, event.timezone, collector);
  validateUuidV7(event.correlationId, 'correlationId', collector, true);

  if (!isEventType(event.type)) {
    collector.add('event.type.unknown', 'type', '必须为 v4 §7 定义的事件类型');
    return collector.issues;
  }
  const payload = validatePayload(event.type, event.payload, collector);
  await validateAssociations(event.type, event, payload, context, collector);
  return collector.issues;
}

export async function validateEvent(value: unknown, context?: ValidationContext): Promise<Event> {
  const issues = await collectEventValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('Event', issues);
  return value as Event;
}
