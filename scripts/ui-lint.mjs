/**
 * UI 浮层样式防再犯检查。
 * 背景：Reka UI 的 *Portal 组件把内容 Teleport 到 <body>，
 * Vue scoped 样式不会给这些节点带上 data-v 作用域属性，
 * 导致弹出层背景/边框/圆角/内边距全部失效（下拉框严重样式问题）。
 * 规则：任何使用 Portal 的 SFC，必须至少有一个非 scoped 的 <style> 块，
 * 用于承载传送层样式；z-index 必须使用 --z-* 令牌，禁止散写。
 */
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "apps", "web", "src", "components");

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (extname(entry.name) === ".vue") yield full;
  }
}

const failures = [];
let count = 0;

for await (const file of walk(SCAN_DIR)) {
  count += 1;
  const text = await readFile(file, "utf8");
  const usesPortal = /[A-Za-z]+Portal\b/.test(text);
  if (!usesPortal) continue;

  const styleTags = [...text.matchAll(/<style([^>]*)>/g)].map((m) => m[1] ?? "");
  const hasScopedStyle = styleTags.some((attrs) => /\bscoped\b/.test(attrs));
  const hasGlobalStyle = styleTags.some((attrs) => !/\bscoped\b/.test(attrs));
  // utility-first 组件（shadcn-vue registry 风格）没有 style 块是允许的；
  // 但如果写了 scoped 样式，则必须同时提供全局样式承载传送层规则。
  if (hasScopedStyle && !hasGlobalStyle) {
    failures.push(`${file.replace(ROOT, "")}: 使用 Portal 且只有 scoped 样式，Teleport 弹层会丢失样式`);
  }

  // z-index 硬编码检查（仅检查使用了 Portal 的文件里的样式内容）
  if (/z-index\s*:\s*\d+/.test(text)) {
    failures.push(`${file.replace(ROOT, "")}: 浮层组件散写 z-index，应使用 --z-* 令牌`);
  }
}

console.log(`[ui-lint] 扫描 ${count} 个组件文件`);
if (failures.length > 0) {
  console.error(`[ui-lint] 发现 ${failures.length} 个问题：`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("[ui-lint] 通过：传送浮层样式均为全局样式，层级使用令牌");
