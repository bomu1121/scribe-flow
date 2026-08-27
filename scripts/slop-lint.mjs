/**
 * 反 slop 自检：扫描前端源码中的“AI 味”反模式。
 * 命中任何一条即退出码 1；用于 CI 与提交前检查。
 * 使用：node scripts/slop-lint.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["apps/web/src", "packages/shared/src"];
const SCAN_EXT = new Set([".vue", ".ts", ".css", ".js"]);

/** 正则规则：命中即失败 */
const RULES = [
  {
    name: "紫蓝/粉紫渐变背景",
    pattern: /linear-gradient\s*\(\s*(?:135deg|180deg|to\s+(?:right|bottom))[^)]*(?:#667eea|#764ba2|#a78bfa)/i,
  },
  { name: "玻璃拟态", pattern: /backdrop-filter\s*:\s*blur\(/i },
  { name: "装饰性 emoji", pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u },
  { name: "辉光 text-shadow", pattern: /text-shadow\s*:[^;]*glow/i },
  { name: "辉光 box-shadow 重投影", pattern: /box-shadow\s*:[^;]*0\s+0\s+\d+px\s+rgba\([^)]*0\.[2-9]\)/i },
  { name: "scrollIntoView", pattern: /scrollIntoView\s*\(/ },
  {
    name: "AI 默认字体主字体",
    pattern: /font-family\s*:\s*(?:['"]?(?:Inter|Roboto|Poppins|Fraunces)['"]?)/i,
  },
];

/** 排除：mock、测试 fixture、样式令牌文件中为演示而写的注释不算 UI 源码 */
const IGNORE = /\.(test|spec)\.(ts|js)$/;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(extname(entry.name))) yield full;
  }
}

const hits = [];
let fileCount = 0;

for (const dir of SCAN_DIRS) {
  for await (const file of walk(join(ROOT, dir))) {
    if (IGNORE.test(file)) continue;
    fileCount += 1;
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    for (const rule of RULES) {
      let line = 1;
      for (const l of lines) {
        if (rule.pattern.test(l)) {
          hits.push(`${file.replace(ROOT, "")}:${line}: ${rule.name}`);
        }
        line += 1;
      }
    }
  }
}

console.log(`[slop-lint] 扫描 ${fileCount} 个文件`);
if (hits.length > 0) {
  console.error(`[slop-lint] 发现 ${hits.length} 处反模式：`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("[slop-lint] 通过：未发现 AI 味反模式");
