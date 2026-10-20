import { EVENT_STORE, STORE, STORE_NAMES, type StoreName } from '../dataStore';
import type { DayPlan, EnergyRecord, Event, MergeGroup, Session, Settings, Task, UnresolvedInterval } from '../schema';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { migrateRecord } from '../storage/migrations';
import {
  collectDayPlanValidationIssues,
  collectEnergyRecordValidationIssues,
  collectEventValidationIssues,
  collectMergeGroupValidationIssues,
  collectSessionValidationIssues,
  collectSettingsValidationIssues,
  collectTaskValidationIssues,
  collectUnresolvedIntervalValidationIssues,
  isRecord,
  ValidationCollector,
  validateUuidV7,
  type ValidationContext,
  type ValidationIssue,
} from '../validation';
import { parseLocalBackup, type LocalBackupFile } from './localBackup';

type RecordValue = Record<string, unknown>;
type RecordMap = Record<StoreName, Map<string, RecordValue>>;

function rejectRecord(store: StoreName, id: string, issues: readonly ValidationIssue[]): never {
  const issue = issues[0]!;
  throw new Error(`备份文件中 ${store}（${id}）校验失败：${issue.path} ${issue.message}`);
}

/**
 * 备份是同一时刻的完整快照。引用查找包含 tombstone，且“之前的实体”就是快照自身：
 * 不能拿今天的 Settings 重新要求历史 Session 的计划时长，也不能重放历史状态迁移。
 */
function snapshotContext(maps: RecordMap): ValidationContext {
  const get = <T>(store: StoreName, id: string) => Promise.resolve(maps[store].get(id) as T | undefined);
  const values = (store: StoreName) => [...maps[store].values()];
  return {
    getTask: (id) => get<Task>(STORE.tasks, id),
    hasTaskChildren: async (id) => values(STORE.tasks).some((task) => task.parentId === id && task.deletedAt === null),
    getDayPlan: (id) => get<DayPlan>(STORE.dayPlans, id),
    getActiveDayPlanByAppDate: async (appDate) => values(STORE.dayPlans)
      .find((plan) => plan.appDate === appDate && plan.deletedAt === null) as unknown as DayPlan | undefined,
    getSession: (id) => get<Session>(STORE.sessions, id),
    getEnergyRecord: (id) => get<EnergyRecord>(STORE.energyRecords, id),
    getEvent: (id) => get<Event>(EVENT_STORE, id),
    getUnresolvedInterval: (id) => get<UnresolvedInterval>(STORE.unresolvedIntervals, id),
    getSettings: (id) => get<Settings>(STORE.settings, id),
    getActiveSettings: async () => values(STORE.settings)
      .find((settings) => settings.deletedAt === null) as unknown as Settings | undefined,
    isRestSuggestionReferenced: async (key) => values(STORE.sessions)
      .some((session) => session.suggestedRest === key || session.actualRest === key),
    getMergeGroup: (id) => get<MergeGroup>(STORE.mergeGroups, id),
    hasTasksInMergeGroup: async (id) => values(STORE.tasks).some((task) => task.mergeGroupId === id),
    getActiveFocusSessionByMergeGroupId: async (id) => values(STORE.sessions)
      .find((session) => session.mergeGroupId === id && session.type === 'focus'
        && session.status === 'active' && session.deletedAt === null) as unknown as Session | undefined,
  };
}

const ASSOCIATION_STORES = {
  taskId: STORE.tasks,
  sessionId: STORE.sessions,
  dayPlanId: STORE.dayPlans,
  energyRecordId: STORE.energyRecords,
  unresolvedIntervalId: STORE.unresolvedIntervals,
  settingsId: STORE.settings,
  mergeGroupId: STORE.mergeGroups,
} as const;

