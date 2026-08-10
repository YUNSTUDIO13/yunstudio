-- ============================================================
-- 最后编辑胜（Last-Write-Wins by updated_at）——自包含脚本
-- 适用：todos / requirements / bugs / sprints / kpis 五张业务表
--
-- 解决现状：business-tables.sql 给这 5 张表挂了 set_updated_at() 触发器，
--   每次 UPDATE 都把云端 updated_at 覆写成服务端 now()（= 同步时间），
--   于是 upsert 整行无条件覆盖、谁后回网谁赢 ——「最后同步胜」。
--
-- 本脚本作用：
--   1) 将 5 表的 updated_at 触发器改为「仅 INSERT 自动设」，
--      UPDATE 时保留客户端传入的编辑时间（离线编辑的真实时刻）。
--   2) 新增 BEFORE UPDATE 守卫触发器 lww_guard：
--      仅当新行的 updated_at >= 现有行 updated_at 时才允许覆盖，
--      否则 RETURN OLD（拒绝旧编辑覆盖新编辑）。
--
-- 效果：多设备离线编辑后陆续回网，云端收敛到「后编辑者」的版本。
--   例：A 11:00 编辑、B 10:00 编辑，A 先回网上传(云端=11:00)，
--       B 后回网上传(updated_at=10:00 < 11:00 → 被守卫拒绝)，
--       云端保持 11:00，最终 A/B/云端三方收敛到 A(11:00) —— 后编辑胜。
--
-- 前置：schema.sql / business-tables.sql 已执行（表与 public.set_updated_at 存在）
-- 执行位置：Supabase 控制台 → SQL Editor，整段粘贴执行一次即可。
-- 注意：前端代码无需改动，客户端每次编辑已写入 updated_at。
--       依赖各设备时钟大致同步（updated_at 比较基于设备本地时间）。
-- ============================================================

-- 通用守卫函数：UPDATE 时若新编辑时间早于现有行，则拒绝更新（保持旧行）
create or replace function public.lww_guard_updated_at()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.updated_at < OLD.updated_at then
      return OLD; -- 旧编辑不可覆盖新编辑
    end if;
  end if;
  return NEW;
end;
$$;

-- 仅 INSERT 自动设 updated_at（UPDATE 时保留客户端传入的编辑时间）
create or replace function public.set_updated_at_insert_only()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    new.updated_at = now();
  end if;
  return NEW;
end;
$$;

-- 对五张业务表逐一改造触发器
do $$
declare
  t text;
begin
  foreach t in array array['todos', 'requirements', 'bugs', 'sprints', 'kpis']
  loop
    -- 去掉「UPDATE 也覆写 updated_at」的旧触发器
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    -- 换上「仅 INSERT 设 updated_at」的版本（UPDATE 保留客户端值）
    execute format(
      'create trigger %I_set_updated_at before insert or update on public.%I
       for each row execute function public.set_updated_at_insert_only()', t, t);
    -- 加条件更新守卫（后编辑胜）
    execute format('drop trigger if exists %I_lww on public.%I', t, t);
    execute format(
      'create trigger %I_lww before update on public.%I
       for each row execute function public.lww_guard_updated_at()', t, t);
  end loop;
end $$;
