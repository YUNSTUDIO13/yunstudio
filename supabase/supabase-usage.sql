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
--   2) FILE STORAGE     = sum((metadata->>'size')::bigint)  排除系统 bucket
--                          （Supabase 官方计费规则：自动生成的 thumbnails bucket 不计入）
-- 而 Egress / Monthly Active Users 没有 SQL 接口，必须走 Supabase Management API
-- （在 Edge Function 中处理，需 MGMT_TOKEN secret；注意名字不能以 SUPABASE_ 开头，
--  Dashboard 校验会拒绝 "Name must not start with the SUPABASE_ prefix"）。
--
-- ★ 字段来源（已据 supabase 官方文档 https://supabase.com/docs/guides/platform/manage-your-usage/storage-size 核实）：
--   storage.objects 标准字段：id, bucket_id, name, owner, metadata jsonb,
--   version, created_at, updated_at, last_accessed_at
--   没有 size/byte_size/data 列 — 文件字节数只能在 metadata->>'size'（supabase 上传时 server 自动写入）。

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
-- supabase 官方文档「Manage Storage size usage」的标准写法：metadata->>'size' 累计求和
-- （supabase 上传时由 server 自动在 metadata 里塞入 size key；极少数老对象可能没塞，正则防御）。
-- ★ 排除系统 bucket「thumbnails」：Dashboard 计费口径不计该 bucket，由 supabase server
--   自动存储上传原图的衍生缩略图，应剔除避免虚高。
create or replace function public.get_storage_size_bytes()
returns bigint
language sql
security definer
set search_path = public, storage
as $$
  select coalesce(sum(
    case
      when (objects.metadata->>'size') ~ '^[0-9]+$' and (objects.metadata->>'size')::bigint > 0
        then (objects.metadata->>'size')::bigint
      else 0
    end
  ), 0)::bigint
  from storage.objects
  where objects.bucket_id <> 'thumbnails';
$$;

revoke all on function public.get_storage_size_bytes() from public;
grant execute on function public.get_storage_size_bytes() to anon, authenticated, service_role;

comment on function public.get_storage_size_bytes() is
  '返回当前项目 storage.objects 总字节数（排除 thumbnails 系统 bucket；据 supabase 官方文档 metadata->>size 字段，SECURITY DEFINER 暴露给 anon/authenticated/service_role）。';
