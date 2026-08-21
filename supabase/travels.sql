-- 旅行模块（个人旅行志 / 中国地图点亮 / 行程时间轴）
-- 表 travels + RLS + updated_at 触发器 + Realtime 发布
-- 与 movies/books 的差异：
--   1) 封面 cover 为「用户上传后压缩的内联 data URL」，直接以 text 列落库，**不依赖 Storage bucket**；
--   2) 行程 days 为嵌套 JSON（每天含若干 items），整段以 jsonb 列存储，不拆子表；
--   3) start_date / end_date 以 text(YYYY-MM-DD) 存储，前端做字符串比对与 JS 日期运算，避免时区歧义；
--   4) id 由前端 crypto.randomUUID() 生成（uuid v4 字符串），与 movies/books 同款。
-- 幂等：可重复执行（首次建表后再次执行仅补缺失对象，不报错）。

create table if not exists public.travels (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null default '',            -- 行程标题（如「长沙 3 天 2 夜」）
  city             text not null default '',            -- 目的地城市名
  province_adcode  text not null default '',            -- 省级行政区 adcode（地图点亮反查键）
  province_name    text not null default '',            -- 省级行政区名称
  emoji            text not null default '',            -- 情绪/主题 emoji
  start_date       text not null default '',            -- 出发日 YYYY-MM-DD
  end_date         text not null default '',            -- 返程日 YYYY-MM-DD
  cover            text not null default '',            -- 封面图（用户上传压缩后的 data URL，内联存储）
  days             jsonb not null default '[]'::jsonb,  -- 行程时间轴：[{ items:[{id,time,type,title,note,img}] }]
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists travels_user_id_idx on public.travels(user_id);
create index if not exists travels_updated_at_idx on public.travels(updated_at desc);
create index if not exists travels_province_idx on public.travels(province_adcode);

alter table public.travels enable row level security;

drop policy if exists travels_select on public.travels;
create policy travels_select on public.travels
  for select using (auth.uid() = user_id);

drop policy if exists travels_insert on public.travels;
create policy travels_insert on public.travels
  for insert with check (auth.uid() = user_id);

drop policy if exists travels_update on public.travels;
create policy travels_update on public.travels
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists travels_delete on public.travels;
create policy travels_delete on public.travels
  for delete using (auth.uid() = user_id);

-- updated_at 自动刷新（通用函数，若其他模块已建则 create or replace 不冲突）
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists travels_set_updated_at on public.travels;
create trigger travels_set_updated_at
  before update on public.travels
  for each row execute function public.set_updated_at();

-- Realtime：幂等加入发布（避免重复 add 报错）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'travels'
  ) then
    execute 'alter publication supabase_realtime add table public.travels';
  end if;
end $$;
