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
--   2) FILE STORAGE     = sum(LENGTH(storage.objects.data)) across all buckets
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
-- supabase storage 的 storage.objects 表标准字段是 data bytea + metadata jsonb。
-- 文件字节数最稳的取法是 LENGTH(objects.data)（官方文档标准），逐行累计。
-- 跨 supabase 版本稳定，不依赖列名在不同版本间的命名差异。
create or replace function public.get_storage_size_bytes()
returns bigint
language sql
security definer
set search_path = public, storage
as $$
  select coalesce(sum(LENGTH(objects.data)), 0)::bigint
  from storage.objects;
$$;

revoke all on function public.get_storage_size_bytes() from public;
grant execute on function public.get_storage_size_bytes() to anon, authenticated, service_role;

comment on function public.get_storage_size_bytes() is
  '返回当前项目 storage.objects 总字节数（所有 buckets 聚合，用 LENGTH(data) 官方标准字段）。SECURITY DEFINER 暴露给 anon/authenticated/service_role。';