function validateEventReferences(event: RecordValue, maps: RecordMap): void {
  const requireReference = (store: StoreName, id: unknown, path: string) => {
    if (id !== null && id !== undefined && (typeof id !== 'string' || !maps[store].has(id))) {
      throw new Error(`备份文件中 events（${String(event.id)}）的 ${path} 引用不存在`);
    }
  };
  for (const [key, store] of Object.entries(ASSOCIATION_STORES)) {
    requireReference(store, event[key], key);
  }
  const payload = event.payload as RecordValue;
  for (const key of ['parentId', 'fromParentId', 'toParentId', 'previousParentId', 'newTaskId']) {
    if (key in payload) requireReference(STORE.tasks, payload[key], `payload.${key}`);
  }
  for (const key of ['taskIds', 'finalTaskIds', 'incompleteTaskIds']) {
    if (Array.isArray(payload[key])) {
      for (const id of payload[key]) requireReference(STORE.tasks, id, `payload.${key}`);
    }
  }
  for (const key of ['sourceFocusSessionId', 'endedAfterFocusSessionId']) {
    if (key in payload) {
      requireReference(STORE.sessions, payload[key], `payload.${key}`);
      const source = typeof payload[key] === 'string' ? maps.sessions.get(payload[key]) : undefined;
      if (source && (source.type !== 'focus' || source.status !== 'completed')) {
        throw new Error(`备份文件中 events（${String(event.id)}）的 payload.${key} 必须引用已完成的专注`);
      }
    }
  }
  for (const key of ['triggeredByInterruptEventId', 'sourceShownEventId']) {
    if (key in payload) {
      requireReference(EVENT_STORE, payload[key], `payload.${key}`);
      const source = typeof payload[key] === 'string' ? maps.events.get(payload[key]) : undefined;
      if (source) {
        const validType = key === 'sourceShownEventId'
          ? source.type === 'restItem.shown'
          : source.type === 'interrupt.internal' || source.type === 'interrupt.external';
        if (!validType || source.sessionId !== event.sessionId) {
          throw new Error(`备份文件中 events（${String(event.id)}）的 payload.${key} 引用类型或计时记录不一致`);
        }
      }
    }
  }
}

// 这些关联在 Session 创建后固定；其余写入校验（例如当时 active、当时任务名、
// Settings 当时的值）不适用于历史快照。复用原校验器，避免重写一套事件类型规则。
const STABLE_EVENT_ISSUE_CODES = new Set([
  'event.session.type',
  'event.session.mergeGroupId',
  'event.session.dayPlanId',
  'event.session.pomodoroIndex',
  'event.session.plannedDuration',
  'event.session.sourceFocus',
  'event.session.originIntervalId',
  'event.taskCompletion.sessionType',
  'event.energy.sessionType',
  'event.prompt.sessionType',
]);

async function validateHistoricalEvent(
  event: RecordValue, maps: RecordMap, sourceVersion: number, context: ValidationContext,
): Promise<void> {
  const version = event.schemaVersion;
  if (!Number.isInteger(version) || Number(version) < 1 || Number(version) > sourceVersion) {
    throw new Error(`备份文件中 events（${String(event.id)}）的数据版本无效`);
  }
  const payload = isRecord(event.payload) ? event.payload : {};
  if ((version === 1 && (String(event.type).startsWith('mergeGroup.')
      || payload.promptType === 'mergeGroupLimitReached' || event.mergeGroupId != null))
    || (version === 2 && (event.type === 'mergeGroup.renamed' || event.type === 'mergeGroup.completed'))) {
    throw new Error(`备份文件中 events（${String(event.id)}）的事件类型不属于其数据版本`);
  }
  // 曾在 v3 内完善完成快照，旧事件没有这些事实；只接受完整旧组合，不替它补写。
  const legacyGroupCompleted = version === 3 && event.type === 'mergeGroup.completed'
    && !Object.hasOwn(payload, 'finalTaskIds') && !Object.hasOwn(payload, 'incompleteTaskIds')
    && event.sessionId === null;
  // 仅为校验建立兼容视图；写回的历史 Event 始终逐字段保留原值。
  const view = version === 1 && !Object.hasOwn(event, 'mergeGroupId')
    ? { ...event, mergeGroupId: null } : event;
  const issues = (await collectEventValidationIssues(view)).filter((issue) => {
    if (issue.code === 'schemaVersion.current' || issue.code === 'validation.context.required') return false;
    // v2 的 mergeGroup.created 尚未记录显示名，不能向历史事件伪造 title。
    if (version === 2 && event.type === 'mergeGroup.created'
      && issue.code === 'field.missing' && issue.path === 'payload.title') return false;
    if (legacyGroupCompleted
      && ((issue.code === 'field.missing'
        && (issue.path === 'payload.finalTaskIds' || issue.path === 'payload.incompleteTaskIds'))
        || (issue.code === 'event.association.required' && issue.path === 'sessionId'))) return false;
    return true;
  });
  if (issues.length) rejectRecord(EVENT_STORE, String(event.id), issues);
  validateEventReferences(event, maps);
  const stableIssues = (await collectEventValidationIssues(view, { getSession: context.getSession }))
    .filter((issue) => STABLE_EVENT_ISSUE_CODES.has(issue.code));
  if (stableIssues.length) rejectRecord(EVENT_STORE, String(event.id), stableIssues);
}

