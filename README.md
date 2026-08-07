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

### M3.2 用户配置上云（导航关系 + 主页卡片）

导航关系数据（一级 Tab → 二级列 → 三级模块）与主页卡片配置，原只存浏览器 `localStorage`，换设备 / 清缓存即丢、无法多 PC 同步。现已与业务模块一致上云：

进入 **SQL Editor**，把 `supabase/user-configs.sql` 全量粘贴执行（建 `user_configs` 表 + RLS + 触发器 + Realtime）。该表用 `kind` 区分两类配置：

| kind | 配置 | 来源 Context |
|---|---|---|
| `nav` | 导航关系（NavConfig 整份 JSONB） | `NavContext` |
| `dashboard` | 主页卡片（DashboardConfig 整份 JSONB） | `DashboardContext` |

两个 Context 改为：**云端读取优先 → localStorage 兜底 → 默认**；**写入云端 upsert + localStorage 双写**；并订阅 `user_configs` Realtime 实现多 PC 秒级同步。

> 若未执行此 SQL，配置自动回退 localStorage（不报错），但无法跨设备同步。

### M3.3 个人主页（头像上传 + 资料编辑）

进入 **SQL Editor**，把 `supabase/profile-avatar.sql` 全量粘贴执行，它做四件事：

1. 给 `profiles` 补 `title` / `department` / `bio` 三个字段；
2. 为历史账号补建缺失的 `profiles` 行（注册触发器只对新用户生效）；
3. `profiles` 开启 Realtime（多 PC 头像 / 资料秒级同步）；
4. 建 **`avatars` 公开存储桶**（2MB 上限、仅允许 webp/jpeg/png），并配 `storage.objects` 策略：**公开可读、仅本人可写自己的目录**。

页面：左下 dock 头像 → `/account`（页面标题已改为「个人主页」），能力如下。

| 功能 | 说明 |
|---|---|
| 头像上传 | 本地选图 → **前端 Canvas 压缩** → 预览确认 → 传 Storage → 回写 `profiles.avatar_url` |
| 头像移除 | 删桶内文件并清空 `avatar_url`，回退首字母色块 |
| 资料编辑 | 昵称 / 职位 / 部门 / 个性签名，脏值检测 + 字数校验 + 放弃修改 |
| 修改密码 | `supabase.auth.updateUser({ password })`，含强度条与二次确认 |
| 账号信息 | 邮箱 / 用户 ID / 角色 / 注册时间 / 最近登录（只读） |

**头像压缩策略**（`src/lib/image.ts`，无第三方依赖）：

- 入参校验：仅 `image/*` 且在白名单内，原图 ≤ 10MB；
- 解码用 `createImageBitmap(..., { imageOrientation: 'from-image' })`，自动纠正手机照片 EXIF 旋转；
- 居中**正方形裁切** → 缩放到 512px；
- 优先编码 **WebP**（不支持则 JPEG，并铺白底避免 PNG 透明区变黑）；
- 质量从 0.9 逐级降到 0.5，仍超 120KB 则依次降边长 384 / 256 / 192，最终稳定在 ~100KB 以内；
- 文件路径固定 `avatars/{user_id}/avatar.webp` + `upsert`，同一用户永远只占一个文件，不会越传越多；URL 带 `?v=时间戳` 绕过 CDN 缓存。

> 若未执行此 SQL，个人主页顶部会提示"资料加载失败"，并指明需要执行的脚本。

> 兜底急救：若发现账号 / 头像数据"消失了"，先跑 `supabase/profile-restore.sql`（自检 + 兜底补 profile 行 + 重建 avatars 桶 + 策略），全程只读诊断 + `ON CONFLICT DO NOTHING`，不会破坏既有数据。可重复执行。

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
