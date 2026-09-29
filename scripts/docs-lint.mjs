#!/usr/bin/env node
/**
 * 文档门禁。目标不是"检查有没有文档"，而是让**已确认会发生的那几类文档漂移直接变成 CI 失败**。
 *
 *   R1  front matter 合法（class / status 取值、必填键）
 *   R3  docs-gen 生成块已同步（文档地图与节点/接口清单不是手写的）
 *   R4  文档地图覆盖 docs/ 下全部文档（防手改漏项）
 *   R5  deprecated / superseded 的文档正文不得再出现"按此执行"类祈使句
 *   R8  相对链接指向的文件必须存在
 *   R10 源码注释与正文里以 docs/ 写的文档路径必须真实存在（R8 只查 markdown 链接）
 *
 * 2026-09-30 删掉的六条规则与理由（不是"暂时关掉"，是判定为过度工程）：
 *   R2  supersede/superseded_by 双向链接——全仓只有一对文档用到，为它养一条双向校验不划算；
 *       被取代的文档现在直接删除（git 历史可查），这条规则失去了存在前提。
 *   R6  验收档案内容指纹——唯一消费者是它自己与阅读器上的"内容指纹"字段；git 提交哈希就是冻结。
 *   R7  现状文档禁手写漂移数字——数字指标块本身已删除（不再有"生成块"这个正确去处），
 *       规则变成"一律不许写数字"，那是越权。
 *   R9  前端首屏 gzip 预算——与文档无关，藏在文档门禁里且本地无 dist 时静默跳过，
 *       已移到 scripts/size-budget.mjs，由 CI 在 build 之后显式执行。
 *   R11 class 必须与所在目录一致——目录名已经是分类信号，再用字段重复一遍、再用规则守一致性，
 *       是同一件事写三遍；plans/ 与 evidence/ 目录也一并删除。
 *   R12 文档里的 代码路径:行号 必须可解析——它只能验"文件存在、行号不越界"，验不了那一行是否仍是
 *       所引用的内容（实测已经放过 status.md 里指向 engine.ts:511 的失效引用），却给人"已校验"的错觉，
 *       还鼓励作者继续写会腐烂的行号。约定改为：引用写文件路径与符号名，不写行号。
 *   新鲜度（last_reviewed + review_days + 周扫 --strict）——单人仓库、机器判不了内容是否仍正确；
 *       日期是手填的，实测引用腐烂时它不会响。已删除。
 *
 * 分阶段生效：docs/ 下除样例与抓取原文外强制要求 front matter。
 *
 * 用法：node scripts/docs-lint.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  CLASS_RULES,
  DIRECTORY_CLASS,
  ROOT,
  STATUS_ENUM,
  parseFrontMatter,
  read,
  requiresFrontMatter,
  walk,
} from "./lib/docs-shared.mjs";

/** R5：已废弃的文档不允许继续发号施令。刻意保持高精度，宁漏勿误。 */
const IMPERATIVE_RE = /按此执行|按此实现|按此落地|按此规范|照此执行/;

const errors = [];
const fail = (rule, file, msg) => errors.push({ rule, file, msg });

/* ------------------------------------------------------------------ 收集 */

const allDocs = walk("docs", (p) => p.endsWith(".md"));
const lintTargets = [...allDocs, "README.md", "AGENTS.md", "CHANGELOG.md"].filter((p) => existsSync(join(ROOT, p)));
const frontMatter = new Map();

/* ------------------------------------------------------------------- R1 */

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

  // R11 已删除，但"放错目录"仍是最常见的分类错误：这里只做一次廉价断言，
  // 不引入新规则——目录名是分类信号，class 与目录不符时直接指向所在目录。
  const rule = DIRECTORY_CLASS.find((r) => r.re.test(file));
  if (!rule && requiresFrontMatter(file)) {
    fail("R1", file, "不在约定目录内（docs/ 根、decisions/、research/）");
  } else if (rule && rule.cls !== cls) {
    fail("R1", file, `class: ${cls} 与所在目录不符——${rule.label} 只放 class: ${rule.cls}`);
  }

  // R5：已废弃/被取代的文档不得继续下达指令。
  if (cls === "decision" && (data.status === "deprecated" || data.status === "superseded")) {
    const hit = IMPERATIVE_RE.exec(body);
    if (hit) fail("R5", file, `status: ${data.status} 但正文仍含祈使句「${hit[0]}」，请改为陈述历史或直接删除该文档`);
  }
}

/* ------------------------------------------------------------------- R3 */

try {
  execFileSync("node", [join(ROOT, "scripts", "docs-gen.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  const detail = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
  fail("R3", "scripts/docs-gen.mjs", `生成块未同步：${detail.trim().split("\n").slice(-3).join(" ")}`);
}

/* ------------------------------------------------------------------- R4 */

{
  const mapHost = "README.md";
  if (existsSync(join(ROOT, mapHost))) {
    const block = /<!-- docs-gen:map:start -->([\s\S]*?)<!-- docs-gen:map:end -->/.exec(read(mapHost))?.[1] ?? "";
    const missing = allDocs.filter((p) => !block.includes(relative("docs", p).split("\\").join("/")));
    if (missing.length > 0) {
      fail("R4", mapHost, `文档地图未覆盖 ${missing.length} 份文档：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " …" : ""}`);
    }
  }
}

/* ------------------------------------------------------------------- R8 */

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

/* ------------------------------------------------------------------ R10 */

// 源码注释与文档正文里会以「仓库相对」形式写文档路径（如 prompt.ts 注释里写的文档路径），
// 这类引用不是 markdown 链接，R8 的链接检查覆盖不到——文档一搬家它们就静默失效。
// 这里统一校验它们指向的文件真实存在。
// 必须排除 URL 内部的同名片段：外部链接常长成 GitHub 上某个仓库的 content 目录下的同名 md，那不是本仓库路径。
{
  const scanned = [
    ...walk("apps", (p) => /\.(?:ts|vue)$/.test(p) && !p.endsWith(".test.ts")),
    ...walk("packages", (p) => /\.(?:ts|vue)$/.test(p) && !p.endsWith(".test.ts")),
    ...walk("scripts", (p) => p.endsWith(".mjs")),
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

/* ---------------------------------------------------------------- 输出 */

for (const [rule, items] of [...errors.reduce((map, e) => map.set(e.rule, [...(map.get(e.rule) ?? []), e]), new Map())].sort()) {
  console.error(`\n[${rule}] ${items.length} 处`);
  for (const item of items) console.error(`  ${item.file}: ${item.msg}`);
}

console.log(`\n[docs-lint] 检查 ${lintTargets.length} 个文件 · 错误 ${errors.length}`);
if (errors.length > 0) process.exit(1);
