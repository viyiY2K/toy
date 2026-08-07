-- 多端同步（Phase 5）S2：远端表结构 + 索引 + RLS
--
-- 权威数据字典：docs/data-layer-spec-v4.md §3（各实体字段表）、§7（Event 枚举）。
-- 本脚本只做"基本形状防御"（必填/可空、CHECK 约束覆盖已知枚举值），
-- 不复刻本地 validation 层的完整业务规则（跨字段一致性、状态机流转等）——
-- 那些规则的唯一权威实现仍是 src/data/validation/*.ts，本脚本不重复维护第二份。
--
-- 命名约定：远端列名一律 snake_case（PostgREST/Supabase 惯例），
-- 本地 TS 字段名一律 camelCase；两者的映射在 S4/S5 的同步引擎代码里做，不在这里做。
--
-- 在 Supabase 控制台 → SQL Editor 里粘贴执行一次即可。可重复执行（每条语句都有
-- if not exists / or replace 保护），不会因为重复跑报错。

-- ============================================================
-- 1. tasks
-- ============================================================
create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  schema_version int not null,
  deleted_at timestamptz,
  device_id uuid,

  parent_id uuid,
  title text not null,
  status text not null check (status in ('active','completed','splitNeeded','archived','deleted')),
  outcome text check (outcome in ('completed','split')),
  completion_source text check (completion_source in ('pomodoro','manual')),
  estimated_pomodoros int not null,
  estimate_rounds jsonb not null,
  actual_work_note text,
  note text,
  sort_index double precision not null,
  completed_at timestamptz,
  archived_at timestamptz,
  deleted_reason text check (deleted_reason in ('userDeleted','triageDismissed','dataCleanup')),
  metadata jsonb not null,
  lineage_id uuid not null,
  split_from_task_id uuid,
  split_index int not null
);

create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at);

-- ============================================================
-- 2. day_plans
-- ============================================================
create table if not exists public.day_plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  schema_version int not null,
  deleted_at timestamptz,
  device_id uuid,

  app_date date not null,
  local_date date not null,
  timezone text not null,
  task_ids jsonb not null,
  budget_pomodoros int not null,
  budget_mode text not null check (budget_mode in ('conservative','optimistic','manual')),
  estimate jsonb not null,
  settings_snapshot jsonb not null
);

create index if not exists day_plans_user_updated_idx on public.day_plans (user_id, updated_at);

-- 同一用户同一产品日，最多一条未软删除的 DayPlan（对应本地唯一性约束，v4 §3.2）。
create unique index if not exists day_plans_user_appdate_active
  on public.day_plans (user_id, app_date)
  where deleted_at is null;

-- ============================================================
-- 3. sessions
-- ============================================================
create table if not exists public.sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  schema_version int not null,
  deleted_at timestamptz,
  device_id uuid,

  type text not null check (type in ('focus','shortBreak','longBreak','extraFocus','extraRest')),
  status text not null check (status in ('active','completed','discarded','skipped')),
  task_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  planned_duration int,
  actual_duration int,
  pomodoro_index int,
  skip_kind text check (skip_kind in ('explicitSkip','noResponse','appClosed','missed')),
  origin_interval_id uuid,
  source_focus_session_id uuid,
  suggested_rest text,
  actual_rest text,
  local_date date not null,
  timezone text not null,
  day_plan_id uuid
);

create index if not exists sessions_user_updated_idx on public.sessions (user_id, updated_at);

-- ============================================================
-- 4. energy_records
-- ============================================================
create table if not exists public.energy_records (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  schema_version int not null,
  deleted_at timestamptz,
  device_id uuid,

  energy_level int not null,
  mood int,
  source text not null check (source in (
    'dayStart','beforeFocus','afterFocus','afterShortBreak','afterLongBreak',
    'afterExtraFocus','afterExtraRest','onReturn','manual'
  )),
  session_id uuid,
  note text,
  occurred_at timestamptz not null,
  local_date date not null,
  timezone text not null
);

create index if not exists energy_records_user_updated_idx on public.energy_records (user_id, updated_at);

-- ============================================================
-- 5. unresolved_intervals
-- ============================================================
create table if not exists public.unresolved_intervals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  schema_version int not null,
  deleted_at timestamptz,
  device_id uuid,

  source text not null check (source in ('appReopened','systemRecovered','timerStateLost','userNoResponse')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  status text not null check (status in ('pending','classified','ignored')),
  local_date date not null,
  timezone text not null,
  classified_at timestamptz,
  ignored_at timestamptz,
  ignore_reason text
);

create index if not exists unresolved_intervals_user_updated_idx on public.unresolved_intervals (user_id, updated_at);

-- ============================================================
-- 6. settings（单例：每个用户最多一条未软删除的记录）
-- ============================================================
create table if not exists public.settings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  schema_version int not null,
  deleted_at timestamptz,
  device_id uuid,

  focus_minutes int not null,
  short_break_minutes int not null,
  long_break_minutes int not null,
  long_break_every int not null,
  rest_suggestions jsonb not null,
  daily_task_templates jsonb not null,
  lifetime_pomodoro_baseline int not null,
  rest_suggestion_display_mode text not null check (rest_suggestion_display_mode in ('customOrder','usageFrequency')),
  app_day_start_offset_minutes int not null
);

create index if not exists settings_user_updated_idx on public.settings (user_id, updated_at);

create unique index if not exists settings_user_singleton_active
  on public.settings (user_id)
  where deleted_at is null;

-- ============================================================
-- 7. events（append-only：不建 updated_at/deleted_at/device_id/synced_at，
--    物理上不给"修改/删除历史事件"留任何位置）
-- ============================================================
create table if not exists public.events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  schema_version int not null,

  type text not null,
  occurred_at timestamptz not null,
  local_date date not null,
  timezone text not null,
  payload jsonb not null,

  task_id uuid,
  session_id uuid,
  day_plan_id uuid,
  energy_record_id uuid,
  unresolved_interval_id uuid,
  settings_id uuid,
  correlation_id uuid
);

create index if not exists events_user_created_idx on public.events (user_id, created_at);

-- ============================================================
-- Row Level Security：每张表只允许访问自己的行；六张实体表禁止物理删除，
-- events 额外禁止修改——都在数据库层面物理拒绝，不依赖前端"不这么做"的自觉。
-- ============================================================

alter table public.tasks enable row level security;
alter table public.day_plans enable row level security;
alter table public.sessions enable row level security;
alter table public.energy_records enable row level security;
alter table public.unresolved_intervals enable row level security;
alter table public.settings enable row level security;
alter table public.events enable row level security;

-- 六张可同步实体表：select / insert / update 允许，delete 一律拒绝（软删除代替物理删除）。
do $$
declare
  t text;
begin
  foreach t in array array['tasks','day_plans','sessions','energy_records','unresolved_intervals','settings']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_delete', t);

    execute format(
      'create policy %I on public.%I for select using (user_id = auth.uid())',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (user_id = auth.uid())',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on public.%I for delete using (false)',
      t || '_no_delete', t
    );
  end loop;
end $$;

-- events：只允许 select / insert，update / delete 物理禁止（append-only 契约落地在数据库层）。
drop policy if exists events_select_own on public.events;
drop policy if exists events_insert_own on public.events;
drop policy if exists events_no_update on public.events;
drop policy if exists events_no_delete on public.events;

create policy events_select_own on public.events
  for select using (user_id = auth.uid());
create policy events_insert_own on public.events
  for insert with check (user_id = auth.uid());
create policy events_no_update on public.events
  for update using (false);
create policy events_no_delete on public.events
  for delete using (false);
