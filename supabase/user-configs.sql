-- ============================================================
-- 个人工作台 · 用户配置表（导航关系 + 主页卡片配置 共用）
-- 在 Supabase 控制台 → SQL Editor 执行（依赖 schema.sql 的 set_updated_at()）
-- 说明：导航配置 / 主页卡片配置都是用户个性化数据，原存 localStorage；
--      现统一上云实现多 PC 互通。一张表用 kind 区分，避免冗余建表。
-- ============================================================

create table if not exists public.user_configs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,                     -- 'nav' | 'dashboard'
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create index if not exists user_configs_user_kind_idx
  on public.user_configs (user_id, kind);

comment on table public.user_configs is
  '用户个性化配置（导航关系 / 主页卡片），按 user_id+kind 唯一，仅本人可读写';

-- 行级安全：owner = auth.uid()
alter table public.user_configs enable row level security;

drop policy if exists "user_configs_select_own" on public.user_configs;
create policy "user_configs_select_own" on public.user_configs
  for select using (auth.uid() = user_id);

drop policy if exists "user_configs_insert_own" on public.user_configs;
create policy "user_configs_insert_own" on public.user_configs
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_configs_update_own" on public.user_configs;
create policy "user_configs_update_own" on public.user_configs
  for update using (auth.uid() = user_id);

drop policy if exists "user_configs_delete_own" on public.user_configs;
create policy "user_configs_delete_own" on public.user_configs
  for delete using (auth.uid() = user_id);

-- 更新时间自动维护（复用 schema.sql 中的 set_updated_at）
drop trigger if exists user_configs_set_updated_at on public.user_configs;
create trigger user_configs_set_updated_at
  before update on public.user_configs
  for each row execute function public.set_updated_at();

-- 开启 Realtime（让导航 / 主页卡片配置在多 PC 间秒级同步）
do $$
begin
  alter publication supabase_realtime add table public.user_configs;
exception when others then null;
end $$;
