-- ============================================================
-- 个人工作台 · 新闻/资讯表（在 Supabase 控制台 → SQL Editor 执行）
-- 首张真实业务表：由「每周全球消费趋势数据更新报表」等任务推送，或手动新增
-- 依赖 schema.sql 已执行的 set_updated_at() 函数
-- ============================================================

create table if not exists public.news (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  summary      text not null default '',
  content      text not null default '',
  category     text not null default 'general',
  report_type  text not null default 'manual',
  tags         text[] not null default '{}',
  source_links jsonb not null default '[]'::jsonb,
  period_start date,
  period_end   date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists news_user_created_idx
  on public.news (user_id, created_at desc);

comment on table public.news is '资讯/报表聚合；由自动化推送或手动新增，仅本人可读写';

-- 行级安全：owner = auth.uid()
alter table public.news enable row level security;

drop policy if exists "news_select_own" on public.news;
create policy "news_select_own" on public.news
  for select using (auth.uid() = user_id);

drop policy if exists "news_insert_own" on public.news;
create policy "news_insert_own" on public.news
  for insert with check (auth.uid() = user_id);

drop policy if exists "news_update_own" on public.news;
create policy "news_update_own" on public.news
  for update using (auth.uid() = user_id);

drop policy if exists "news_delete_own" on public.news;
create policy "news_delete_own" on public.news
  for delete using (auth.uid() = user_id);

-- 更新时间自动维护（复用 schema.sql 中的 set_updated_at）
drop trigger if exists news_set_updated_at on public.news;
create trigger news_set_updated_at
  before update on public.news
  for each row execute function public.set_updated_at();

-- 开启 Realtime（让 News 模块在自动化推送后秒级刷新；已加入则忽略报错）
do $$
begin
  alter publication supabase_realtime add table public.news;
exception when others then null;
end $$;
