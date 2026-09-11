#!/usr/bin/env node
/**
 * 文档门禁。目标不是"检查有没有文档"，而是让**已确认会发生的那几类文档漂移直接变成 CI 失败**：
 *
 *   R1 front matter 合法（class/status 取值、必填键、日期格式）
 *   R2 supersede/superseded_by 双向链接，且目标文档存在
 *   R3 docs-gen 生成块已同步（数字与文档地图不是手写的）
 *   R4 文档地图覆盖 docs/ 下全部文档（防手改漏项）
 *   R5 deprecated / superseded 的文档正文不得再出现"按此执行"类祈使句
 *   R6 class: evidence 的正文指纹必须与 content_hash 一致（验收档案不可改）
 *   R7 README / status.md 在生成块之外不得手写易漂移的数字
 *   R8 相对链接指向的文件必须存在
 *   R9 前端首屏关键路径 gzip 预算（仅在 dist 存在时检查）
 *   R10 源码注释与正文里以 docs/ 写的文档路径必须真实存在（R8 只查 markdown 链接）
 *   R11 class 必须与所在目录一致（目录名即分类信号）
 *   R12 文档里的 代码路径:行号 引用必须能解析（文件存在、行号不越界；不判断该行内容是否仍符合）
 *      新鲜度：last_reviewed 超过阈值（class 默认值，可被 review_days 覆盖）时告警；--strict 下升级为失败
 *
 * R6 为什么用内容指纹而不是提交日期：补 front matter、rebase、squash 都会改写提交日期，
 * 那样会把"加了一行元数据"误判成"改了验收结论"。指纹直接校验不变量本身：正文一个字节都不能变。
 * 需要合法修改验收档案时，用 `pnpm docs:freeze <文件>` 显式重新冻结——这一步的摩擦是刻意保留的。
 *
 * 分阶段生效：只有 docs/status.md 与 docs/decisions|plans|evidence/ 强制要求 front matter，
 * 其余文档"有则校验"。
 *
 * 用法：
 *   node scripts/docs-lint.mjs            常规检查（新鲜度仅告警）
 *   node scripts/docs-lint.mjs --strict   新鲜度也失败（供定时任务使用）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  CLASS_RULES,
  DAY_MS,
  DIRECTORY_CLASS,
  ROOT,
  STATUS_ENUM,
  contentHash,
  isArchived,
  parseFrontMatter,
  read,
  requiresFrontMatter,
  walk,
} from "./lib/docs-shared.mjs";

const STRICT = process.argv.includes("--strict");

/** R7：现状类文档里不允许手写的易漂移数字。 */
const DRIFT_PATTERNS = [
  { re: /\d+\s*(?:KB|MB|GB|KiB|MiB)\b/i, hint: "体积数字" },
  { re: /\d+\s*\/\s*\d+\s*(?:项)?(?:通过|项)/, hint: "通过项计数" },
  { re: /(?:合计|共)\s*\d+\s*个(?:用例|测试)/, hint: "用例总数" },
  { re: /\d+\s*个用例/, hint: "用例总数" },
  { re: /内置\s*\d+\s*块/, hint: "内置块数" },
  { re: /(?:smoke|冒烟)[^\n]{0,8}\d+\s*项/, hint: "冒烟项数" },
];

/** R5：已废弃的文档不允许继续发号施令。刻意保持高精度，宁漏勿误。 */
const IMPERATIVE_RE = /按此执行|按此实现|按此落地|按此规范|照此执行/;

/** R9：用于拦住回归，不是目标值——根治手段是 Element Plus 改按需引入。 */
const FIRST_SCREEN_FAIL_KIB = 650;
const FIRST_SCREEN_WARN_KIB = 620;

const errors = [];
const warnings = [];
const fail = (rule, file, msg) => errors.push({ rule, file, msg });
const warn = (rule, file, msg) => warnings.push({ rule, file, msg });

