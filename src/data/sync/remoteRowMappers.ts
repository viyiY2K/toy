/**
 * 本地实体（camelCase）→ 远端 Postgres 行（snake_case）字段映射（S4）。
 *
 * 每个实体一个显式映射分支，不做通用反射式驼峰转下划线——字段集合、类型转换需要
 * 显式可读，避免"某个字段改名后映射悄悄错位"这类问题难以在 review 中发现。
 * 远端表结构见 supabase/schema.sql，字段一一对应 docs/data-layer-spec-v4.md §3/§7。
 *
 * `syncedAt` 不出现在任何返回的行里：它是纯本地簿记字段，远端没有对应列（见 ADR-0035）。
 */

import { STORE, type SyncableEntityMap, type SyncableStoreName } from '../dataStore';
import type { Event } from '../schema';

export type RemoteEntityTableName =
  | 'tasks'
  | 'day_plans'
  | 'sessions'
  | 'energy_records'
  | 'unresolved_intervals'
  | 'settings';

export const REMOTE_TABLE_BY_STORE: Record<SyncableStoreName, RemoteEntityTableName> = {
  [STORE.tasks]: 'tasks',
  [STORE.dayPlans]: 'day_plans',
  [STORE.sessions]: 'sessions',
  [STORE.energyRecords]: 'energy_records',
  [STORE.unresolvedIntervals]: 'unresolved_intervals',
  [STORE.settings]: 'settings',
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
        task_id: session.taskId,
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
    session_id: event.sessionId,
    day_plan_id: event.dayPlanId,
    energy_record_id: event.energyRecordId,
    unresolved_interval_id: event.unresolvedIntervalId,
    settings_id: event.settingsId,
    correlation_id: event.correlationId,
  };
}
