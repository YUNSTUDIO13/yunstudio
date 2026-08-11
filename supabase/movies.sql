-- 观影模块（个人影视库 / 观影志）
-- 表 movies + RLS + updated_at 触发器 + Realtime 发布 + Storage bucket(movie-covers 封面手动上传)
-- 幂等：可重复执行（首次建表后再次执行仅补缺失对象，不报错）

create table if not exists public.movies (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  title               text not null,
  year                int,
  cover               text not null default '',
  personal_rating     numeric(3,1),              -- 个人评分 0–10
  third_party_rating  numeric(3,1),              -- 第三方评分（TMDB）0–10
  review              text not null default '',
  genre               text[] not null default '{}',
  region              text not null default '',
  duration            int not null default 0,    -- 分钟
  watched_at         date,
  synced              boolean not null default false,
  cover_failed        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists movies_user_id_idx on public.movies(user_id);
create index if not exists movies_updated_at_idx on public.movies(updated_at desc);

alter table public.movies enable row level security;

drop policy if exists movies_select on public.movies;
create policy movies_select on public.movies
  for select using (auth.uid() = user_id);

drop policy if exists movies_insert on public.movies;
create policy movies_insert on public.movies
  for insert with check (auth.uid() = user_id);

drop policy if exists movies_update on public.movies;
create policy movies_update on public.movies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists movies_delete on public.movies;
create policy movies_delete on public.movies
  for delete using (auth.uid() = user_id);

-- updated_at 自动刷新（通用函数，若其他模块已建则 create or replace 不冲突）
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists movies_set_updated_at on public.movies;
create trigger movies_set_updated_at
  before update on public.movies
  for each row execute function public.set_updated_at();

-- Realtime：幂等加入发布（避免重复 add 报错）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movies'
  ) then
    execute 'alter publication supabase_realtime add table public.movies';
  end if;
end $$;

-- Storage bucket：封面手动上传（公开读，仅本人可写/删，路径第一层 = user_id）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('movie-covers', 'movie-covers', true, 5242880, '{image/png,image/jpeg,image/webp,image/gif}')
on conflict (id) do nothing;

drop policy if exists movie_covers_insert on storage.objects;
create policy movie_covers_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'movie-covers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists movie_covers_select on storage.objects;
create policy movie_covers_select on storage.objects
  for select to authenticated
  using (bucket_id = 'movie-covers');

drop policy if exists movie_covers_delete on storage.objects;
create policy movie_covers_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'movie-covers' and (storage.foldername(name))[1] = auth.uid()::text);
