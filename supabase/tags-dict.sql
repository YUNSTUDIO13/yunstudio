-- ============================================================
-- 个人工作台 · 字典管理（标签字段）SQL
-- 适配依赖：schema.sql（已建 profiles + set_updated_at()）
-- 与 schema.sql/business-tables.sql/news.sql 互不冲突，均使用 if not exists
-- ============================================================

-- ------------------------------------------------------------
-- 1) tag_categories：字段名（类目）
--    例如"标签""优先级""受理人"等所有需要枚举约束的字段
--    当前主用"标签"，未来可继续扩展
-- ------------------------------------------------------------
create table if not exists public.tag_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,                       -- e.g. "标签"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)                           -- 同用户字段名不可重
);

create index if not exists tag_categories_user_idx
  on public.tag_categories (user_id);

comment on table public.tag_categories is '字典：字段名（类目）；用户私有；当前主用"标签"';

-- ------------------------------------------------------------
-- 2) tag_values：某字段名下的所有可选值
--    例如 "标签" → ["紧急"、"阻塞"、"后续处理"、"P0"]
-- ------------------------------------------------------------
create table if not exists public.tag_values (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.tag_categories (id) on delete cascade,
  value        text not null,                      -- 枚举值文本
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (category_id, value)                      -- 同字段名下值不可重
);

create index if not exists tag_values_category_idx
  on public.tag_values (category_id);

comment on table public.tag_values is '字典：某字段名下的枚举值；删除 category 级联删除';

-- ------------------------------------------------------------
-- 3) 四业务表加 tag_id（可空）
--    - nullable：标签是可选字段，旧数据无标签也合法
--    - ON DELETE SET NULL：删除枚举值时清掉引用，业务数据保留
-- ------------------------------------------------------------

-- todos
alter table public.todos add column if not exists tag_id uuid
  references public.tag_values (id) on delete set null;
create index if not exists todos_tag_idx on public.todos (tag_id);

-- requirements
alter table public.requirements add column if not exists tag_id uuid
  references public.tag_values (id) on delete set null;
create index if not exists requirements_tag_idx on public.requirements (tag_id);

-- sprints
alter table public.sprints add column if not exists tag_id uuid
  references public.tag_values (id) on delete set null;
create index if not exists sprints_tag_idx on public.sprints (tag_id);

-- bugs
alter table public.bugs add column if not exists tag_id uuid
  references public.tag_values (id) on delete set null;
create index if not exists bugs_tag_idx on public.bugs (tag_id);

-- ============================================================
-- 4) 行级安全（RLS）
-- ============================================================
alter table public.tag_categories enable row level security;
alter table public.tag_values     enable row level security;

drop policy if exists "tag_categories_select_own" on public.tag_categories;
create policy "tag_categories_select_own" on public.tag_categories
  for select using (auth.uid() = user_id);
drop policy if exists "tag_categories_insert_own" on public.tag_categories;
create policy "tag_categories_insert_own" on public.tag_categories
  for insert with check (auth.uid() = user_id);
drop policy if exists "tag_categories_update_own" on public.tag_categories;
create policy "tag_categories_update_own" on public.tag_categories
  for update using (auth.uid() = user_id);
drop policy if exists "tag_categories_delete_own" on public.tag_categories;
create policy "tag_categories_delete_own" on public.tag_categories
  for delete using (auth.uid() = user_id);

drop policy if exists "tag_values_select_all_own" on public.tag_values;
create policy "tag_values_select_all_own" on public.tag_values
  for select using (
    exists (
      select 1 from public.tag_categories c
      where c.id = tag_values.category_id and c.user_id = auth.uid()
    )
  );
drop policy if exists "tag_values_insert_own" on public.tag_values;
create policy "tag_values_insert_own" on public.tag_values
  for insert with check (
    exists (
      select 1 from public.tag_categories c
      where c.id = tag_values.category_id and c.user_id = auth.uid()
    )
  );
drop policy if exists "tag_values_update_own" on public.tag_values;
create policy "tag_values_update_own" on public.tag_values
  for update using (
    exists (
      select 1 from public.tag_categories c
      where c.id = tag_values.category_id and c.user_id = auth.uid()
    )
  );
drop policy if exists "tag_values_delete_own" on public.tag_values;
create policy "tag_values_delete_own" on public.tag_values
  for delete using (
    exists (
      select 1 from public.tag_categories c
      where c.id = tag_values.category_id and c.user_id = auth.uid()
    )
  );

-- ============================================================
-- 5) 更新时间自动维护
-- ============================================================
drop trigger if exists tag_categories_set_updated_at on public.tag_categories;
create trigger tag_categories_set_updated_at
  before update on public.tag_categories
  for each row execute function public.set_updated_at();

drop trigger if exists tag_values_set_updated_at on public.tag_values;
create trigger tag_values_set_updated_at
  before update on public.tag_values
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6) 实时同步（Realtime）
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tag_categories'
  ) then
    alter publication supabase_realtime add table public.tag_categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tag_values'
  ) then
    alter publication supabase_realtime add table public.tag_values;
  end if;
end $$;
