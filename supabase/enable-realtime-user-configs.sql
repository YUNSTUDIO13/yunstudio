-- 开启 user_configs 表的 Realtime 发布
-- 仪表盘布局的多端实时同步依赖此表能推送 postgres_changes 事件；
-- 若表未加入 supabase_realtime publication，前端 Realtime 订阅永远收不到推送，
-- 导致"A 编辑 → B 实时同步"失效（只能靠刷新拉取）。
-- 幂等：已加入则跳过。默认 publication 名为 supabase_realtime。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_configs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_configs';
  END IF;
END $$;
