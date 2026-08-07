-- ============================================================
-- 个人工作台 · 数据自检 + 兜底修复
-- 适用症状：「账号 / 头像 / 资料 看起来没了」
--
-- 背景：
--   1) schema.sql 中 profiles 表的「on auth.users insert」触发器只为新注册账号建 profile 行
--   2) 若 Supabase 项目被重置、或历史账号从未补过 profile 行，会出现：
--        auth.users 里有行，但 public.profiles 里没有
--      → 前端读不到资料 / avatar_url / title / department / bio
--   3) profile-avatar.sql 已包含一次兜底补建；本脚本可作为「现场急救版」再次执行
--
-- 本脚本全程：诊断 → 兜底 → 重建策略 → 再诊断，无破坏性更新，可重复执行。
-- 全部操作走 service_role / postgres 角色，绕过 RLS。
-- ============================================================


-- ----------------------------------------------------------------
-- 步骤 1：自检（只读，无副作用）
-- 把以下 3 段当一个 Run 执行，截图最后一段的结果发我即可
-- ----------------------------------------------------------------

-- 1.1 计数对比
select 'auth.users 行数'      as 指标, count(*)::text as 值 from auth.users
union all
select 'public.profiles 行数', count(*)::text         from public.profiles
union all
select 'storage.objects 头像数',
       count(*)::text
from storage.objects
where bucket_id = 'avatars';

-- 1.2 每个账号是否都有 profile 行（含诊断结论）
select
  u.id::text                                     as user_id,
  u.email                                        as 邮箱,
  to_char(u.created_at, 'YYYY-MM-DD HH24:MI')     as 注册时间,
  p.id is not null                               as "有 profile 行",
  coalesce(p.display_name, '—')                  as 昵称,
  coalesce(p.title, '—')                         as 职位,
  coalesce(p.department, '—')                    as 部门,
  coalesce(p.avatar_url, '—')                    as 头像URL
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;

-- 1.3 profiles 表结构自检（确认扩字段真的存在）
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;


-- ----------------------------------------------------------------
-- 步骤 2：兜底 —— 为所有缺 profile 行的 auth.users 补建
-- 用 ON CONFLICT DO NOTHING 保护已有行；可重复跑
-- ----------------------------------------------------------------
insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  split_part(u.email, '@', 1)
from auth.users u
on conflict (id) do nothing;


-- ----------------------------------------------------------------
-- 步骤 3：兜底 —— 重建 profiles 扩展字段（title/department/bio）
-- 防御性 add column if not exists，绝不破坏既有数据
-- ----------------------------------------------------------------
alter table public.profiles add column if not exists title       text;
alter table public.profiles add column if not exists department  text;
alter table public.profiles add column if not exists bio         text;


-- ----------------------------------------------------------------
-- 步骤 4：兜底 —— 重建 avatars 存储桶与策略
-- 若 bucket 被误删 / 策略丢失，自助修复
-- ----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_insert_own"  on storage.objects;
drop policy if exists "avatars_update_own"  on storage.objects;
drop policy if exists "avatars_delete_own"  on storage.objects;

create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_insert_own"  on storage.objects for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatars_update_own"  on storage.objects for update using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatars_delete_own"  on storage.objects for delete using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);


-- ----------------------------------------------------------------
-- 步骤 5：再自检（看是否补上）
-- ----------------------------------------------------------------
select
  u.email                                        as 邮箱,
  p.display_name                                 as 昵称,
  p.title                                        as 职位,
  p.department                                   as 部门,
  coalesce(p.bio, '—')                           as 签名,
  coalesce(p.avatar_url, '—')                    as 头像URL
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;