const ENTITY_VALIDATORS = {
  tasks: collectTaskValidationIssues,
  dayPlans: collectDayPlanValidationIssues,
  sessions: collectSessionValidationIssues,
  energyRecords: collectEnergyRecordValidationIssues,
  unresolvedIntervals: collectUnresolvedIntervalValidationIssues,
  settings: collectSettingsValidationIssues,
  mergeGroups: collectMergeGroupValidationIssues,
};

/**
 * 在确认覆盖与真正写库前均可调用。所有迁移/校验都在内存里进行，失败不修改当前数据。
 * schemaVersion 保留文件来源版本供 data.imported 审计；records 是已迁移的当前实体形状。
 */
export async function prepareLocalBackup(jsonText: string): Promise<LocalBackupFile> {
  const backup = parseLocalBackup(jsonText);
  const sourceVersion = Number(backup.schemaVersion);
  const records = {} as Record<StoreName, RecordValue[]>;
  const maps = {} as RecordMap;
  for (const store of STORE_NAMES) {
    records[store] = backup.records[store].map((value) => {
      if (!isRecord(value)) throw new Error(`备份文件中 ${store} 记录格式不正确`);
      if (store === EVENT_STORE) return value;
      if (value.schemaVersion !== sourceVersion) {
        throw new Error(`备份文件中 ${store}（${String(value.id)}）的数据版本与文件不一致`);
      }
      if (sourceVersion === 1 && store === STORE.sessions) {
        const collector = new ValidationCollector();
        if (!validateUuidV7(value.taskId, 'taskId', collector, true)) {
          rejectRecord(store, String(value.id), collector.issues);
        }
      }
      return sourceVersion < CURRENT_SCHEMA_VERSION
        ? migrateRecord(store, value, sourceVersion) ?? value : value;
    });
    maps[store] = new Map(records[store].map((value) => [String(value.id), value]));
  }
  if (records.settings.filter((settings) => settings.deletedAt === null).length !== 1) {
    throw new Error('备份文件必须恰好有一条有效的设置记录');
  }
  if (records.sessions.filter((session) => session.status === 'active' && session.deletedAt === null).length > 1) {
    throw new Error('备份文件不能包含多个正在计时的记录');
  }
  const context = snapshotContext(maps);
  for (const [store, validate] of Object.entries(ENTITY_VALIDATORS)) {
    for (const value of records[store as StoreName]) {
      let issues: readonly ValidationIssue[];
      try {
        issues = await validate(value, context);
      } catch {
        throw new Error(`备份文件中 ${store}（${String(value.id)}）或其引用记录格式不正确`);
      }
      if (issues.length) rejectRecord(store as StoreName, String(value.id), issues);
    }
  }
  for (const event of records.events) await validateHistoricalEvent(event, maps, sourceVersion, context);
  return { ...backup, records };
}