const stripGeneratedBlocks = (text) =>
  text.replace(/<!-- docs-gen:[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "");

/* ------------------------------------------------------------------ 收集 */

const allDocs = walk("docs", (p) => p.endsWith(".md") && !isArchived(p));
const lintTargets = [...allDocs, "README.md", "AGENTS.md", "CHANGELOG.md"].filter((p) => existsSync(join(ROOT, p)));
const frontMatter = new Map();

/* ------------------------------------------------- R1 + R6 + 新鲜度 + 收集 */

for (const file of lintTargets) {
  const parsed = parseFrontMatter(read(file));

  if (!parsed) {
    if (requiresFrontMatter(file)) fail("R1", file, "缺少 front matter（docs/ 下除样例与抓取原文外都强制要求）");
    continue;
  }
  const { data, body } = parsed;
  frontMatter.set(file, data);

  const cls = data.class;
  if (!cls || !CLASS_RULES[cls]) {
    fail("R1", file, `class 缺失或非法：${cls ?? "(空)"}（可选 ${Object.keys(CLASS_RULES).join(" / ")}）`);
    continue;
  }

  for (const key of CLASS_RULES[cls].required) {
    if (data[key] === undefined || data[key] === null) fail("R1", file, `class: ${cls} 缺少必填键 ${key}`);
  }
  if (data.status && !STATUS_ENUM.has(data.status)) {
    fail("R1", file, `status 非法：${data.status}（可选 ${[...STATUS_ENUM].join(" / ")}）`);
  }
  for (const key of ["last_reviewed", "frozen_at", "review_days"]) {
    if (!data[key]) continue;
    if (key === "review_days") {
      // 必须为正整数：0 会被下面的新鲜度判断当作 falsy 从而静默关掉检查。
      if (!/^[1-9]\d*$/.test(data[key])) fail("R1", file, `review_days 必须是正整数：${data[key]}`);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data[key])) {
      fail("R1", file, `${key} 必须是 YYYY-MM-DD：${data[key]}`);
    }
  }

  // R6：验收档案的内容指纹。
  if (cls === "evidence" && data.content_hash) {
    const actual = contentHash(body);
    if (actual !== data.content_hash) {
      fail(
        "R6",
        file,
        `验收档案正文已变动（content_hash=${data.content_hash}，实际 ${actual}）。` +
          `验收档案是冻结快照，请勿修改；确需修改请显式执行 pnpm docs:freeze ${file}`,
      );
    }
  }

  // 新鲜度
  const maxAge = data.review_days ? Number(data.review_days) : CLASS_RULES[cls].maxAgeDays;
  if (maxAge && data.last_reviewed) {
    const age = Math.floor((Date.now() - Date.parse(`${data.last_reviewed}T00:00:00Z`)) / DAY_MS);
    if (age > maxAge) {
      const msg = `last_reviewed=${data.last_reviewed}，已 ${age} 天未复核（class: ${cls} 阈值 ${maxAge} 天）`;
      if (STRICT) fail("新鲜度", file, msg);
      else warn("新鲜度", file, msg);
    }
  }

  // R5：已废弃/被取代的文档不得继续下达指令。
  if (cls === "decision" && (data.status === "deprecated" || data.status === "superseded")) {
    const hit = IMPERATIVE_RE.exec(body);
    if (hit) fail("R5", file, `status: ${data.status} 但正文仍含祈使句「${hit[0]}」，请改为陈述历史或指向替代文档`);
  }
}

/* --------------------------------------------------------------- R2 */

// supersedes / superseded_by 用**仓库相对路径**（如 docs 斜杠分类斜杠文档.md 的形式，写成占位符），
// 不写成"相对 docs/"或"相对本文件"——仓库相对最不容易在目录重排时产生歧义。
for (const [file, data] of frontMatter) {
  for (const [key, backKey] of [
    ["supersedes", "superseded_by"],
    ["superseded_by", "supersedes"],
  ]) {
    const target = data[key];
    if (!target) continue;
    if (!target.startsWith("docs/")) {
      fail("R2", file, `${key}: 必须写仓库相对路径（以 docs/ 开头），当前为「${target}」`);
      continue;
    }
    if (!existsSync(join(ROOT, target))) {
      fail("R2", file, `${key}: ${target} 指向的文档不存在`);
      continue;
    }
    const targetData = parseFrontMatter(read(target))?.data;
    if (!targetData) {
      fail("R2", file, `${key}: ${target} 没有 front matter，无法建立双向链接`);
      continue;
    }
    if (targetData[backKey] !== file) {
      fail("R2", file, `${key}: ${target}，但对方 ${backKey} 为「${targetData[backKey] ?? "(空)"}」，应为「${file}」`);
    }
  }
}

