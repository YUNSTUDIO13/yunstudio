-- ============================================================
-- 个人工作台 · 个人主页扩展（profiles 扩展字段 + avatars 头像存储桶）
-- 在 Supabase 控制台 → SQL Editor 执行（依赖 schema.sql 已建 profiles 与 set_updated_at）
-- 本脚本可重复执行（全部 if not exists / drop if exists / on conflict）
-- ============================================================

-- ---------- 1) profiles 扩展字段：职位 / 部门 / 个性签名 ----------
alter table public.profiles add column if not exists title       text;
alter table public.profiles add column if not exists department  text;
alter table public.profiles add column if not exists bio         text;

comment on column public.profiles.display_name is '昵称，展示在头像旁与顶栏';
comment on column public.profiles.avatar_url   is '头像公开 URL（Storage avatars 桶）';
comment on column public.profiles.title        is '职位，如「产品经理」';
comment on column public.profiles.department   is '部门，如「增长产品部」';
comment on column public.profiles.bio          is '个性签名 / 简介，多行文本';

-- ---------- 2) 兜底：为历史用户补建 profile 行 ----------
-- schema.sql 的触发器只对「新注册」生效，老账号可能没有 profile 行
insert into public.profiles (id, email, display_name)
select u.id, u.email, split_part(u.email, '@', 1)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ---------- 3) profiles 开启 Realtime（多 PC 头像/资料秒级同步） ----------
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when others then null;
end $$;

-- ---------- 4) 头像存储桶 avatars ----------
-- public = true：头像走 CDN 公开读，前端直接用 getPublicUrl
-- file_size_limit = 2MB：前端已压缩到 ~100KB，这里只是服务端兜底
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- 5) 存储对象策略：公开读，仅本人可写自己的目录 ----------
-- 文件路径约定：avatars/{auth.uid()}/avatar.webp
-- storage.foldername(name))[1] 取出第一级目录名，必须等于当前用户 id

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
