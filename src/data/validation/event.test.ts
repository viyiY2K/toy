import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, type EventPayloadMap, type EventType } from '../events';
import { newId } from '../id';
import { makeEvent, type Event } from '../schema';
import type { ValidationContext } from './context';
import {
  EVENT_ASSOCIATION_SCHEMAS,
  EVENT_PAYLOAD_SCHEMAS,
  collectEventValidationIssues,
  validateEvent,
} from './event';

const NOW = '2026-06-05T14:37:12+08:00';
const TZ = 'Asia/Shanghai';
const ID = newId();
const ID_2 = newId();

const VALID_PAYLOADS = {
  'task.created': { title: 'Task', parentId: null, estimatedPomodoros: 1, source: 'manual' },
  'task.updated': { field: 'title', oldValue: 'Old', newValue: 'New' },
  'task.estimateAdjusted': { round: 2, oldEstimate: 1, newEstimate: 2 },
  'task.completed': { completionSource: 'manual', completedAt: NOW, validFocusCountAtCompletion: 0 },
  'task.uncompleted': { previousCompletedAt: NOW, previousCompletionSource: 'manual' },
  'task.split': { lineageId: ID, newTaskId: ID_2 },
  'task.archived': { outcome: 'completed' },
  'task.deleted': {},
  'task.restored': { restoredFrom: 'deleted' },
  'subtask.added': { parentId: ID, title: 'Child', estimatedPomodoros: 1, source: 'listPage' },
  'subtask.reordered': { parentId: ID, fromIndex: 0, toIndex: 1 },
  'subtask.reparented': { fromParentId: ID, toParentId: ID_2 },
  'subtask.unparented': { previousParentId: ID },
  'dayPlan.created': { appDate: '2026-06-05', localDate: '2026-06-05', budgetMode: 'conservative' },
  'dayPlan.updated': { field: 'estimate', oldValue: 1, newValue: 2 },
  'dayPlan.budgetEstimated': { budgetMode: 'conservative', conservativePomodoros: 4, optimisticPomodoros: 6, workWindowMin: 300 },
  'dayPlan.budgetAccepted': { budgetPomodoros: 4, budgetMode: 'conservative' },
  'dayPlan.budgetModeChanged': { oldMode: 'conservative', newMode: 'manual' },
  'dayPlan.deductionAdded': { deductionType: 'fixed', deductionId: ID, label: 'Meeting', hours: 0.5 },
  'dayPlan.deductionUpdated': { deductionType: 'life', deductionId: ID, label: 'Lunch', oldHours: 1, newHours: 0.5 },
  'dayPlan.deductionRemoved': { deductionType: 'fixed', deductionId: ID, label: 'Meeting', hours: 0.5 },
  'dayPlan.taskAdded': { addedAtIndex: 0, source: 'systemDailyTemplate' },
  'dayPlan.taskRemoved': { reason: 'userRemoved' },
  'dayPlan.taskReordered': { fromIndex: 0, toIndex: 1 },
  'dayPlan.workEnded': { appDate: '2026-06-05', localDate: '2026-06-05', endedAfterFocusSessionId: null, reason: 'userEndedWork' },
  'task.reordered': { fromIndex: 0, toIndex: 1 },
  'task.reparented': { fromParentId: null, toParentId: ID, toIndex: 0 },
  'task.movedToToday': { appDate: '2026-06-05', addedAtIndex: 0 },
  'task.movedToList': { fromAppDate: '2026-06-05' },
  'focus.started': { pomodoroIndex: 1, plannedDuration: 1500, taskEstimateAtStart: 1 },
  'focus.completed': { pomodoroIndex: 1, plannedDuration: 1500, actualDuration: 1500 },
  'focus.discarded': { pomodoroIndex: 1, actualDuration: 60, reason: 'userInitiated', triggeredByInterruptEventId: null },
  'break.started': { breakType: 'shortBreak', plannedDuration: 300, sourceFocusSessionId: ID_2 },
  'break.completed': { breakType: 'shortBreak', plannedDuration: 300, actualDuration: 300, actualRest: null },
  'break.skipped': { breakType: 'shortBreak', skipKind: 'explicitSkip', plannedDuration: 300 },
  'restItem.shown': { breakType: 'shortBreak', shownKeys: ['short_breathe'], eligibleCount: 1 },
  'restItem.shuffled': { breakType: 'shortBreak', shuffleCount: 1 },
  'restItem.selected': { breakType: 'shortBreak', selectedKey: 'short_breathe', selectedIndex: 0, sourceShownEventId: null },
  'restItem.selectionChanged': { breakType: 'shortBreak', previousKey: 'short_breathe', newKey: 'short_gaze', newIndex: 1, sourceShownEventId: null },
  'restItem.created': { key: `short_custom_${ID}`, label: 'Jump', appliesTo: ['shortBreak'], sortIndex: 0 },
  'restItem.updated': { key: 'short_breathe', changedFields: { label: 'Breathe' } },
  'restItem.disabled': { key: 'short_breathe' },
  'restItem.enabled': { key: 'short_breathe' },
  'restItem.deleted': { key: `short_custom_${ID}`, label: 'Jump' },
  'restItem.reordered': { breakType: 'shortBreak', orderedKeys: ['short_breathe'] },
  'interrupt.internal': { offsetSeconds: 10, note: null },
  'interrupt.external': { offsetSeconds: 20, note: 'Call' },
  'energy.recorded': { source: 'manual', energyLevel: 5, mood: null, note: null },
  'triage.captured': { title: 'Reply' },
  'triage.movedToToday': { addedAtIndex: 0 },
  'triage.movedToList': {},
  'triage.dismissed': { dismissReason: null },
  'interval.detected': { source: 'appReopened', detectedSessionType: null },
  'interval.sessionResolved': { sessionType: 'focus', resolvedAs: 'completed' },
  'interval.classified': { classificationType: 'extraRest' },
  'interval.ignored': { ignoreReason: null },
  'settings.initialized': { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, restSuggestionsCount: 28, dailyTaskTemplatesCount: 1 },
  'settings.timerUpdated': { field: 'focusMinutes', oldValue: 25, newValue: 30 },
  'settings.appDayStartOffsetUpdated': { oldValue: 0, newValue: 240, changedBy: 'user' },
  'settings.dailyTaskTemplateAdded': { templateKey: `custom_${ID}`, title: 'Report', estimatedPomodoros: 1, autoAddToDayPlan: true, sortPosition: 'last', sortIndex: 1 },
  'settings.dailyTaskTemplateUpdated': { templateKey: `custom_${ID}`, field: 'title', oldValue: 'Report', newValue: 'Daily report' },
  'settings.dailyTaskTemplateRemoved': { templateKey: `custom_${ID}`, title: 'Report', wasAutoAddEnabled: true },
  'settings.dailyTaskTemplateReordered': { orderedTemplateKeys: ['planningPreparation', `custom_${ID}`] },
  'settings.restSuggestionDisplayModeUpdated': { field: 'restSuggestionDisplayMode', oldValue: 'customOrder', newValue: 'usageFrequency', changedBy: 'user' },
  'statsBaseline.updated': { oldValue: 0, newValue: 100 },
  'data.migrationCompleted': { fromSchemaVersion: '1', toSchemaVersion: '2', durationMs: 10 },
  'data.migrationFailed': { fromSchemaVersion: '1', toSchemaVersion: '2', errorCode: null, errorMessage: null },
  'data.exported': { format: 'json', schemaVersion: '1', totalRecords: 10 },
  'data.imported': { format: 'json', sourceSchemaVersion: '1', totalRecords: 10 },
  'data.cleared': { scope: 'allLocalData' },
  'demo.loaded': { demoVersion: null, recordCount: 10 },
  'demo.cleared': { recordCount: 10 },
  'notification.shown': { notificationType: 'breakCompleted' },
  'prompt.shown': { promptType: 'energyRecording', promptContext: 'dayStart' },
  'prompt.dismissed': { promptType: 'energyRecording', promptContext: 'onReturn' },
  'error.dataWriteFailed': { errorCode: 'ERR_WRITE_FAILED', errorMessage: null, context: {} },
  'error.unexpectedState': { errorCode: 'ERR_UNEXPECTED_STATE', errorMessage: null, context: {} },
  'diagnosticLog.exported': { format: 'json', rangeDays: 30, includedEventTypes: ['error.dataWriteFailed', 'error.unexpectedState'], exportedEventCount: 2 },
} satisfies { [T in EventType]: EventPayloadMap[T] };

