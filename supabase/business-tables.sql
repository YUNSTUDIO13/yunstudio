-- ============================================================
-- 个人工作台 · 业务表（在 Supabase 控制台 → SQL Editor 执行）
-- 5 张真实业务表：todos / requirements / sprints / bugs / kpis
-- 对应前端的 Todos / Requirements / Sprints / Bugs / Kpis 模块
-- 依赖 schema.sql 已执行的 set_updated_at() 函数与 profiles 表
-- 列定义与 src/types.ts 一一对应，便于前端直连
-- ============================================================

-- ------------------------------------------------------------
-- 1) todos 待办
-- ------------------------------------------------------------
create table if not exists public.todos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  source_url   text,
  priority     text not null default 'P2',           -- P0 | P1 | P2 | P3
  deadline_at  timestamptz,
  note         text,
  done         boolean not null default false,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists todos_user_created_idx
  on public.todos (user_id, created_at desc);

comment on table public.todos is '个人待办；Score 由前端按 (4-优先级)×30 + max(0,72-距截止小时) 计算，仅本人可读写';

-- ------------------------------------------------------------
-- 2) requirements 需求（8 态状态机）
-- ------------------------------------------------------------
create table if not exists public.requirements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  priority     text not null default 'P2',           -- P0 | P1 | P2 | P3
  status       text not null default 'draft',        -- draft|review|scheduled|dev|test|launched|hold|void
  value_desc   text not null default '',              -- 业务价值说明（此处明文，生产可 pgcrypto 加密）
  source_url   text,
  owner        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists requirements_user_created_idx
  on public.requirements (user_id, created_at desc);

comment on table public.requirements is '需求池；8 态状态机，仅本人可读写';

-- ------------------------------------------------------------
-- 3) sprints 迭代
-- ------------------------------------------------------------
create table if not exists public.sprints (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  goal         text not null default '',
  status       text not null default 'planning',      -- planning|active|closing|done|cancelled
  start_date   date,
  end_date     date,
  progress     int not null default 0,                 -- 0-100
  burndown     int[] not null default '{}',            -- 剩余工作量序列（燃尽图）
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists sprints_user_created_idx
  on public.sprints (user_id, created_at desc);

comment on table public.sprints is '迭代/冲刺；含燃尽序列，仅本人可读写';

-- ------------------------------------------------------------
-- 4) bugs 缺陷
-- ------------------------------------------------------------
create table if not exists public.bugs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  severity     text not null default 'normal',         -- critical|major|normal|minor
  priority     text not null default 'P2',             -- P0 | P1 | P2 | P3
  status       text not null default 'open',           -- open|in_progress|verifying|closed
  reporter     text,
  source_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists bugs_user_created_idx
  on public.bugs (user_id, created_at desc);

comment on table public.bugs is '缺陷跟踪；严重度/优先级/状态，仅本人可读写';

