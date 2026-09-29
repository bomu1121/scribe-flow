/**
 * 反 slop 自检：扫描前端源码中的"AI 味"反模式。
 *
 * 分两级：
 *   error —— 会让界面明显变廉价、且一定不是本仓有意为之的写法（渐变、玻璃拟态、发光、装饰 emoji）
 *   warn  —— 口味偏好（主字体），提示但不拦
 * 口味问题不该硬失败：它会逼着后来者去改 lint 而不是改代码，久了规则就变成噪声。
 *
 * 用法：node scripts/slop-lint.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["apps/web/src", "packages/shared/src"];
const SCAN_EXT = new Set([".vue", ".ts", ".css", ".js"]);

/**
 * 规则：命中即按 level 处理。
 *
 * `scrollIntoView` 单列成 warn 而不是 error：真正要拦的是"滚动带着整页跳"这个**意图**，
 * 而不是这个 API 本身——容器自身的滚动（`container.scrollTo`）才是本仓的写法。
 * 原来把它写成硬失败时，代码里得反过来为 lint 写注释解释，规则比代码还显眼。
 */
const RULES = [
  {
    name: "紫蓝/粉紫渐变背景",
    level: "error",
    pattern: /linear-gradient\s*\(\s*(?:135deg|180deg|to\s+(?:right|bottom))[^)]*(?:#667eea|#764ba2|#a78bfa)/i,
  },
  { name: "玻璃拟态", level: "error", pattern: /backdrop-filter\s*:\s*blur\(/i },
  {
    // 只在 .vue / .css 里查：模板与样式里的 emoji 一定是装饰；
    // .ts 里出现 emoji 可能是解析用户内容（例如清洗文稿），不该一律判死。
    name: "装饰性 emoji",
    level: "error",
    files: /\.(vue|css)$/,
    pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
  },
  { name: "发光类装饰（text-shadow / box-shadow 重投影）", level: "error", pattern: /(?:text-shadow\s*:[^;]*glow|box-shadow\s*:[^;]*0\s+0\s+\d+px\s+rgba\([^)]*0\.[2-9]\))/i },
  { name: "滚动带着整页跳（请只滚动容器自身，例如 container.scrollTo）", level: "warn", pattern: /scrollIntoView\s*\(/ },
  { name: "AI 默认字体主字体", level: "warn", pattern: /font-family\s*:\s*(?:['"]?(?:Inter|Roboto|Poppins|Fraunces)['"]?)/i },
];

/** 排除：测试 fixture 不算 UI 源码 */
const IGNORE = /\.(test|spec)\.(ts|js)$/;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(extname(entry.name))) yield full;
  }
}

const errors = [];
const warnings = [];
let fileCount = 0;

for (const dir of SCAN_DIRS) {
  for await (const file of walk(join(ROOT, dir))) {
    if (IGNORE.test(file)) continue;
    fileCount += 1;
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    for (const rule of RULES) {
      if (rule.files && !rule.files.test(file)) continue;
      let line = 1;
      for (const l of lines) {
        if (rule.pattern.test(l)) {
          const hit = `${file.replace(ROOT, "")}:${line}: ${rule.name}`;
          (rule.level === "error" ? errors : warnings).push(hit);
        }
        line += 1;
      }
    }
  }
}

console.log(`[slop-lint] 扫描 ${fileCount} 个文件`);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
if (errors.length > 0) {
  console.error(`[slop-lint] 发现 ${errors.length} 处反模式：`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log(`[slop-lint] 通过：无 error 级反模式（警告 ${warnings.length} 条）`);
