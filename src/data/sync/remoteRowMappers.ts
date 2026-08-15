/**
 * 本地实体（camelCase）→ 远端 Postgres 行（snake_case）字段映射（S4）。
 *
 * 每个实体一个显式映射分支，不做通用反射式驼峰转下划线——字段集合、类型转换需要
 * 显式可读，避免"某个字段改名后映射悄悄错位"这类问题难以在 review 中发现。
 * 远端表结构见 supabase/schema.sql，字段一一对应 docs/data-layer-spec-v4.3.md §3/§7。
 *
 * `syncedAt` 不出现在任何返回的行里：它是纯本地簿记字段，远端没有对应列（见 ADR-0035）。
 */

import { STORE, type SyncableEntityMap, type SyncableStoreName } from '../dataStore';
import { DEFAULT_MERGE_GROUP_TITLE } from '../schema';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import type { Event } from '../schema';

export type RemoteEntityTableName =
  | 'tasks'
  | 'day_plans'
  | 'sessions'
  | 'energy_records'
  | 'unresolved_intervals'
  | 'settings'
  | 'merge_groups';

export const REMOTE_TABLE_BY_STORE: Record<SyncableStoreName, RemoteEntityTableName> = {
  [STORE.tasks]: 'tasks',
  [STORE.dayPlans]: 'day_plans',
  [STORE.sessions]: 'sessions',
  [STORE.energyRecords]: 'energy_records',
  [STORE.unresolvedIntervals]: 'unresolved_intervals',
  [STORE.settings]: 'settings',
  [STORE.mergeGroups]: 'merge_groups',
};

export const REMOTE_EVENTS_TABLE = 'events' as const;

export type RemoteRow = Record<string, unknown>;

interface SyncableBaseLike {
  id: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  deletedAt: string | null;
  deviceId: string | null;
}

function toBaseRow(record: SyncableBaseLike): RemoteRow {
  return {
    id: record.id,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    schema_version: record.schemaVersion,
    deleted_at: record.deletedAt,
    device_id: record.deviceId,
  };
}