-- ------------------------------------------------------------
-- 5) kpis 指标
-- ------------------------------------------------------------
create table if not exists public.kpis (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  category      text not null default 'business',      -- business|efficiency|quality|growth
  value         numeric not null default 0,
  unit          text not null default '',
  target        numeric not null default 0,
  trend         numeric[] not null default '{}',        -- 近期数值序列（迷你趋势线）
  lower_is_better boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists kpis_user_created_idx
  on public.kpis (user_id, created_at desc);

comment on table public.kpis is '关键指标；趋势序列用于迷你折线，仅本人可读写';

-- ============================================================
-- 行级安全（RLS）：所有访问必须经过策略，owner = auth.uid()
-- ============================================================
alter table public.todos         enable row level security;
alter table public.requirements  enable row level security;
alter table public.sprints       enable row level security;
alter table public.bugs          enable row level security;
alter table public.kpis          enable row level security;

-- todos
drop policy if exists "todos_select_own" on public.todos;
create policy "todos_select_own" on public.todos
  for select using (auth.uid() = user_id);
drop policy if exists "todos_insert_own" on public.todos;
create policy "todos_insert_own" on public.todos
  for insert with check (auth.uid() = user_id);
drop policy if exists "todos_update_own" on public.todos;
create policy "todos_update_own" on public.todos
  for update using (auth.uid() = user_id);
drop policy if exists "todos_delete_own" on public.todos;
create policy "todos_delete_own" on public.todos
  for delete using (auth.uid() = user_id);

-- requirements
drop policy if exists "requirements_select_own" on public.requirements;
create policy "requirements_select_own" on public.requirements
  for select using (auth.uid() = user_id);
drop policy if exists "requirements_insert_own" on public.requirements;
create policy "requirements_insert_own" on public.requirements
  for insert with check (auth.uid() = user_id);
drop policy if exists "requirements_update_own" on public.requirements;
create policy "requirements_update_own" on public.requirements
  for update using (auth.uid() = user_id);
drop policy if exists "requirements_delete_own" on public.requirements;
create policy "requirements_delete_own" on public.requirements
  for delete using (auth.uid() = user_id);

-- sprints
drop policy if exists "sprints_select_own" on public.sprints;
create policy "sprints_select_own" on public.sprints
  for select using (auth.uid() = user_id);
drop policy if exists "sprints_insert_own" on public.sprints;
create policy "sprints_insert_own" on public.sprints
  for insert with check (auth.uid() = user_id);
drop policy if exists "sprints_update_own" on public.sprints;
create policy "sprints_update_own" on public.sprints
  for update using (auth.uid() = user_id);
drop policy if exists "sprints_delete_own" on public.sprints;
create policy "sprints_delete_own" on public.sprints
  for delete using (auth.uid() = user_id);

-- bugs
drop policy if exists "bugs_select_own" on public.bugs;
create policy "bugs_select_own" on public.bugs
  for select using (auth.uid() = user_id);
drop policy if exists "bugs_insert_own" on public.bugs;
create policy "bugs_insert_own" on public.bugs
  for insert with check (auth.uid() = user_id);
drop policy if exists "bugs_update_own" on public.bugs;
create policy "bugs_update_own" on public.bugs
  for update using (auth.uid() = user_id);
drop policy if exists "bugs_delete_own" on public.bugs;
create policy "bugs_delete_own" on public.bugs
  for delete using (auth.uid() = user_id);

-- kpis
drop policy if exists "kpis_select_own" on public.kpis;
create policy "kpis_select_own" on public.kpis
  for select using (auth.uid() = user_id);
drop policy if exists "kpis_insert_own" on public.kpis;
create policy "kpis_insert_own" on public.kpis
  for insert with check (auth.uid() = user_id);
drop policy if exists "kpis_update_own" on public.kpis;
create policy "kpis_update_own" on public.kpis
  for update using (auth.uid() = user_id);
drop policy if exists "kpis_delete_own" on public.kpis;
create policy "kpis_delete_own" on public.kpis
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 更新时间自动维护（复用 schema.sql 中的 set_updated_at）
-- ============================================================
drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();

drop trigger if exists requirements_set_updated_at on public.requirements;
create trigger requirements_set_updated_at
  before update on public.requirements
  for each row execute function public.set_updated_at();

drop trigger if exists sprints_set_updated_at on public.sprints;
create trigger sprints_set_updated_at
  before update on public.sprints
  for each row execute function public.set_updated_at();

drop trigger if exists bugs_set_updated_at on public.bugs;
create trigger bugs_set_updated_at
  before update on public.bugs
  for each row execute function public.set_updated_at();

drop trigger if exists kpis_set_updated_at on public.kpis;
create trigger kpis_set_updated_at
  before update on public.kpis
  for each row execute function public.set_updated_at();

-- ============================================================
-- 开启 Realtime（多 PC / 其它端改动后秒级刷新）
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table public.todos;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.requirements;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sprints;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bugs;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.kpis;
exception when others then null;
end $$;
