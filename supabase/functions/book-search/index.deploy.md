# 部署 book-search Edge Function（豆瓣图书代理）

阅读模块的书名搜索改用豆瓣数据，因豆瓣不返回 CORS 头，必须经 Supabase Edge Function 服务端代理。
前端 `src/lib/books.ts` 已改为调用 `supabase.functions.invoke('book-search', { body: { title } })`。

> 豆瓣接口**无需任何 key / Secret**，函数本身零密钥依赖。

## 方式 A：Supabase CLI（推荐，可重复部署）

```bash
# 1. 安装 CLI（若未装）：npm i -g supabase
# 2. 登录（浏览器授权，拿到临牌，不经 AI、不进 git）
supabase login
# 3. 关联本项目（ref 已在 .env 的 VITE_SUPABASE_URL 中：zvpsxbzxupkptyxfruny）
supabase link --project-ref zvpsxbzxupkptyxfruny
# 4. 部署函数（从仓库根目录执行）
supabase functions deploy book-search
```

部署后无需额外 `supabase secrets set`（豆瓣无需密钥）。

## 方式 B：Supabase Dashboard（无 CLI，适合手机/临时）

1. 打开 https://app.supabase.com → 本项目 → **Edge Functions**
2. **New Function**，名称填 `book-search`
3. 把 `supabase/functions/book-search/index.ts` 的全部内容粘贴进编辑器
4. **Deploy** 保存即生效

## 验证

部署后在浏览器（已登录）打开阅读模块 → 新建/搜索书名（如「三体」）：
- 正常：返回中文候选（书名/作者/封面/评分），说明函数已生效。
- 若仍走 mock（封面是风景图、无作者）：打开控制台看 `[books] book-search invoke ...` 的告警，通常是函数未部署或 `functions` 服务未启用（Dashboard 的 Edge Functions 需项目已开通）。

## 备注

- 函数返回字段：`found / candidates[{id,title,year,cover,third_party_rating,author}] / cover / third_party_rating(0-10) / genre([]) / year / author / overview('') / cover_failed`。
- 豆瓣详情接口（rexxar）未返回 summary / tags，故 `overview` 与 `genre` 当前为空，由用户手动补；核心的书名/作者/封面/评分已齐。
- 豆瓣封面走 `imgN.doubanio.com` 公网直链，前端 `<img>` 直拉（已确认可被第三方页面引用）。若个别网络下被防盗链，再评估改为上传 Storage 中转。