function validEvent<T extends EventType>(type: T, payload: EventPayloadMap[T]): Event {
  const base = makeEvent({ now: NOW, timezone: TZ, type: 'triage.movedToList' });
  const associations = EVENT_ASSOCIATION_SCHEMAS[type];
  const event = { ...base, type, payload } as unknown as Record<string, unknown>;
  for (const key of associations.required) event[key] = ID;
  for (const key of associations.optional ?? []) event[key] = null;
  if (type === 'prompt.shown' || type === 'prompt.dismissed') {
    const prompt = payload as EventPayloadMap['prompt.shown'];
    if (prompt.promptType === 'taskCompletionCheck') {
      event.taskId = ID;
      event.sessionId = ID;
    } else if (prompt.promptType === 'taskSplitSuggestion') event.taskId = ID;
  }
  return event as unknown as Event;
}

function contextFor(event: Event): ValidationContext {
  const payload = typeof event.payload === 'object' && event.payload !== null
    ? event.payload as Record<string, unknown>
    : {};
  const task: Record<string, unknown> = {
    id: event.taskId,
    title: payload.title ?? 'Task',
    parentId: payload.parentId ?? (event.type === 'subtask.unparented' ? null : null),
    estimatedPomodoros: payload.estimatedPomodoros ?? payload.newEstimate ?? 1,
    status: event.type === 'task.completed' ? 'completed' : event.type === 'task.archived' ? 'archived' : event.type === 'task.deleted' ? 'deleted' : 'active',
    completedAt: event.type === 'task.completed' ? payload.completedAt : null,
    completionSource: event.type === 'task.completed' ? payload.completionSource : null,
    outcome: event.type === 'task.archived' ? payload.outcome : null,
    deletedReason: event.type === 'task.deleted' ? payload.deletedReason ?? null : null,
    metadata: {},
    lineageId: event.taskId,
    splitFromTaskId: null,
    splitIndex: 0,
  };
  if (event.type === 'task.split') {
    task.status = 'archived';
    task.outcome = 'split';
    task.lineageId = payload.lineageId;
  }
  if (event.type === 'triage.captured') {
    task.metadata = { source: 'triageCapture', triageStatus: 'pending' };
  }
  if (event.type === 'triage.movedToToday' || event.type === 'triage.movedToList') {
    task.metadata = { source: 'triageCapture', triageStatus: null };
  }
  if (event.type === 'triage.dismissed') {
    task.status = 'deleted';
    task.deletedReason = 'triageDismissed';
    task.metadata = { source: 'triageCapture', triageStatus: 'pending' };
  }
  if (event.type === 'subtask.reparented' || event.type === 'task.reparented') task.parentId = payload.toParentId;
  if (event.type === 'task.updated' && typeof payload.field === 'string') {
    task[payload.field] = payload.newValue;
  }

  const appDate = payload.appDate ?? payload.fromAppDate ?? '2026-06-05';
  const taskIds: unknown[] = [];
  const index = event.type === 'dayPlan.taskReordered' ? payload.toIndex : payload.addedAtIndex;
  if (['dayPlan.taskAdded', 'dayPlan.taskReordered', 'task.movedToToday', 'triage.movedToToday'].includes(event.type) && typeof index === 'number') taskIds[index] = event.taskId;
  const dayPlan = {
    id: event.dayPlanId,
    appDate,
    localDate: payload.localDate ?? '2026-06-05',
    budgetMode: payload.newMode ?? payload.budgetMode ?? 'conservative',
    budgetPomodoros: payload.budgetPomodoros ?? 0,
    taskIds,
  };

  let session: Record<string, unknown> = { id: event.sessionId };
  if (event.type.startsWith('focus.')) {
    session = {
      id: event.sessionId,
      type: 'focus',
      status: event.type === 'focus.started' ? 'active' : event.type === 'focus.completed' ? 'completed' : 'discarded',
      taskId: event.taskId,
      dayPlanId: event.dayPlanId,
      pomodoroIndex: payload.pomodoroIndex,
      plannedDuration: payload.plannedDuration ?? 1500,
      actualDuration: payload.actualDuration ?? null,
    };
  } else if (event.type.startsWith('break.')) {
    session = {
      id: event.sessionId,
      type: payload.breakType,
      status: event.type === 'break.started' ? 'active' : event.type === 'break.completed' ? 'completed' : 'skipped',
      taskId: null,
      dayPlanId: event.dayPlanId,
      plannedDuration: payload.plannedDuration,
      actualDuration: payload.actualDuration ?? (event.type === 'break.skipped' ? 0 : null),
      actualRest: payload.actualRest ?? null,
      skipKind: payload.skipKind ?? null,
      sourceFocusSessionId: payload.sourceFocusSessionId ?? ID_2,
    };
  } else if (event.type.startsWith('interrupt.')) {
    session = { id: event.sessionId, type: 'focus', status: 'active', taskId: event.taskId, dayPlanId: event.dayPlanId };
  } else if (event.type === 'triage.captured') {
    session = { id: event.sessionId, type: 'focus', status: 'active', taskId: ID_2, dayPlanId: event.dayPlanId };
  } else if (event.type === 'restItem.shown' || event.type === 'restItem.shuffled' || event.type === 'restItem.selected' || event.type === 'restItem.selectionChanged') {
    session = { id: event.sessionId, type: payload.breakType, status: 'active', taskId: null, dayPlanId: null, actualRest: event.type === 'restItem.selected' ? payload.selectedKey : event.type === 'restItem.selectionChanged' ? payload.newKey : null };
  } else if (event.type === 'task.completed' && payload.completionSource === 'pomodoro') {
    session = { id: event.sessionId, type: 'focus', status: 'completed', taskId: event.taskId, dayPlanId: event.dayPlanId };
  } else if (event.type === 'energy.recorded' && typeof payload.source === 'string' && payload.source.startsWith('after')) {
    const types: Record<string, string> = { afterFocus: 'focus', afterShortBreak: 'shortBreak', afterLongBreak: 'longBreak', afterExtraFocus: 'extraFocus', afterExtraRest: 'extraRest' };
    session = { id: event.sessionId, type: types[payload.source], status: 'completed' };
  } else if ((event.type === 'prompt.shown' || event.type === 'prompt.dismissed') && payload.promptType === 'energyRecording' && typeof payload.promptContext === 'string' && payload.promptContext.startsWith('after')) {
    const types: Record<string, string> = { afterFocus: 'focus', afterShortBreak: 'shortBreak', afterLongBreak: 'longBreak', afterExtraFocus: 'extraFocus', afterExtraRest: 'extraRest' };
    session = { id: event.sessionId, type: types[payload.promptContext], status: 'completed' };
  } else if (event.type === 'interval.detected' && payload.detectedSessionType !== null) {
    session = { id: event.sessionId, type: payload.detectedSessionType, status: 'active', taskId: event.taskId, dayPlanId: event.dayPlanId };
  } else if (event.type === 'interval.sessionResolved') {
    session = { id: event.sessionId, type: payload.sessionType, status: payload.resolvedAs, taskId: event.taskId, dayPlanId: event.dayPlanId };
  } else if (event.type === 'interval.classified') {
    session = { id: event.sessionId, type: payload.classificationType, status: 'completed', originIntervalId: event.unresolvedIntervalId, taskId: event.taskId, dayPlanId: event.dayPlanId };
  }

  const energy = { id: event.energyRecordId, source: payload.source, energyLevel: payload.energyLevel, mood: payload.mood, note: payload.note, sessionId: event.sessionId };
  const interval = { id: event.unresolvedIntervalId, source: payload.source, status: event.type === 'interval.ignored' ? 'ignored' : 'pending', ignoreReason: payload.ignoreReason ?? null };

  const restSuggestions: Array<Record<string, unknown>> = [];
  const addRest = (key: unknown, breakType: unknown, overrides: Record<string, unknown> = {}) => {
    if (typeof key === 'string' && !restSuggestions.some((item) => item.key === key)) restSuggestions.push({ key, label: 'Rest', appliesTo: [breakType], isBuiltIn: !key.includes('_custom_'), isEnabled: true, sortIndex: (restSuggestions.length + 1) * 1000, icon: null, ...overrides });
  };
  if (event.type === 'restItem.shown' && Array.isArray(payload.shownKeys)) payload.shownKeys.forEach((key) => addRest(key, payload.breakType));
  if (event.type === 'restItem.selected') addRest(payload.selectedKey, payload.breakType);
  if (event.type === 'restItem.selectionChanged') {
    addRest(payload.previousKey, payload.breakType);
    addRest(payload.newKey, payload.breakType);
  }
  if (event.type === 'restItem.created') addRest(payload.key, Array.isArray(payload.appliesTo) ? payload.appliesTo[0] : undefined, { label: payload.label, appliesTo: payload.appliesTo, sortIndex: payload.sortIndex, isBuiltIn: false });
  if (event.type === 'restItem.updated') addRest(payload.key, 'shortBreak', payload.changedFields as Record<string, unknown>);
  if (event.type === 'restItem.disabled') addRest(payload.key, 'shortBreak', { isEnabled: false });
  if (event.type === 'restItem.enabled') addRest(payload.key, 'shortBreak', { isEnabled: true });
  if (event.type === 'restItem.reordered' && Array.isArray(payload.orderedKeys)) payload.orderedKeys.forEach((key) => addRest(key, payload.breakType));

  let dailyTaskTemplates: Array<Record<string, unknown>> = [];
  if (event.type === 'settings.initialized') dailyTaskTemplates = [{ templateKey: 'planningPreparation', sortIndex: 0 }];
  if (event.type === 'settings.dailyTaskTemplateAdded') dailyTaskTemplates = [{ ...payload, isBuiltIn: false }];
  if (event.type === 'settings.dailyTaskTemplateUpdated') dailyTaskTemplates = [{ templateKey: payload.templateKey, sortIndex: 0, [String(payload.field)]: payload.newValue }];
  if (event.type === 'settings.dailyTaskTemplateReordered' && Array.isArray(payload.orderedTemplateKeys)) dailyTaskTemplates = payload.orderedTemplateKeys.map((templateKey, sortIndex) => ({ templateKey, sortIndex }));
  const settings = {
    id: event.settingsId,
    focusMinutes: event.type === 'settings.timerUpdated' && payload.field === 'focusMinutes' ? payload.newValue : 25,
    shortBreakMinutes: event.type === 'settings.timerUpdated' && payload.field === 'shortBreakMinutes' ? payload.newValue : 5,
    longBreakMinutes: event.type === 'settings.timerUpdated' && payload.field === 'longBreakMinutes' ? payload.newValue : 15,
    longBreakEvery: 4,
    appDayStartOffsetMinutes: payload.newValue ?? 0,
    lifetimePomodoroBaseline: event.type === 'statsBaseline.updated' ? payload.newValue : 0,
    restSuggestionDisplayMode: event.type === 'settings.restSuggestionDisplayModeUpdated' ? payload.newValue : 'customOrder',
    restSuggestions: event.type === 'settings.initialized' ? Array.from({ length: 28 }, (_, index) => ({ key: `rest_${index}` })) : restSuggestions,
    dailyTaskTemplates,
  };

  return {
    getTask: async (id) => (event.type === 'task.split' && id === payload.newTaskId
      ? ({
          id,
          status: 'active',
          lineageId: payload.lineageId,
          splitFromTaskId: event.taskId,
          splitIndex: 1,
          metadata: { source: 'splitChild' },
        } as never)
      : (task as never)),
    getSession: async (id) => (event.type === 'break.started' && id === payload.sourceFocusSessionId ? ({ id, type: 'focus', status: 'completed' } as never) : (session as never)),
    getDayPlan: async () => dayPlan as never,
    getEnergyRecord: async () => energy as never,
    getUnresolvedInterval: async () => interval as never,
    getSettings: async () => settings as never,
    getEvent: async () => undefined,
  };
}