/** 六个可同步实体：本地记录 → 远端行。`store` 决定具体走哪个字段映射分支。 */
export function toRemoteEntityRow<S extends SyncableStoreName>(
  store: S,
  record: SyncableEntityMap[S],
): RemoteRow {
  const base = toBaseRow(record);
  switch (store) {
    case STORE.tasks: {
      const task = record as SyncableEntityMap['tasks'];
      return {
        ...base,
        parent_id: task.parentId,
        title: task.title,
        status: task.status,
        outcome: task.outcome,
        completion_source: task.completionSource,
        estimated_pomodoros: task.estimatedPomodoros,
        estimate_rounds: task.estimateRounds,
        actual_work_note: task.actualWorkNote,
        note: task.note,
        sort_index: task.sortIndex,
        completed_at: task.completedAt,
        archived_at: task.archivedAt,
        deleted_reason: task.deletedReason,
        metadata: task.metadata,
        lineage_id: task.lineageId,
        split_from_task_id: task.splitFromTaskId,
        merge_group_id: task.mergeGroupId,
        split_index: task.splitIndex,
      };
    }
    case STORE.dayPlans: {
      const dayPlan = record as SyncableEntityMap['dayPlans'];
      return {
        ...base,
        app_date: dayPlan.appDate,
        local_date: dayPlan.localDate,
        timezone: dayPlan.timezone,
        task_ids: dayPlan.taskIds,
        budget_pomodoros: dayPlan.budgetPomodoros,
        budget_mode: dayPlan.budgetMode,
        estimate: dayPlan.estimate,
        settings_snapshot: dayPlan.settingsSnapshot,
      };
    }
    case STORE.sessions: {
      const session = record as SyncableEntityMap['sessions'];
      return {
        ...base,
        type: session.type,
        status: session.status,
        task_ids: session.taskIds,
        merge_group_id: session.mergeGroupId,
        task_segments: session.taskSegments,
        started_at: session.startedAt,
        ended_at: session.endedAt,
        planned_duration: session.plannedDuration,
        actual_duration: session.actualDuration,
        pomodoro_index: session.pomodoroIndex,
        skip_kind: session.skipKind,
        origin_interval_id: session.originIntervalId,
        source_focus_session_id: session.sourceFocusSessionId,
        suggested_rest: session.suggestedRest,
        actual_rest: session.actualRest,
        local_date: session.localDate,
        timezone: session.timezone,
        day_plan_id: session.dayPlanId,
      };
    }
    case STORE.energyRecords: {
      const energyRecord = record as SyncableEntityMap['energyRecords'];
      return {
        ...base,
        energy_level: energyRecord.energyLevel,
        mood: energyRecord.mood,
        source: energyRecord.source,
        session_id: energyRecord.sessionId,
        note: energyRecord.note,
        occurred_at: energyRecord.occurredAt,
        local_date: energyRecord.localDate,
        timezone: energyRecord.timezone,
      };
    }
    case STORE.unresolvedIntervals: {
      const interval = record as SyncableEntityMap['unresolvedIntervals'];
      return {
        ...base,
        source: interval.source,
        started_at: interval.startedAt,
        ended_at: interval.endedAt,
        status: interval.status,
        local_date: interval.localDate,
        timezone: interval.timezone,
        classified_at: interval.classifiedAt,
        ignored_at: interval.ignoredAt,
        ignore_reason: interval.ignoreReason,
      };
    }
    case STORE.settings: {
      const settings = record as SyncableEntityMap['settings'];
      return {
        ...base,
        focus_minutes: settings.focusMinutes,
        short_break_minutes: settings.shortBreakMinutes,
        long_break_minutes: settings.longBreakMinutes,
        long_break_every: settings.longBreakEvery,
        rest_suggestions: settings.restSuggestions,
        daily_task_templates: settings.dailyTaskTemplates,
        lifetime_pomodoro_baseline: settings.lifetimePomodoroBaseline,
        rest_suggestion_display_mode: settings.restSuggestionDisplayMode,
        app_day_start_offset_minutes: settings.appDayStartOffsetMinutes,
      };
    }
    case STORE.mergeGroups: {
      const group = record as SyncableEntityMap['mergeGroups'];
      return {
        ...base,
        title: group.title,
        task_ids: group.taskIds,
        estimated_pomodoros: group.estimatedPomodoros,
        estimate_rounds: group.estimateRounds,
        status: group.status,
        completed_at: group.completedAt,
        dissolved_at: group.dissolvedAt,
        dissolved_reason: group.dissolvedReason,
      };
    }
    default:
      throw new Error(`未知的可同步 store: ${String(store)}`);
  }
}

/** Event：本地记录 → 远端行。没有 updated_at/deleted_at/device_id（append-only，见 supabase/schema.sql）。 */
export function toRemoteEventRow(event: Event): RemoteRow {
  return {
    id: event.id,
    created_at: event.createdAt,
    schema_version: event.schemaVersion,
    type: event.type,
    occurred_at: event.occurredAt,
    local_date: event.localDate,
    timezone: event.timezone,
    payload: event.payload,
    task_id: event.taskId,
    merge_group_id: event.mergeGroupId,
    session_id: event.sessionId,
    day_plan_id: event.dayPlanId,
    energy_record_id: event.energyRecordId,
    unresolved_interval_id: event.unresolvedIntervalId,
    settings_id: event.settingsId,
    correlation_id: event.correlationId,
  };
}

/**
 * 远端行 → 本地实体（S5，下载方向的反向映射）。
 *
 * `syncedAt` 不取自远端（远端根本没有这一列）——它是"这台设备什么时候确认同步过这条记录"，
 * 传入调用方本次下载动作发生的本地时刻；`deviceId` 取远端行的 device_id
 * （谁最后一次把这条记录写上去的，是跨端共享的溯源信息，和 syncedAt 语义不同）。
 */
