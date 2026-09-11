#!/usr/bin/env node
/**
 * 生成 `<!-- docs-gen:<name>:start -->` … `<!-- docs-gen:<name>:end -->` 之间的内容块。
 *
 * 为什么要有这个脚本：现状类文档里的数字（用例数、冒烟项数、内置块数）一旦手写就会漂移，
 * 且没有任何机制会发现。这里把它们全部改成从源码推导后注入，`--check` 则用于 CI 校验同步。
 *
 * 设计约束：本脚本生成的所有数字必须**仅由源码静态推导**，不依赖构建产物、不联网。
 * 否则本地未构建时生成的块会与 CI 里的结果不一致，`--check` 就会假红。
 * 与构建产物相关的约束（前端首屏体积预算）放在 docs-lint.mjs 里做断言，不做成"可生成的数字"。
 *
 * 用法：
 *   node scripts/docs-gen.mjs           写入
 *   node scripts/docs-gen.mjs --check   只校验是否已同步（CI）
 */
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ROOT,
  blockRe,
  countRe,
  docTitle,
  isArchived,
  read,
  walk,
} from "./lib/docs-shared.mjs";

const CHECK_ONLY = process.argv.includes("--check");

/* ------------------------------------------------------------------ 数字块 */

function genNumbers() {
  const packages = [
    { label: "shared", prefix: "packages/shared/", count: 0 },
    { label: "server", prefix: "apps/server/", count: 0 },
    { label: "web", prefix: "apps/web/", count: 0 },
  ];
  for (const file of walk("", (p) => p.endsWith(".test.ts"))) {
    const pkg = packages.find((p) => file.startsWith(p.prefix));
    if (pkg) pkg.count += countRe(read(file), /^\s*it\(/gm);
  }
  const caseTotal = packages.reduce((sum, p) => sum + p.count, 0);

  // 各脚本都用 `function check(...)` 声明一次，减去即是真实检查项数。
  const netsChecks = (path) => countRe(read(path), /\bcheck\(/g) - countRe(read(path), /function check\(/g);

  const smokeTotal = netsChecks("scripts/cdp-ui-smoke.mjs");
  const smokeNoop = countRe(read("scripts/cdp-ui-smoke.mjs"), /check\("[^"]*",\s*true\)/g);

  const apiChecks = ["m2", "m3", "m4", "m6", "m-drill"].map(
    (name) => `${name.replace(/^m-/, "")} ${netsChecks(`scripts/${name}-api-check.mjs`)}`,
  );

  const builtinBlocks = countRe(read("packages/shared/src/prompt.ts"), /id:\s*"builtin\./g);
  const docCount = walk("docs", (p) => p.endsWith(".md") && !isArchived(p)).length;

  const rows = [
    ["测试用例（`it(` 声明数）", `**${caseTotal}**（${packages.map((p) => `${p.label} ${p.count}`).join(" · ")}）`],
    ["UI 冒烟检查项（`pnpm smoke:ui`）", `**${smokeTotal}**（其中 ${smokeNoop} 项为恒真占位，净 ${smokeTotal - smokeNoop}）`],
    ["API 自检项", apiChecks.join(" · ")],
    ["内置提示词块（`BUILTIN_PROMPT_BLOCKS`）", `**${builtinBlocks}**`],
    ["文档数（`docs/` 下 `.md`，不含调研原文）", `${docCount}`],
  ];

  return [
    "<!-- 由 `pnpm docs:gen` 生成，请勿手改；改动源码后重新生成即可 -->",
    "",
    "| 指标 | 当前值 |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ].join("\n");
}

/* ---------------------------------------------------------------- 文档地图 */

// 刻意不在地图里放「最后修改日期」：那样任何一份文档被改动都会让生成块过期，
// 于是每次改文档都得重跑 docs-gen，提交里全是无关噪声。
// 「哪份文档太久没复核」由 docs-lint 的新鲜度规则（last_reviewed + review_days）负责，
// 地图只负责覆盖与发现，所以它只在文档增删改名时才变。
function genMap(hostFile) {
  // 目录与 class 一一对应，让目录本身成为人类可见的分类信号。
  const groups = [
    { dir: "docs", title: "现状" },
    { dir: "docs/decisions", title: "决策（方案 / 选型 / 架构）" },
    { dir: "docs/plans", title: "计划（实施清单 / 路线图）" },
    { dir: "docs/evidence", title: "证据（验收档案，冻结快照）" },
    { dir: "docs/research", title: "调研" },
    { dir: "docs/samples", title: "样例" },
  ];

  const lines = ["<!-- 由 `pnpm docs:gen` 生成，请勿手改 -->", ""];
  for (const group of groups) {
    const files = walk(group.dir, (p) => p.endsWith(".md") && !isArchived(p))
      .filter((p) => relative(group.dir, p).split(/[\\/]/).length === 1)
      .filter((p) => p !== hostFile)
      .sort((a, b) => a.localeCompare(b, "zh"));
    if (files.length === 0) continue;
    lines.push(`**${group.title}**（\`${group.dir}/\`）`, "");
    for (const file of files) {
      lines.push(`- [${docTitle(file)}](./${file.replace(/^docs\//, "").split("\\").join("/")})`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/* ------------------------------------------------------------------ 写回 */

const TARGETS = [
  { file: "README.md", name: "numbers", body: () => genNumbers() },
  { file: "docs/status.md", name: "numbers", body: () => genNumbers() },
  { file: "docs/status.md", name: "map", body: () => genMap("docs/status.md") },
];

const stale = [];
for (const target of TARGETS) {
  const text = read(target.file);
  const re = blockRe(target.name);
  const match = re.exec(text);
  if (!match) {
    console.error(
      `[docs-gen] ${target.file} 缺少标记：<!-- docs-gen:${target.name}:start --> / <!-- docs-gen:${target.name}:end -->`,
    );
    process.exit(1);
  }
  const next = text.replace(re, `$1\n${target.body()}\n$3`);
  if (next === text) continue;
  stale.push(target.file);
  if (!CHECK_ONLY) writeFileSync(join(ROOT, target.file), next, "utf8");
}

if (CHECK_ONLY) {
  if (stale.length > 0) {
    console.error(`[docs-gen] 以下文件的内容块已过期，请运行 pnpm docs:gen：\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log("[docs-gen] 生成块已同步");
} else if (stale.length > 0) {
  console.log(`[docs-gen] 已更新：${stale.join("、")}`);
} else {
  console.log("[docs-gen] 生成块已是最新，无需改动");
}
