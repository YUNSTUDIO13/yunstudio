// 构建后（vite 已把 public/sw.js 复制到 dist/sw.js）把 sw.js 的 VERSION
// 占位符替换为本次部署唯一的 git short SHA，使每次构建产出的 Service Worker
// 版本号不同 → 浏览器必重新安装 → activate 清空全部旧缓存 → 客户端不再被旧壳焊死。
//
// 关键设计：只修补 dist/sw.js（构建产物），绝不回写 public/sw.js 源文件。
// 源文件永久保留 '__SW_VERSION__' 占位符，避免「prebuild 一次性消耗占位符后
// 后续构建永远跳过」的鸡生蛋问题，也避免污染工作区导致 amend 循环。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const file = 'dist/sw.js';
let sha = 'dev';
try {
  sha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // 非 git 环境回退到时间戳，保证仍唯一
  sha = 't' + Date.now().toString(36);
}

if (!existsSync(file)) {
  console.warn('[bump-sw] dist/sw.js 不存在，跳过（先跑 vite build）');
  process.exit(0);
}

const source = readFileSync(file, 'utf8');
const next = source.replace(
  "const VERSION = '__SW_VERSION__'",
  `const VERSION = 'yunstudio-${sha}'`
);
if (next === source) {
  console.warn('[bump-sw] 未找到 __SW_VERSION__ 占位符，跳过');
} else {
  writeFileSync(file, next);
  console.log(`[bump-sw] dist/sw.js VERSION -> yunstudio-${sha}`);
}