export function fromRemoteEntityRow<S extends SyncableStoreName>(
  store: S,
  row: RemoteRow,
  syncedAt: string,
): SyncableEntityMap[S] {
  /*
   * 旧版本客户端写入的远端行结构更老（如合并番茄钟之前的 sessions.task_id 标量）。
   * 上面各 case 的字段映射已经把它们规整成当前的本地形状，因此这里把结构版本一并
   * 提到当前版本——与本地 IndexedDB 升级（storage/migrations.ts）是同一套规则，
   * 否则写入校验会以 schemaVersion 不匹配为由拒绝，旧设备的数据就同步不下来。
   * 反过来，**更新**的版本不动：那是本客户端还不认识的结构，宁可让校验拒绝，
   * 也不能按旧规则曲解后写进本地。
   */
  const remoteSchemaVersion = row.schema_version as number;
  const base = {
    id: row.id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    schemaVersion: Math.max(remoteSchemaVersion, CURRENT_SCHEMA_VERSION),
    deletedAt: row.deleted_at as string | null,
    deviceId: row.device_id as string | null,
    syncedAt,
  };
  switch (store) {
    case STORE.tasks: {
      const entity: SyncableEntityMap['tasks'] = {
        ...base,
        parentId: row.parent_id as string | null,
        title: row.title as string,
        status: row.status as SyncableEntityMap['tasks']['status'],
        outcome: row.outcome as SyncableEntityMap['tasks']['outcome'],
        completionSource: row.completion_source as SyncableEntityMap['tasks']['completionSource'],
        estimatedPomodoros: row.estimated_pomodoros as number,
        estimateRounds: row.estimate_rounds as SyncableEntityMap['tasks']['estimateRounds'],
        actualWorkNote: row.actual_work_note as string | null,
        note: row.note as string | null,
        sortIndex: row.sort_index as number,
        completedAt: row.completed_at as string | null,
        archivedAt: row.archived_at as string | null,
        deletedReason: row.deleted_reason as SyncableEntityMap['tasks']['deletedReason'],
        metadata: row.metadata as SyncableEntityMap['tasks']['metadata'],
        lineageId: row.lineage_id as string,
        splitFromTaskId: row.split_from_task_id as string | null,
        splitIndex: row.split_index as number,
        // 合并番茄钟之前写入的远端行没有这一列，缺失即按 null 读。
        mergeGroupId: (row.merge_group_id as string | null | undefined) ?? null,
      };
      return entity as SyncableEntityMap[S];
    }
    case STORE.dayPlans: {
      const entity: SyncableEntityMap['dayPlans'] = {
        ...base,
        appDate: row.app_date as string,
        localDate: row.local_date as string,
        timezone: row.timezone as string,
        taskIds: row.task_ids as string[],
        budgetPomodoros: row.budget_pomodoros as number,
        budgetMode: row.budget_mode as SyncableEntityMap['dayPlans']['budgetMode'],
        estimate: row.estimate as SyncableEntityMap['dayPlans']['estimate'],
        settingsSnapshot: row.settings_snapshot as SyncableEntityMap['dayPlans']['settingsSnapshot'],
      };
      return entity as SyncableEntityMap[S];
    }
    case STORE.sessions: {
      const entity: SyncableEntityMap['sessions'] = {
        ...base,
        type: row.type as SyncableEntityMap['sessions']['type'],
        status: row.status as SyncableEntityMap['sessions']['status'],
        /*
         * 合并番茄钟把关联任务从标量 task_id 改成了 task_ids 数组。更早写入的远端行
         * 只有 task_id，这里按同一套规则回填：有值 → [taskId]，null → 空数组，
         * 与本地 IndexedDB v1→v2 迁移（storage/migrations.ts）保持一致。
         */
        taskIds: Array.isArray(row.task_ids)
          ? (row.task_ids as string[])
          : typeof row.task_id === 'string' ? [row.task_id] : [],
        mergeGroupId: (row.merge_group_id as string | null | undefined) ?? null,
        /*
         * 成员分段是 v4.3 才有的字段。更早写入的远端行没有它，一律回填空数组——
         * 与本地 v2→v3 迁移同一口径：历史合并 Session 没有可还原的分段事实，不伪造。
         */
        taskSegments: Array.isArray(row.task_segments)
          ? (row.task_segments as SyncableEntityMap['sessions']['taskSegments'])
          : [],
        startedAt: row.started_at as string,
        endedAt: row.ended_at as string | null,
        plannedDuration: row.planned_duration as number | null,
        actualDuration: row.actual_duration as number | null,
        pomodoroIndex: row.pomodoro_index as number | null,
        skipKind: row.skip_kind as SyncableEntityMap['sessions']['skipKind'],
        originIntervalId: row.origin_interval_id as string | null,
        sourceFocusSessionId: row.source_focus_session_id as string | null,
        suggestedRest: row.suggested_rest as string | null,
        actualRest: row.actual_rest as string | null,
        localDate: row.local_date as string,
        timezone: row.timezone as string,
        dayPlanId: row.day_plan_id as string | null,
      };
      return entity as SyncableEntityMap[S];
    }
    case STORE.energyRecords: {
      const entity: SyncableEntityMap['energyRecords'] = {
        ...base,
        energyLevel: row.energy_level as number,
        mood: row.mood as number | null,
        source: row.source as SyncableEntityMap['energyRecords']['source'],
        sessionId: row.session_id as string | null,
        note: row.note as string | null,
        occurredAt: row.occurred_at as string,
        localDate: row.local_date as string,
        timezone: row.timezone as string,
      };
      return entity as SyncableEntityMap[S];
    }
    case STORE.unresolvedIntervals: {
      const entity: SyncableEntityMap['unresolvedIntervals'] = {
        ...base,
        source: row.source as SyncableEntityMap['unresolvedIntervals']['source'],
        startedAt: row.started_at as string,
        endedAt: row.ended_at as string,
        status: row.status as SyncableEntityMap['unresolvedIntervals']['status'],
        localDate: row.local_date as string,
        timezone: row.timezone as string,
        classifiedAt: row.classified_at as string | null,
        ignoredAt: row.ignored_at as string | null,
        ignoreReason: row.ignore_reason as string | null,
      };
      return entity as SyncableEntityMap[S];
    }
    case STORE.settings: {
      const entity: SyncableEntityMap['settings'] = {
        ...base,
        focusMinutes: row.focus_minutes as number,
        shortBreakMinutes: row.short_break_minutes as number,
        longBreakMinutes: row.long_break_minutes as number,
        longBreakEvery: row.long_break_every as number,
        restSuggestions: row.rest_suggestions as SyncableEntityMap['settings']['restSuggestions'],
        dailyTaskTemplates: row.daily_task_templates as SyncableEntityMap['settings']['dailyTaskTemplates'],
        lifetimePomodoroBaseline: row.lifetime_pomodoro_baseline as number,
        restSuggestionDisplayMode:
          row.rest_suggestion_display_mode as SyncableEntityMap['settings']['restSuggestionDisplayMode'],
        appDayStartOffsetMinutes: row.app_day_start_offset_minutes as number,
      };
      return entity as SyncableEntityMap[S];
    }
    case STORE.mergeGroups: {
      const entity: SyncableEntityMap['mergeGroups'] = {
        ...base,
        // v4.3 前的远端行没有 title；回填系统默认名，保证非空约束（§3.8 一致性约束 8）。
        title:
          typeof row.title === 'string' && row.title.trim() !== ''
            ? row.title
            : DEFAULT_MERGE_GROUP_TITLE,
        taskIds: row.task_ids as string[],
        estimatedPomodoros: row.estimated_pomodoros as number,
        estimateRounds: row.estimate_rounds as SyncableEntityMap['mergeGroups']['estimateRounds'],
        status: row.status as SyncableEntityMap['mergeGroups']['status'],
        completedAt: (row.completed_at as string | null | undefined) ?? null,
        dissolvedAt: row.dissolved_at as string | null,
        dissolvedReason: row.dissolved_reason as SyncableEntityMap['mergeGroups']['dissolvedReason'],
      };
      return entity as SyncableEntityMap[S];
    }
    default:
      throw new Error(`未知的可同步 store: ${String(store)}`);
  }
}

/** Event：远端行 → 本地实体。Event 没有 syncedAt/deviceId 字段（append-only，同 toRemoteEventRow）。 */
export function fromRemoteEventRow(row: RemoteRow): Event {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    schemaVersion: row.schema_version as number,
    type: row.type as Event['type'],
    occurredAt: row.occurred_at as string,
    localDate: row.local_date as string,
    timezone: row.timezone as string,
    payload: row.payload as Event['payload'],
    taskId: row.task_id as string | null,
    sessionId: row.session_id as string | null,
    dayPlanId: row.day_plan_id as string | null,
    energyRecordId: row.energy_record_id as string | null,
    unresolvedIntervalId: row.unresolved_interval_id as string | null,
    settingsId: row.settings_id as string | null,
    // 旧 Event 行没有这一列（append-only，迁移不改写历史），缺失即按 null 读。
    mergeGroupId: (row.merge_group_id as string | null | undefined) ?? null,
    correlationId: row.correlation_id as string | null,
  } as Event;
}
