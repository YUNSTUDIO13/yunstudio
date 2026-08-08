// 构建前自动把 sw.js 的 VERSION 占位符替换为本次部署唯一的 git short SHA，
// 使每次构建产出的 Service Worker 版本号不同 → 浏览器必重新安装 →
// activate 清空全部旧缓存 → 客户端不再被旧壳焊死。
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const file = 'public/sw.js';
let sha = 'dev';
try {
  sha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // 非 git 环境回退到时间戳，保证仍唯一
  sha = 't' + Date.now().toString(36);
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
  console.log(`[bump-sw] VERSION -> yunstudio-${sha}`);
}
