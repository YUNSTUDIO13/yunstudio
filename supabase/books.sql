-- 阅读模块（个人书库 / 阅读志）
-- 表 books + RLS + updated_at 触发器 + Realtime 发布 + Storage bucket(book-covers 封面手动上传)
-- 与 movies 的差异：去掉 backdrop / region / duration / cast；新增 author(作者) / read_at(阅读日期) / read_count(阅读次数)
-- 幂等：可重复执行（首次建表后再次执行仅补缺失对象，不报错）

create table if not exists public.books (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  title               text not null,
  year                int,
  cover               text not null default '',
  personal_rating     numeric(3,1),              -- 个人评分 0–10
  third_party_rating  numeric(3,1),              -- 第三方评分（Google Books）0–10
  review              text not null default '',
  overview            text not null default '',  -- 简介
  author              text not null default '',  -- 作者（多作者以「、」分隔）
  genre               text[] not null default '{}',
  read_at             date,                      -- 阅读日期（YYYY-MM-DD）
  read_count          int not null default 0,    -- 阅读次数
  synced              boolean not null default false,
  cover_failed        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists books_user_id_idx on public.books(user_id);
create index if not exists books_updated_at_idx on public.books(updated_at desc);

alter table public.books enable row level security;

drop policy if exists books_select on public.books;
create policy books_select on public.books
  for select using (auth.uid() = user_id);

drop policy if exists books_insert on public.books;
create policy books_insert on public.books
  for insert with check (auth.uid() = user_id);

drop policy if exists books_update on public.books;
create policy books_update on public.books
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists books_delete on public.books;
create policy books_delete on public.books
  for delete using (auth.uid() = user_id);

-- updated_at 自动刷新（通用函数，若其他模块已建则 create or replace 不冲突）
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_set_updated_at on public.books;
create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

-- Realtime：幂等加入发布（避免重复 add 报错）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'books'
  ) then
    execute 'alter publication supabase_realtime add table public.books';
  end if;
end $$;

-- Storage bucket：封面手动上传（公开读，仅本人可写/删，路径第一层 = user_id）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-covers', 'book-covers', true, 5242880, '{image/png,image/jpeg,image/webp,image/gif}')
on conflict (id) do nothing;

drop policy if exists book_covers_insert on storage.objects;
create policy book_covers_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'book-covers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists book_covers_select on storage.objects;
create policy book_covers_select on storage.objects
  for select to authenticated
  using (bucket_id = 'book-covers');

drop policy if exists book_covers_delete on storage.objects;
create policy book_covers_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'book-covers' and (storage.foldername(name))[1] = auth.uid()::text);
