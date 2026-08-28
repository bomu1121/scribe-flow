/**
 * UI 样式铁律检查（Element Plus 时代版）。
 * 规则：
 * 1. 使用 Reka UI *Portal 的 SFC，必须至少有一个非 scoped 的 <style> 块，
 *    用于承载 Teleport 到 body 的浮层样式；
 * 2. z-index 只能使用 --z-* 设计令牌，禁止散写数字；
 * 3. 组件/视图样式禁止散写颜色（hex/rgb/hsl），颜色只能定义在 styles/tokens.css
 *    与 styles/element-theme.css。
 */
import { readdir, readFile } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "apps", "web", "src");
const ALLOW_COLOR_FILES = new Set([
  join(SCAN_DIR, "styles", "tokens.css"),
  join(SCAN_DIR, "styles", "element-theme.css"),
]);

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".vue") || entry.name.endsWith(".css")) yield full;
  }
}

const failures = [];
let count = 0;

for await (const file of walk(SCAN_DIR)) {
  count += 1;
  const text = await readFile(file, "utf8");
  const rel = relative(ROOT, file);

  if (file.endsWith(".vue")) {
    const usesPortal = /[A-Za-z]+Portal\b/.test(text);
    if (usesPortal) {
      const styleTags = [...text.matchAll(/<style([^>]*)>/g)].map((m) => m[1] ?? "");
      const hasScopedStyle = styleTags.some((attrs) => /\bscoped\b/.test(attrs));
      const hasGlobalStyle = styleTags.some((attrs) => !/\bscoped\b/.test(attrs));
      if (hasScopedStyle && !hasGlobalStyle) {
        failures.push(`${rel}: 使用 Portal 且只有 scoped 样式，Teleport 弹层会丢失样式`);
      }
    }

    if (/z-index\s*:\s*\d+/.test(text)) {
      failures.push(`${rel}: 散写 z-index 数字，应使用 --z-* 令牌`);
    }
  }

  if (!ALLOW_COLOR_FILES.has(file) && /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(text)) {
    failures.push(`${rel}: 样式散写颜色，应引用 styles/tokens.css 或 element-theme.css 中的变量`);
  }
}

console.log(`[ui-lint] 扫描 ${count} 个组件/样式文件`);
if (failures.length > 0) {
  console.error(`[ui-lint] 发现 ${failures.length} 个问题：`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("[ui-lint] 通过：Portal 浮层样式全局、z-index 用令牌、颜色单一来源");