/* --------------------------------------------------------------- R3 */

// docs-gen 的用例数是静态数 `it(` 声明。这个口径在有人改用 `it.each(...)` 时会静默偏低——
// 数字不会报错，只会变小到不对。这里守住口径前提：一旦出现 `.each(` 就要求改计数方式。
{
  const eachFiles = walk("", (p) => p.endsWith(".test.ts")).filter((p) => /\.\beach\(/.test(read(p)));
  if (eachFiles.length > 0) {
    fail(
      "R3",
      "scripts/docs-gen.mjs",
      `以下测试用了 .each(...)，静态数 it( 的用例口径已失效，请改用实跑结果或换计数方式：${eachFiles.join("、")}`,
    );
  }
}

try {
  execFileSync("node", [join(ROOT, "scripts", "docs-gen.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  const detail = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
  fail("R3", "scripts/docs-gen.mjs", `生成块未同步：${detail.trim().split("\n").slice(-3).join(" ")}`);
}

/* --------------------------------------------------------------- R4 */

{
  const statusPath = "docs/status.md";
  if (existsSync(join(ROOT, statusPath))) {
    const block = /<!-- docs-gen:map:start -->([\s\S]*?)<!-- docs-gen:map:end -->/.exec(read(statusPath))?.[1] ?? "";
    const missing = allDocs.filter((p) => p !== statusPath && !block.includes(relative("docs", p).split("\\").join("/")));
    if (missing.length > 0) {
      fail("R4", statusPath, `文档地图未覆盖 ${missing.length} 份文档：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " …" : ""}`);
    }
  }
}

/* --------------------------------------------------------------- R7 */

for (const file of ["README.md", "docs/status.md"]) {
  if (!existsSync(join(ROOT, file))) continue;
  stripGeneratedBlocks(read(file))
    .split("\n")
    .forEach((line, i) => {
      for (const { re, hint } of DRIFT_PATTERNS) {
        const hit = re.exec(line);
        if (hit) fail("R7", file, `第 ${i + 1} 行手写了${hint}「${hit[0]}」——现状数字请放进 docs-gen 生成块`);
      }
    });
}

/* --------------------------------------------------------------- R8 */

for (const file of lintTargets) {
  const text = read(file).replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = m[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#|\/)/i.test(target)) continue;
    target = target.split("#")[0];
    if (!target) continue;
    if (!existsSync(resolve(dirname(join(ROOT, file)), decodeURIComponent(target)))) fail("R8", file, `死链：${m[1]}`);
  }
}

/* --------------------------------------------------------------- R9 */

{
  const distDir = join(ROOT, "apps", "web", "dist");
  const indexPath = join(distDir, "index.html");
  if (existsSync(indexPath)) {
    const refs = [...readFileSync(indexPath, "utf8").matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const files = [...new Set(refs)]
      .map((r) => join(distDir, r.replace(/^\//, "")))
      .filter((p) => existsSync(p) && statSync(p).isFile());
    const measured = files.map((p) => ({ name: relative(join(distDir, "assets"), p), kib: gzipSync(readFileSync(p)).length / 1024 }));
    const total = measured.reduce((sum, f) => sum + f.kib, 0);
    const detail = measured
      .sort((a, b) => b.kib - a.kib)
      .map((f) => `${f.name} ${f.kib.toFixed(0)}KiB`)
      .join(" · ");
    if (total > FIRST_SCREEN_FAIL_KIB) {
      fail("R9", "apps/web/dist", `首屏关键路径 ${total.toFixed(0)}KiB 超过预算 ${FIRST_SCREEN_FAIL_KIB}KiB（${detail}）`);
    } else if (total > FIRST_SCREEN_WARN_KIB) {
      warn("R9", "apps/web/dist", `首屏关键路径 ${total.toFixed(0)}KiB 已接近预算 ${FIRST_SCREEN_FAIL_KIB}KiB（${detail}）`);
    }
  }
}

/* -------------------------------------------------------------- R10 */

// 源码注释与文档正文里会以「仓库相对」形式写文档路径（如 prompt.ts 注释里写的文档路径），
// 这类引用不是 markdown 链接，R8 的链接检查覆盖不到——文档一搬家它们就静默失效。
// 这里统一校验它们指向的文件真实存在。
// 必须排除 URL 内部的同名片段：外部链接常长成 GitHub 上某个仓库的 content 目录下的同名 md，那不是本仓库路径。
{
  const scanned = [
    ...walk("apps", (p) => /\.(?:ts|vue)$/.test(p) && !p.endsWith(".test.ts")),
    ...walk("packages", (p) => /\.(?:ts|vue)$/.test(p) && !p.endsWith(".test.ts")),
    ...walk("scripts", (p) => p.endsWith(".mjs") && !p.includes("scripts/migrate-")),
    ...lintTargets,
  ];
  for (const file of new Set(scanned)) {
    for (const line of read(file).split("\n")) {
      const urls = [...line.matchAll(/https?:\/\/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
      for (const m of line.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)) {
        if (urls.some(([start, end]) => m.index >= start && m.index < end)) continue;
        if (!existsSync(join(ROOT, m[0]))) fail("R10", file, `引用的文档不存在：${m[0]}`);
      }
    }
  }
}

/* -------------------------------------------------------------- R11 */

// 目录名就是分类信号（见 AGENTS.md）。R11 检查 class 与所在目录一致——
// 「判错 class」本身机器管不了，但「放错目录」能管，而放错目录正是分类错误最常见的形态。
for (const [file, data] of frontMatter) {
  if (!data.class) continue;
  const rule = DIRECTORY_CLASS.find((r) => r.re.test(file));
  if (!rule) {
    fail(
      "R11",
      file,
      "不在约定目录内（docs/ 根、decisions/、plans/、evidence/、research/）；新目录需同步 docs-shared.mjs 的 DIRECTORY_CLASS",
    );
  } else if (rule.cls !== data.class) {
    fail("R11", file, `class: ${data.class} 与所在目录不符——${rule.label} 只放 class: ${rule.cls}`);
  }
}

/* -------------------------------------------------------------- R12 */

// 文档里会以 `路径:行号` 指向代码位置（status.md 的已知缺口全是这个形态）。代码一改就会漂，
// 而 R10 只查文档路径、覆盖不到这类引用。R12 校验它们至少能解析：文件存在、行号落在行数范围内。
// 能查到的到此为止——它**不能**判断那一行是否仍是所引用的内容（那需要语义理解）。
// 因此行号在文档里只应当作线索，真正的契约是文件路径与符号名。
{
  const REF_RE = /((?:apps|packages|scripts|docs)\/[A-Za-z0-9_./-]+\.(?:ts|vue|mjs|css|json|ya?ml|md)):(\d+)(?:-(\d+))?/g;
  for (const file of lintTargets) {
    for (const line of read(file).split("\n")) {
      const urls = [...line.matchAll(/https?:\/\/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
      for (const m of line.matchAll(REF_RE)) {
        if (urls.some(([start, end]) => m.index >= start && m.index < end)) continue;
        const [, target, startRaw, endRaw] = m;
        if (!existsSync(join(ROOT, target))) {
          fail("R12", file, `引用的文件不存在：${target}:${startRaw}`);
          continue;
        }
        const lineCount = read(target).split("\n").length;
        for (const n of [Number(startRaw), endRaw ? Number(endRaw) : null]) {
          if (n !== null && (n < 1 || n > lineCount)) {
            fail("R12", file, `行号越界：${target}:${n} 超出该文件行数 ${lineCount}`);
          }
        }
      }
    }
  }
}

/* ---------------------------------------------------------------- 输出 */

for (const [rule, items] of [...errors.reduce((map, e) => map.set(e.rule, [...(map.get(e.rule) ?? []), e]), new Map())].sort()) {
  console.error(`\n[${rule}] ${items.length} 处`);
  for (const item of items) console.error(`  ${item.file}: ${item.msg}`);
}
if (warnings.length > 0) {
  console.error("");
  for (const item of warnings) console.error(`  ⚠ [${item.rule}] ${item.file}: ${item.msg}`);
}

console.log(
  `\n[docs-lint] 检查 ${lintTargets.length} 个文件 · 错误 ${errors.length} · 告警 ${warnings.length}${STRICT ? "（strict）" : ""}`,
);
if (errors.length > 0) process.exit(1);
