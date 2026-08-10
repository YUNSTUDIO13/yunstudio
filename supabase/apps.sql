-- ============================================================
-- 个人工作台 · 应用（Apps）SQL
-- 适配依赖：schema.sql（已建 profiles + set_updated_at()）
-- 与 tags-dict.sql/business-tables.sql/news.sql 互不冲突，均使用 if not exists
-- 作用：存储用户个人应用导航（图标 / 名称 / 目标 URL / 功能说明），云端持久化供多端同步
-- ============================================================

-- ------------------------------------------------------------
-- apps：个人应用书签
--   - user_id：归属用户（RLS 按此隔离）
--   - name：应用名称
--   - target_url：点击图标跳转的目标地址
--   - description：功能说明
--   - icon_url：抓取到的图标地址（原站 favicon）；为空则前端用名称首字兜底
-- ------------------------------------------------------------
create table if not exists public.apps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,                       -- 应用名称
  target_url    text not null,                       -- 目标 URL
  description   text not null default '',            -- 功能说明
  icon_url      text,                                -- 图标地址（原站 favicon）；空→前端首字兜底
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists apps_user_idx
  on public.apps (user_id);

comment on table public.apps is '个人应用导航书签；用户私有，点击图标跳转目标 URL';

-- ============================================================
-- 行级安全（RLS）—— 直接按 user_id 隔离（apps 自带 user_id 列）
-- ============================================================
alter table public.apps enable row level security;

drop policy if exists "apps_select_own" on public.apps;
create policy "apps_select_own" on public.apps
  for select using (auth.uid() = user_id);

drop policy if exists "apps_insert_own" on public.apps;
create policy "apps_insert_own" on public.apps
  for insert with check (auth.uid() = user_id);

drop policy if exists "apps_update_own" on public.apps;
create policy "apps_update_own" on public.apps
  for update using (auth.uid() = user_id);

drop policy if exists "apps_delete_own" on public.apps;
create policy "apps_delete_own" on public.apps
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 更新时间自动维护
-- ============================================================
drop trigger if exists apps_set_updated_at on public.apps;
create trigger apps_set_updated_at
  before update on public.apps
  for each row execute function public.set_updated_at();

-- ============================================================
-- 实时同步（Realtime）—— 多端即时同步增删改
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apps'
  ) then
    alter publication supabase_realtime add table public.apps;
  end if;
end $$;
