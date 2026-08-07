# 个人工作台 · M1 账号体系

前端（React + Vite + TS + Tailwind）经 `@supabase/supabase-js` 直连 Supabase（托管 PostgreSQL + Auth），
实现**邮箱注册 / 登录 / 登出 / 会话持久化**，为后续待办 / 需求 / Sprint / Bug / KPI 模块打好账号底座。

> 数据上云（Supabase Free：500MB PostgreSQL 足够单人使用），多 PC 经 Supabase 自动同步；业务不对接 Jira / 飞书，仅链接跳转。

## 一、创建 Supabase 项目并建表

1. 打开 https://supabase.com → New Project（免费层即可）。
2. 进入 **SQL Editor**，把本仓库 `supabase/schema.sql` 全量粘贴执行（建 `profiles` 表 + RLS + 自动建 profile 触发器）。
3. 进入 **Authentication → Providers**：确认 **Email** 已开启。
   - 若想「注册即登录、免验证邮件」，可在 **Authentication → URL Configuration** 关闭 *Confirm email*（仅个人使用推荐）。
   - 默认开启时，注册后会收到验证邮件，点击回跳链接即激活。
4. 进入 **Project Settings → API**，复制：
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public key` → `VITE_SUPABASE_ANON_KEY`

## 二、本地运行

```bash
cp .env.example .env        # 填入上面的 URL 与 anon key
npm install
npm run dev                 # 打开 http://localhost:5173
```

- 注册：填邮箱 + 密码（≥6 位）→ 若开启邮箱验证，去收件箱点链接；否则直接登录。
- 登录后进入控制台，可见当前账号与「退出登录」。
- 多 PC：在另一台机器用同一账号登录，数据经 Supabase 实时互通。

## 三、构建与预览

```bash
npm run build               # 产物在 dist/，可托管到 GitHub Pages / Vercel / Cloudflare Pages
npm run preview
```

## 四、账号体系要点

- **认证**：Supabase Auth，邮箱 + 密码；`signOut({ scope: 'local' })` 仅登出当前设备。
- **会话**：`persistSession` 持久化到 localStorage，`autoRefreshToken` 自动续期，`onAuthStateChange` 驱动全局状态。
- **隔离**：所有业务表统一 `owner = auth.uid()` 的 RLS 策略，anon key 可公开但拿不到他人数据。
- **敏感字段**：后续若需存储敏感内容，在 PG 端用 `pgcrypto` / Vault 加密，密钥不落前端。

## 五、目录结构

```
src/
  lib/supabase.ts        # createClient（env 驱动）
  context/AuthContext.tsx# 会话状态管理
  components/AuthGate.tsx# 路由守卫
  components/ui.tsx       # 自研深色组件（Button/Input/Card/Field）
  pages/Login.tsx         # 登录 / 注册双模
  pages/Dashboard.tsx     # 受保护控制台（占位）
supabase/schema.sql       # profiles 表 + RLS + 触发器
```

---

## 六、M3 业务模块上云（清除 mock · 接 Supabase）

5 个业务模块（待办 / 需求 / 迭代 / 缺陷 / 指标）已从前端 `mock` 数据**全量切换为 Supabase 云端直连**，
与 `News` 模块一致：含 loading / error 态、按 `user_id` 隔离、Realtime 多端秒级同步。

### 1) 建表（一次性，在 Supabase 控制台执行）

进入 **SQL Editor**，把 `supabase/business-tables.sql` 全量粘贴执行。它创建：

| 表 | 说明 |
|---|---|
| `todos` | 待办（Score 前端计算：优先级 × 30 + max(0,72-距截止小时)） |
| `requirements` | 需求（8 态状态机，value_desc 明文存，生产可 pgcrypto 加密） |
| `sprints` | 迭代（含 burndown 燃尽序列） |
| `bugs` | 缺陷（severity / priority / status） |
| `kpis` | 指标（trend 趋势序列，lower_is_better 标记） |

每张表都：`user_id` 外键 → `auth.users`、`enable row level security`、4 条 owner=`auth.uid()` 策略、
复用 `set_updated_at()` 触发器、加入 `supabase_realtime` 发布（支持实时推送）。

> 账号体系表 `profiles` 与触发器见 `supabase/schema.sql`（M1 已建）。
> 计时表 `news` 见 `supabase/news.sql`（M2 已建）。**两份 SQL 都需已执行过**。

### 2) 前端改动要点

- `src/context/{Todos,Requirements,Sprints,Bugs,Kpis}Context.tsx`：从 `useState(MOCK_*)` 改为
  `supabase.from(...)` 云端读写 + Realtime 订阅；导出 API（`addX/updateX/removeX/moveX`）保持不变。
- `src/data/mock*.ts`：**已全部删除**（mock 数据已清除）。
- `src/types.ts`：业务实体补充 `user_id` 字段。
- 页面：`Todos / Requirements / Sprints / Bugs / Kpis` 顶部新增 loading / error 提示（错误态引导执行 SQL）。
- 拖拽排序（`Requirements` / `Bugs` 的左侧手柄调层级）为**当前会话内内存重排**，刷新后回到 `created_at` 顺序；
  如需持久化，后续给表加 `sort_order` 列并在 `moveX` 时写库。

### 3) 本地环境变量

`.env`（已被 `.gitignore` 忽略，不会进仓库）保持：

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## 七、GitHub Pages 部署

纯静态 Vite 产物，由 GitHub Actions 自动构建并发布到 GitHub Pages（**无需 Netlify**）。

### 1) 前置：把代码推到 GitHub 仓库

> ⚠️ 本项目当前**尚未初始化 git 仓库**（本地无 `.git`）。部署前需先：
> ```bash
> git init
> git add .
> git commit -m "M3: 业务模块上云 + GitHub Pages 部署配置"
> # 在 GitHub 新建同名仓库后：
> git remote add origin git@github.com:<you>/<repo>.git
> git push -u origin main
> ```

### 2) 配置 Secrets（构建期注入 Supabase 连接信息）

仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

- `VITE_SUPABASE_URL`（值同 `.env`）
- `VITE_SUPABASE_ANON_KEY`（值同 `.env` 的 anon key）

> Vite 在 `build` 时把这些值写入前端包；`.env` 不进仓库，密钥不泄露。

### 3) 开启 Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

### 4) 触发部署

- 推送 `main` 分支自动触发 `.github/workflows/deploy.yml`；
- 或 **Actions → Deploy to GitHub Pages → Run workflow** 手动触发。

部署完成后访问 `https://<you>.github.io/<repo>/`。

### 5) SPA 路由回退说明

GitHub Pages 不支持 history API fallback。本仓库已处理：

- `vite.config.js` 设 `base: './'`（资源相对引用，根域 / 项目页均可加载）；
- CI 在构建后执行 `cp dist/index.html dist/404.html`，使刷新 `/modules/todos` 等子路由时返回完整应用而非 404 空白。

> `public/404.html` 为占位兜底（极端情况下刷新到站点根路径，避免白屏），实际生效的是 CI 复制的 `dist/404.html`。
