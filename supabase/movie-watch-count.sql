-- ============================================================
-- 观影次数 + 预约观看联动待办
-- 观影模块与待办模块跨模块联动：
--   · movies 增加 view_count（观影次数）
--   · todos 增加 movie_id（绑定电影）+ counted_at（计数守卫，去重用）
-- 在 Supabase 控制台 → SQL Editor 执行本文件即可（幂等，可重复跑）。
-- 依赖：business-tables.sql（todos/movies 表已存在）、movies.sql（movies 表）
-- ============================================================

-- 1) movies：观影次数
alter table public.movies
  add column if not exists view_count integer not null default 0;

-- 2) todos：绑定电影 + 计数守卫
alter table public.todos
  add column if not exists movie_id uuid
    references public.movies (id) on delete set null;

alter table public.todos
  add column if not exists counted_at timestamptz;

-- 索引：按电影查待办（联动计数 / 列表展示）
create index if not exists idx_todos_movie_id
  on public.todos (movie_id);

-- 注释：便于后续维护者理解这两列的用途
comment on column public.todos.movie_id is '绑定的观影电影 id（预约观看联动用）；为空表示普通待办';
comment on column public.todos.counted_at is '计数守卫：完成并已计入观影次数的时间戳；用于去重（取消再勾选不累加）';
comment on column public.movies.view_count is '观影次数；预约观看待办被勾选完成时 +1，可累计';
