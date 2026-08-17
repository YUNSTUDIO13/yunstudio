-- supabase/supabase-usage.sql
-- 首页 Supabase 用量看板 · 两个 SECURITY DEFINER RPC
-- ============================================================================
-- 供 supabase-usage Edge Function 用 service_role 调取数据库与存储用量；
-- 也可直接 anon/authenticated 调（权限已 grant）。
--
-- 幂等：可重复执行。
--
-- 用量看板要看的指标：
--   1) DATABASE SIZE    = pg_database_size(current_database())
--   2) FILE STORAGE     = sum(storage.objects.size) across all buckets
-- 而 Egress / Monthly Active Users 没有 SQL 接口，必须走 Supabase Management API
-- （在 Edge Function 中处理，需 SUPABASE_MGMT_TOKEN）。

-- ① DATABASE SIZE ------------------------------------------------------------
create or replace function public.get_db_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

revoke all on function public.get_db_size_bytes() from public;
grant execute on function public.get_db_size_bytes() to anon, authenticated, service_role;

comment on function public.get_db_size_bytes() is
  '返回当前数据库总字节数（pg_database_size）。SECURITY DEFINER 暴露给 anon/authenticated/service_role。';

-- ② FILE STORAGE SIZE --------------------------------------------------------
-- supabase storage 新版 storage.objects 同时提供顶层 byte_size 列；
-- 老对象只有 metadata->>'size'。两者皆尝试。
create or replace function public.get_storage_size_bytes()
returns bigint
language sql
security definer
set search_path = public, storage
as $$
  select coalesce(sum(
    case
      when objects.byte_size is not null and objects.byte_size > 0 then objects.byte_size
      when (objects.metadata->>'size') ~ '^[0-9]+$' and (objects.metadata->>'size')::bigint > 0
        then (objects.metadata->>'size')::bigint
      else 0
    end
  ), 0)::bigint
  from storage.objects;
$$;

revoke all on function public.get_storage_size_bytes() from public;
grant execute on function public.get_storage_size_bytes() to anon, authenticated, service_role;

comment on function public.get_storage_size_bytes() is
  '返回当前项目 storage.objects 总字节数（所有 buckets 聚合）。SECURITY DEFINER 暴露给 anon/authenticated/service_role。';