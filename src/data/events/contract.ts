/**
 * v4 §7 的完整静态 Event 契约（S7a）。
 *
 * `EVENT_TYPES` 是唯一事件类型清单；`EventPayloadMap` 的键与该清单一一对应。
 * 每个 payload 只包含 v4 明示字段。数值范围、跨记录引用、精确对象键和顶层关联字段
 * 由 S7b 的运行时 validator 负责，本文件只提供编译期判别能力。
 */

export const EVENT_TYPES = [
  'task.created',
  'task.updated',
  'task.estimateAdjusted',
  'task.completed',
  'task.uncompleted',
  'task.split',
  'task.archived',
  'task.deleted',
  'task.restored',
  'subtask.added',
  'subtask.reordered',
  'subtask.reparented',
  'subtask.unparented',
  'dayPlan.created',
  'dayPlan.updated',
  'dayPlan.budgetEstimated',
  'dayPlan.budgetAccepted',
  'dayPlan.budgetModeChanged',
  'dayPlan.deductionAdded',
  'dayPlan.deductionUpdated',
  'dayPlan.deductionRemoved',
  'dayPlan.taskAdded',
  'dayPlan.taskRemoved',
  'dayPlan.taskReordered',
  'dayPlan.workEnded',
  'task.reordered',
  'task.reparented',
  'task.movedToToday',
  'task.movedToList',
  'focus.started',
  'focus.completed',
  'focus.discarded',
  'break.started',
  'break.completed',
  'break.skipped',
  'restItem.shown',
  'restItem.shuffled',
  'restItem.selected',
  'restItem.selectionChanged',
  'restItem.created',
  'restItem.updated',
  'restItem.disabled',
  'restItem.enabled',
  'restItem.deleted',
  'restItem.reordered',
  'interrupt.internal',
  'interrupt.external',
  'energy.recorded',
  'triage.captured',
  'triage.movedToToday',
  'triage.movedToList',
  'triage.dismissed',
  'interval.detected',
  'interval.sessionResolved',
  'interval.classified',
  'interval.ignored',
  'settings.initialized',
  'settings.timerUpdated',
  'settings.appDayStartOffsetUpdated',
  'settings.dailyTaskTemplateAdded',
  'settings.dailyTaskTemplateUpdated',
  'settings.dailyTaskTemplateRemoved',
  'settings.dailyTaskTemplateReordered',
  'settings.restSuggestionDisplayModeUpdated',
  'statsBaseline.updated',
  'data.migrationCompleted',
  'data.migrationFailed',
  'data.exported',
  'data.imported',
  'data.cleared',
  'demo.loaded',
  'demo.cleared',
  'notification.shown',
  'prompt.shown',
  'prompt.dismissed',
  'error.dataWriteFailed',
  'error.unexpectedState',
  'diagnosticLog.exported',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

type EmptyPayload = Record<string, never>;
type BudgetMode = 'conservative' | 'optimistic' | 'manual';
type BreakType = 'shortBreak' | 'longBreak';
type EnergySource =
  | 'dayStart'
  | 'beforeFocus'
  | 'afterFocus'
  | 'afterShortBreak'
  | 'afterLongBreak'
  | 'afterExtraFocus'
  | 'afterExtraRest'
  | 'onReturn'
  | 'manual';
type PromptType = 'taskCompletionCheck' | 'energyRecording' | 'taskSplitSuggestion';
type EnergyPromptContext = Exclude<EnergySource, 'manual'>;
type ErrorContext = Record<string, unknown>;

export interface EventPayloadMap {
  'task.created': {
    title: string;
    parentId: string | null;
    estimatedPomodoros: number;
    source:
      | 'manual'
      | 'systemDailyTemplate'
      | 'unresolvedIntervalClassification'
      | 'splitChild'
      | 'triageCapture';
  };
  'task.updated': { field: string; oldValue: unknown; newValue: unknown };
  'task.estimateAdjusted': { round: 2 | 3; oldEstimate: number; newEstimate: number };
  'task.completed': {
    completionSource: 'manual' | 'pomodoro';
    completedAt: string;
    validFocusCountAtCompletion: number;
  };
  'task.uncompleted': {
    previousCompletedAt: string;
    previousCompletionSource: 'manual' | 'pomodoro';
  };
  'task.split': { lineageId: string; newTaskId: string };
  'task.archived': { outcome: 'completed' | 'split' };
  'task.deleted': {
    /** v4 §7.1 explicitly allows this field to be omitted during Phase 1. */
    deletedReason?: null | 'userDeleted' | 'triageDismissed' | 'dataCleanup';
  };
  'task.restored': { restoredFrom: 'deleted' | 'archived' };
  'subtask.added': {
    parentId: string;
    title: string;
    estimatedPomodoros: number;
    source: 'listPage' | 'timerPage';
  };
  'subtask.reordered': { parentId: string; fromIndex: number; toIndex: number };
  'subtask.reparented': { fromParentId: string; toParentId: string };
  'subtask.unparented': { previousParentId: string };
  'dayPlan.created': { appDate: string; localDate: string; budgetMode: BudgetMode };
  'dayPlan.updated': { field: string; oldValue: unknown; newValue: unknown };
  'dayPlan.budgetEstimated': {
    budgetMode: BudgetMode;
    conservativePomodoros: number;
    optimisticPomodoros: number;
    workWindowMin: number;
  };
  'dayPlan.budgetAccepted': { budgetPomodoros: number; budgetMode: BudgetMode };
  'dayPlan.budgetModeChanged': { oldMode: BudgetMode; newMode: BudgetMode };
  'dayPlan.deductionAdded': {
    deductionType: 'fixed' | 'life';
    deductionId: string;
    label: string;
    hours: number;
  };
  'dayPlan.deductionUpdated': {
    deductionType: 'fixed' | 'life';
    deductionId: string;
    label: string;
    oldHours: number;
    newHours: number;
  };
  'dayPlan.deductionRemoved': {
    deductionType: 'fixed' | 'life';
    deductionId: string;
    label: string;
    hours: number;
  };
  'dayPlan.taskAdded': {
    addedAtIndex: number;
    source: 'drag' | 'button' | 'systemDailyTemplate' | 'unresolvedIntervalClassification';
  };
  'dayPlan.taskRemoved': { reason: 'userRemoved' | 'taskDeleted' | 'taskArchived' };
  'dayPlan.taskReordered': { fromIndex: number; toIndex: number };
  'dayPlan.workEnded': {
    appDate: string;
    localDate: string;
    endedAfterFocusSessionId: string | null;
    reason: 'userEndedWork';
  };
  'task.reordered': { fromIndex: number; toIndex: number };
  'task.reparented': { fromParentId: null; toParentId: string; toIndex: number };
  'task.movedToToday': { appDate: string; addedAtIndex: number };
  'task.movedToList': { fromAppDate: string };
  'focus.started': { pomodoroIndex: number; plannedDuration: number; taskEstimateAtStart: number };
  'focus.completed': { pomodoroIndex: number; plannedDuration: number; actualDuration: number };
  'focus.discarded': {
    pomodoroIndex: number;
    actualDuration: number;
    reason: 'userInitiated' | 'userConfirmedAfterRecovery' | null;
    triggeredByInterruptEventId: string | null;
  };
  'break.started': { breakType: BreakType; plannedDuration: number; sourceFocusSessionId: string };
  'break.completed': {
    breakType: BreakType;
    plannedDuration: number;
    actualDuration: number;
    actualRest: string | null;
  };
  'break.skipped': {
    breakType: BreakType;
    skipKind: 'explicitSkip' | 'noResponse' | 'appClosed' | 'missed';
    plannedDuration: number;
  };
  'restItem.shown': { breakType: BreakType; shownKeys: string[]; eligibleCount: number };
  'restItem.shuffled': { breakType: BreakType; shuffleCount: number };
  'restItem.selected': {
    breakType: BreakType;
    selectedKey: string;
    selectedIndex: number;
    sourceShownEventId: string | null;
  };
  'restItem.selectionChanged': {
    breakType: BreakType;
    previousKey: string;
    newKey: string;
    newIndex: number;
    sourceShownEventId: string | null;
  };
  'restItem.created': {
    key: string;
    label: string;
    appliesTo: ['shortBreak'] | ['longBreak'];
    sortIndex: number;
  };
  'restItem.updated': {
    key: string;
    changedFields: Partial<{ label: string; icon: string | null; sortIndex: number }>;
  };
  'restItem.disabled': { key: string };
  'restItem.enabled': { key: string };
  'restItem.deleted': { key: string; label: string };
  'restItem.reordered': { breakType: BreakType; orderedKeys: string[] };
  'interrupt.internal': { offsetSeconds: number; note: string | null };
  'interrupt.external': { offsetSeconds: number; note: string | null };
  'energy.recorded': { source: EnergySource; energyLevel: number; mood: number | null; note: string | null };
  'triage.captured': { title: string };
  'triage.movedToToday': { addedAtIndex: number };
  'triage.movedToList': EmptyPayload;
  'triage.dismissed': { dismissReason: string | null };
  'interval.detected': {
    source: 'appReopened' | 'systemRecovered' | 'timerStateLost' | 'userNoResponse';
    detectedSessionType: 'focus' | BreakType | null;
  };
  'interval.sessionResolved': {
    sessionType: 'focus' | BreakType;
    resolvedAs: 'completed' | 'discarded' | 'skipped';
  };
  'interval.classified': { classificationType: 'extraFocus' | 'extraRest' };
  'interval.ignored': { ignoreReason: string | null };
  'settings.initialized': {
    focusMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    longBreakEvery: number;
    restSuggestionsCount: number;
    dailyTaskTemplatesCount: number;
  };
  'settings.timerUpdated': {
    field: 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes';
    oldValue: number;
    newValue: number;
  };
  'settings.appDayStartOffsetUpdated': {
    oldValue: number;
    newValue: number;
    changedBy: 'user' | 'migration' | 'system';
  };
  'settings.dailyTaskTemplateAdded': {
    templateKey: string;
    title: string;
    estimatedPomodoros: number;
    autoAddToDayPlan: boolean;
    sortPosition: 'first' | 'last';
    sortIndex: number;
  };
  'settings.dailyTaskTemplateUpdated': {
    templateKey: string;
    field: 'title' | 'estimatedPomodoros' | 'autoAddToDayPlan' | 'sortPosition';
    oldValue: string | number | boolean;
    newValue: string | number | boolean;
  };
  'settings.dailyTaskTemplateRemoved': {
    templateKey: string;
    title: string;
    wasAutoAddEnabled: boolean;
  };
  'settings.dailyTaskTemplateReordered': { orderedTemplateKeys: string[] };
  'settings.restSuggestionDisplayModeUpdated': {
    field: 'restSuggestionDisplayMode';
    oldValue: 'customOrder' | 'usageFrequency';
    newValue: 'customOrder' | 'usageFrequency';
    changedBy: 'user';
  };
  'statsBaseline.updated': { oldValue: number; newValue: number };
  'data.migrationCompleted': {
    fromSchemaVersion: string;
    toSchemaVersion: string;
    durationMs: number | null;
  };
  'data.migrationFailed': {
    fromSchemaVersion: string;
    toSchemaVersion: string;
    errorCode: string | null;
    errorMessage: string | null;
  };
  'data.exported': { format: 'json'; schemaVersion: string; totalRecords: number | null };
  'data.imported': { format: 'json'; sourceSchemaVersion: string; totalRecords: number | null };
  'data.cleared': { scope: 'allLocalData' };
  'demo.loaded': { demoVersion: string | null; recordCount: number | null };
  'demo.cleared': { recordCount: number | null };
  'notification.shown': { notificationType: 'focusCompleted' | 'breakCompleted' };
  'prompt.shown':
    | { promptType: 'energyRecording'; promptContext: EnergyPromptContext }
    | { promptType: Exclude<PromptType, 'energyRecording'>; promptContext: null };
  'prompt.dismissed':
    | { promptType: 'energyRecording'; promptContext: EnergyPromptContext }
    | { promptType: Exclude<PromptType, 'energyRecording'>; promptContext: null };
  'error.dataWriteFailed': { errorCode: string; errorMessage: string | null; context: ErrorContext };
  'error.unexpectedState': { errorCode: string; errorMessage: string | null; context: ErrorContext };
  'diagnosticLog.exported': {
    format: 'json';
    rangeDays: number;
    includedEventTypes: Array<'error.dataWriteFailed' | 'error.unexpectedState'>;
    exportedEventCount: number | null;
  };
}

/** 一个事件类型对应的最小判别契约；实体顶层字段由 schema/Event 叠加。 */
export type EventOf<T extends EventType> = T extends EventType
  ? {
      type: T;
      payload: EventPayloadMap[T];
    }
  : never;

/** 78 个事件的判别联合。 */
export type EventContract = { [T in EventType]: EventOf<T> }[EventType];

// 编译期双向守卫：payload map 不得漏键，也不得包含 EVENT_TYPES 之外的键。
type MissingPayloadTypes = Exclude<EventType, keyof EventPayloadMap>;
type ExtraPayloadTypes = Exclude<keyof EventPayloadMap, EventType>;
const payloadMapIsComplete: MissingPayloadTypes extends never ? true : never = true;
const payloadMapHasNoExtras: ExtraPayloadTypes extends never ? true : never = true;
void payloadMapIsComplete;
void payloadMapHasNoExtras;