async function codes(value: unknown, ctx?: ValidationContext): Promise<string[]> {
  const resolvedContext = ctx ?? (typeof value === 'object' && value !== null && 'type' in value ? contextFor(value as Event) : undefined);
  return (await collectEventValidationIssues(value, resolvedContext)).map((issue) => issue.code);
}

describe('validateEvent (S7b, v4 §3.4/§7)', () => {
  it('accepts budget estimates produced by the exact v4 formula without an invented ordering rule', async () => {
    const event = validEvent('dayPlan.budgetEstimated', {
      budgetMode: 'conservative',
      conservativePomodoros: 8,
      optimisticPomodoros: 7,
      workWindowMin: 250,
    });
    await expect(validateEvent(event, contextFor(event))).resolves.toEqual(event);
  });

  it('runtime schema/association tables exactly cover the canonical 78 event types', () => {
    expect(Object.keys(EVENT_PAYLOAD_SCHEMAS)).toEqual([...EVENT_TYPES]);
    expect(Object.keys(EVENT_ASSOCIATION_SCHEMAS)).toEqual([...EVENT_TYPES]);
  });

  it('accepts one complete payload and legal top-level association shape for every event', async () => {
    for (const type of EVENT_TYPES) {
      const event = validEvent(type, VALID_PAYLOADS[type] as never);
      await expect(validateEvent(event, contextFor(event)), type).resolves.toBe(event);
    }
  });

  it('rejects a missing required field, an extra field, and an invalid first scalar for every non-empty payload schema', async () => {
    for (const type of EVENT_TYPES) {
      const event = validEvent(type, VALID_PAYLOADS[type] as never) as unknown as { payload: Record<string, unknown> };
      const requiredKeys = Object.keys(EVENT_PAYLOAD_SCHEMAS[type].required);
      if (requiredKeys.length > 0) {
        const key = requiredKeys[0]!;
        const missing = { ...event, payload: { ...event.payload } };
        delete missing.payload[key];
        expect(await codes(missing), `${type} missing ${key}`).toContain('field.missing');
        const invalid = { ...event, payload: { ...event.payload, [key]: Symbol('invalid') } };
        expect((await codes(invalid)).length, `${type} invalid ${key}`).toBeGreaterThan(0);
      }
      const extra = { ...event, payload: { ...event.payload, notInV4: true } };
      expect(await codes(extra), `${type} extra`).toContain('field.extra');
    }
  });

  it('rejects unknown types, malformed payload containers, and malformed Event top-level shape', async () => {
    const event = validEvent('triage.movedToList', {});
    expect(await codes({ ...event, type: 'focus.paused' })).toContain('event.type.unknown');
    expect(await codes({ ...event, payload: null })).toContain('type.object');
    expect(await codes({ ...event, unexpected: true })).toContain('field.extra');
    expect(await codes({ ...event, localDate: '2026-06-04' })).toContain('localDate.derived');
    expect(await codes({ ...event, correlationId: 'not-a-uuid' })).toContain('id.uuidV7');
    const inherited = Object.create(event) as Event;
    expect(await codes(inherited, contextFor(event))).toContain('field.missing');
  });

  it('enforces required/forbidden associations, transaction-visible references, and conditional source rules', async () => {
    const moved = validEvent('task.movedToToday', VALID_PAYLOADS['task.movedToToday']);
    expect(await codes({ ...moved, taskId: null })).toContain('event.association.required');
    expect(await codes({ ...moved, settingsId: ID })).toContain('event.association.forbidden');
    expect((await collectEventValidationIssues(moved)).map((issue) => issue.code)).toContain('validation.context.required');
    expect(await codes(moved, { ...contextFor(moved), getTask: async () => undefined })).toContain('event.association.missing');

    const created = validEvent('task.created', VALID_PAYLOADS['task.created']);
    expect(await codes({ ...created, dayPlanId: ID })).toContain('event.association.dayPlanBySource');
    const energy = validEvent('energy.recorded', { ...VALID_PAYLOADS['energy.recorded'], source: 'afterFocus' });
    expect(await codes(energy)).toContain('event.association.energySession');
    const classified = validEvent('interval.classified', { classificationType: 'extraFocus' });
    expect(await codes(classified)).toContain('event.association.classifiedTask');
  });

  it('enforces payload cross-field rules and strict nested object schemas', async () => {
    expect(await codes({ ...validEvent('prompt.shown', VALID_PAYLOADS['prompt.shown']), payload: { promptType: 'energyRecording', promptContext: null } })).toContain('event.prompt.context.required');
    expect(await codes({ ...validEvent('interval.sessionResolved', VALID_PAYLOADS['interval.sessionResolved']), payload: { sessionType: 'focus', resolvedAs: 'skipped' } })).toContain('event.interval.resolutionPair');
    expect(await codes({ ...validEvent('restItem.updated', VALID_PAYLOADS['restItem.updated']), payload: { key: 'short_breathe', changedFields: {} } })).toContain('event.restItem.changedFields.nonEmpty');
    expect(await codes({ ...validEvent('restItem.shown', VALID_PAYLOADS['restItem.shown']), payload: { breakType: 'shortBreak', shownKeys: ['a', 'b'], eligibleCount: 1 } })).toContain('event.restItem.eligibleCount');
    expect(await codes({ ...validEvent('statsBaseline.updated', VALID_PAYLOADS['statsBaseline.updated']), payload: { oldValue: 1, newValue: 1 } })).toContain('event.payload.noChange');
    expect(await codes({ ...validEvent('task.deleted', {}), payload: { deletedReason: 'invalid' } })).toContain('value.enum');
    const deleted = { ...validEvent('task.deleted', {}), payload: { deletedReason: 'userDeleted' } } as Event;
    await expect(validateEvent(deleted, contextFor(deleted))).resolves.toBeDefined();
  });

  it('validates payload references against transaction-visible Session/Event records', async () => {
    const started = validEvent('break.started', VALID_PAYLOADS['break.started']);
    expect(await codes(started, { ...contextFor(started), getSession: async () => undefined })).toContain('event.payloadReference.missing');
    expect(await codes(started, { ...contextFor(started), getSession: async () => ({ type: 'shortBreak', status: 'completed' }) as never })).toContain('event.break.sourceFocus');

    const interruptId = newId();
    const discarded = {
      ...validEvent('focus.discarded', VALID_PAYLOADS['focus.discarded']),
      payload: { ...VALID_PAYLOADS['focus.discarded'], triggeredByInterruptEventId: interruptId },
    };
    expect(await codes(discarded, { ...contextFor(discarded as Event), getEvent: async () => ({ type: 'task.created', sessionId: discarded.sessionId }) as never })).toContain('event.focus.interruptType');
    expect(await codes(discarded, { ...contextFor(discarded as Event), getEvent: async () => ({ type: 'interrupt.internal', sessionId: ID_2 }) as never })).toContain('event.focus.interruptSession');
  });

  it('rejects entity references that exist but contradict Session/DayPlan/Task/Energy/Interval facts', async () => {
    const focus = validEvent('focus.completed', VALID_PAYLOADS['focus.completed']);
    expect(await codes(focus, { ...contextFor(focus), getSession: async () => ({ type: 'focus', status: 'completed', taskId: ID_2, dayPlanId: focus.dayPlanId, pomodoroIndex: 1, plannedDuration: 1500, actualDuration: 1500 }) as never })).toContain('event.session.taskId');

    const completedBreak = validEvent('break.completed', VALID_PAYLOADS['break.completed']);
    expect(await codes(completedBreak, { ...contextFor(completedBreak), getSession: async () => ({ type: 'shortBreak', status: 'completed', dayPlanId: completedBreak.dayPlanId, plannedDuration: 300, actualDuration: 300, actualRest: 'other' }) as never })).toContain('event.session.actualRest');

    const interrupt = validEvent('interrupt.internal', VALID_PAYLOADS['interrupt.internal']);
    expect(await codes(interrupt, { ...contextFor(interrupt), getSession: async () => ({ type: 'focus', status: 'completed', taskId: interrupt.taskId, dayPlanId: interrupt.dayPlanId }) as never })).toContain('event.session.status');

    const classified = validEvent('interval.classified', VALID_PAYLOADS['interval.classified']);
    expect(await codes(classified, { ...contextFor(classified), getSession: async () => ({ type: 'extraRest', status: 'completed', originIntervalId: ID_2, taskId: null, dayPlanId: classified.dayPlanId }) as never })).toContain('event.session.originIntervalId');

    const moved = validEvent('task.movedToToday', VALID_PAYLOADS['task.movedToToday']);
    expect(await codes(moved, { ...contextFor(moved), getDayPlan: async () => ({ appDate: '2026-06-04', taskIds: [moved.taskId] }) as never })).toContain('event.dayPlan.appDate');

    const deleted = validEvent('task.deleted', { deletedReason: 'userDeleted' });
    expect(await codes(deleted, { ...contextFor(deleted), getTask: async () => ({ status: 'deleted', deletedReason: 'dataCleanup' }) as never })).toContain('event.task.deletedReason');

    const recorded = validEvent('energy.recorded', VALID_PAYLOADS['energy.recorded']);
    expect(await codes(recorded, { ...contextFor(recorded), getEnergyRecord: async () => ({ ...VALID_PAYLOADS['energy.recorded'], energyLevel: 9, sessionId: null }) as never })).toContain('event.energy.energyLevel');
  });

  it('checks Settings-backed initialization, rest-item membership, and template membership/order', async () => {
    const initialized = validEvent('settings.initialized', { ...VALID_PAYLOADS['settings.initialized'], shortBreakMinutes: 30 });
    expect(await codes(initialized)).toContain('event.settings.shortBreakMinutes.default');

    const shown = validEvent('restItem.shown', VALID_PAYLOADS['restItem.shown']);
    expect(await codes(shown, { ...contextFor(shown), getSettings: async () => ({ restSuggestions: [], dailyTaskTemplates: [] }) as never })).toContain('event.restItem.shownKey');

    const updated = validEvent('settings.dailyTaskTemplateUpdated', VALID_PAYLOADS['settings.dailyTaskTemplateUpdated']);
    expect(await codes(updated, { ...contextFor(updated), getSettings: async () => ({ restSuggestions: [], dailyTaskTemplates: [] }) as never })).toContain('event.settings.template.missing');

    const reordered = validEvent('settings.dailyTaskTemplateReordered', VALID_PAYLOADS['settings.dailyTaskTemplateReordered']);
    expect(await codes(reordered, { ...contextFor(reordered), getSettings: async () => ({ restSuggestions: [], dailyTaskTemplates: [{ templateKey: 'other', sortIndex: 0 }] }) as never })).toContain('event.settings.template.order');
  });

  it('enforces residual conditional Session associations and Task/rest snapshots', async () => {
    const completed = {
      ...validEvent('task.completed', { ...VALID_PAYLOADS['task.completed'], completionSource: 'pomodoro' }),
      sessionId: ID,
    } as Event;
    expect(await codes(completed, { ...contextFor(completed), getSession: async () => ({ type: 'shortBreak', status: 'completed', taskId: completed.taskId }) as never })).toContain('event.taskCompletion.sessionType');
    expect(await codes(completed, { ...contextFor(completed), getSession: async () => ({ type: 'focus', status: 'completed', taskId: ID_2 }) as never })).toContain('event.taskCompletion.taskId');

    const started = validEvent('focus.started', VALID_PAYLOADS['focus.started']);
    expect(await codes(started, { ...contextFor(started), getTask: async () => ({ estimatedPomodoros: 2 }) as never })).toContain('event.focus.taskEstimateAtStart');

    const selected = validEvent('restItem.selected', VALID_PAYLOADS['restItem.selected']);
    expect(await codes(selected, { ...contextFor(selected), getSession: async () => ({ type: 'shortBreak', status: 'active', actualRest: 'other' }) as never })).toContain('event.session.actualRest');

    const changed = validEvent('restItem.selectionChanged', VALID_PAYLOADS['restItem.selectionChanged']);
    const changedContext = contextFor(changed);
    expect(await codes(changed, { ...changedContext, getSettings: async () => ({ restSuggestions: [{ key: VALID_PAYLOADS['restItem.selectionChanged'].newKey, isEnabled: true, appliesTo: ['shortBreak'] }], dailyTaskTemplates: [] }) as never })).toContain('event.restItem.previousKey');

    const afterPrompt = {
      ...validEvent('prompt.shown', { promptType: 'energyRecording', promptContext: 'afterFocus' }),
      sessionId: ID,
    } as Event;
    expect(await codes({ ...afterPrompt, sessionId: null })).toContain('event.association.energyPromptSession');
    expect(await codes(afterPrompt, { ...contextFor(afterPrompt), getSession: async () => ({ type: 'shortBreak', status: 'completed' }) as never })).toContain('event.prompt.sessionType');

    const detected = { ...validEvent('interval.detected', VALID_PAYLOADS['interval.detected']), taskId: ID, dayPlanId: ID } as Event;
    expect(await codes(detected)).toContain('event.association.detectedTask');
    expect(await codes(detected)).toContain('event.association.detectedDayPlan');

    const afterEnergy = {
      ...validEvent('energy.recorded', { ...VALID_PAYLOADS['energy.recorded'], source: 'afterFocus' }),
      sessionId: ID,
    } as Event;
    expect(await codes(afterEnergy, { ...contextFor(afterEnergy), getSession: async () => ({ type: 'longBreak', status: 'completed' }) as never })).toContain('event.energy.sessionType');
  });

  it('requires archived restoration Events to mirror a restored Task state', async () => {
    const restored = validEvent('task.restored', { restoredFrom: 'archived' });
    await expect(validateEvent(restored, {
      ...contextFor(restored),
      getTask: async () => ({
        status: 'completed',
        outcome: null,
        archivedAt: null,
        completedAt: NOW,
        completionSource: 'manual',
        deletedAt: null,
        deletedReason: null,
      }) as never,
    })).resolves.toBe(restored);
    expect(await codes(restored, {
      ...contextFor(restored),
      getTask: async () => ({
        status: 'archived',
        outcome: 'completed',
        archivedAt: NOW,
        completedAt: NOW,
        completionSource: 'manual',
        deletedAt: null,
        deletedReason: null,
      }) as never,
    })).toEqual(expect.arrayContaining([
      'event.task.restored.status',
      'event.task.restored.outcome',
      'event.task.restored.archivedAt',
    ]));
  });

  it('allows triage capture to reference a different focus Task and mirrors pending Task facts', async () => {
    const captured = validEvent('triage.captured', { title: 'Captured task' });
    const focusTaskId = newId();
    await expect(validateEvent(captured, {
      ...contextFor(captured),
      getTask: async () => ({
        id: captured.taskId,
        title: 'Captured task',
        parentId: null,
        status: 'active',
        estimatedPomodoros: 1,
        metadata: { triageStatus: 'pending', source: 'triageCapture' },
      }) as never,
      getSession: async () => ({
        id: captured.sessionId,
        type: 'focus',
        status: 'active',
        taskId: focusTaskId,
        dayPlanId: captured.dayPlanId,
      }) as never,
    })).resolves.toBe(captured);
  });
});
