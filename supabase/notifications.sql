-- 通知表（notifications）—— 实体截止时间到期时建一条；
-- 用户可在通知中心查看并标记已读。
-- 同一 (user_id, entity_type, entity_id) 至多一条未读通知；
-- 该实体到期后被标记已读，若再次到期，可重建一条新的未读通知。
create table if not exists public.notifications (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  entity_type   text not null check (entity_type in ('todo', 'sprint')),
  entity_id     text not null,
  entity_title  text not null,
  deadline_at   timestamptz not null,
  kind          text not null default 'expired' check (kind in ('expired')),
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 索引：按用户过滤 + 按 created_at 排序 + 按 entity 索引
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_entity_idx
  on public.notifications (user_id, entity_type, entity_id);

-- updated_at 自动维护（INSERT 时设值；UPDATE 时让客户端带值后写入，
-- 触发器见 set_updated_at 公共函数，已在 schema.sql 定义 —— 这里复用它）
drop trigger if exists notifications_set_updated_at on public.notifications;
create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

-- ====== RLS ======
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id)
                with check (auth.uid() = user_id);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

-- 开启 Realtime（让通知在多 PC / 多标签页间秒级同步）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end$$;
