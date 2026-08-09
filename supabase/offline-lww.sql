-- ============================================================
-- 离线优先 · 冲突策略激活脚本（可选，一次性执行）
-- 位置：Supabase 后台 → SQL Editor → 粘贴执行
-- ============================================================
-- 现状：business-tables.sql 里 5 张表的 updated_at 触发器是
--   `BEFORE INSERT OR UPDATE ... set_updated_at()`
--   即每次 UPDATE 都会把 updated_at 覆写成服务端 now()。
-- 这会让"离线编辑后回网补传"时，updated_at 变成"同步时间"而非"编辑时间"，
-- 从而无法实现跨设备「按 updated_at 最后写入胜」。
--
-- 本脚本把触发器改为「仅 INSERT 自动设值」，UPDATE 时保留客户端携带的
-- updated_at（前端在每次本地编辑时都会写入编辑时间）。
-- 未执行本脚本：冲突退化为「最后同步胜」，对个人单用户同样合理，无需强求。
-- ============================================================

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before insert on public.todos
  for each row execute function public.set_updated_at();

drop trigger if exists requirements_set_updated_at on public.requirements;
create trigger requirements_set_updated_at
  before insert on public.requirements
  for each row execute function public.set_updated_at();

drop trigger if exists sprints_set_updated_at on public.sprints;
create trigger sprints_set_updated_at
  before insert on public.sprints
  for each row execute function public.set_updated_at();

drop trigger if exists bugs_set_updated_at on public.bugs;
create trigger bugs_set_updated_at
  before insert on public.bugs
  for each row execute function public.set_updated_at();

drop trigger if exists kpis_set_updated_at on public.kpis;
create trigger kpis_set_updated_at
  before insert on public.kpis
  for each row execute function public.set_updated_at();
