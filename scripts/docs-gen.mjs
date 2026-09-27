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

/* ------------------------------------------------------------ 节点清单 */

/**
 * 节点总表**不手写**：节点数是本仓库最容易漂移的一份清单（M6 前后从 8 个长到 16 个），
 * 手写的旧数字会静默误导读者。这里从三个来源静态推导后拼表，并做一致性断言：
 * 类型名/端口/卡宽三处记录必须覆盖同一批类型，可重试与逐项透传名单必须是类型的子集。
 * 任一处对不上就抛错——宁可门禁红，也不能生成一张悄悄少一行或多一行的表。
 *
 * 解析对象是 `packages/shared/src/graph.ts` 的三段对象字面量与另两个 Set 声明。
 * 端口对象里只有一层嵌套、且 `accepts` 里的数组不含更深结构，所以按「条目块 + 端口对象」
 * 两级正则足够；不用 TS 解析器是刻意的：docs-gen 的既有约束是纯静态推导、不引入新依赖。
 */
function parseNodeInventory() {
  const graph = read("packages/shared/src/graph.ts");
  const engineSrc = read("apps/server/src/lib/engine.ts");
  const segmentSrc = read("packages/shared/src/segment.ts");
  const tail = (marker, src = graph) => {
    const index = src.indexOf(marker);
    if (index === -1) throw new Error(`找不到声明：${marker}`);
    return src.slice(index);
  };

  const labels = {};
  for (const m of tail("export const NODE_TYPE_LABELS").matchAll(/^\s*"([a-z]+\.[A-Za-z]+)":\s*"([^"]+)",$/gm)) labels[m[1]] = m[2];

  const widths = {};
  for (const m of tail("export const NODE_CARD_WIDTH").matchAll(/^\s*"([a-z]+\.[A-Za-z]+)":\s*(\d+),$/gm)) widths[m[1]] = Number(m[2]);

  const ports = {};
  const portRe = /\{\s*id:\s*"([^"]+)",\s*type:\s*"([^"]+)"(?:,\s*label:\s*"[^"]+")?(?:,\s*accepts:\s*\[([^\]]*)\])?\s*\}/g;
  for (const chunk of tail("export const NODE_PORTS").split(/\n  "(?=[a-z]+\.[A-Za-z]+")/).slice(1)) {
    const type = /^([a-z]+\.[A-Za-z]+)"/.exec(chunk)?.[1];
    if (!type) continue;
    const body = chunk.slice(chunk.indexOf(":") + 1);
    const entries = [...body.matchAll(portRe)].map((m) => ({
      index: m.index,
      id: m[1],
      accepts: m[3] ? m[3].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : [],
    }));
    const inputsAt = body.indexOf("inputs:");
    const outputsAt = body.indexOf("outputs:");
    if (inputsAt === -1 || outputsAt === -1) throw new Error(`${type} 的端口定义解析失败`);
    ports[type] = {
      inputs: entries.filter((e) => e.index > inputsAt && e.index < outputsAt),
      outputs: entries.filter((e) => e.index > outputsAt),
    };
  }

  const setOf = (src, marker) => {
    const body = tail(marker, src).match(/new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
    return body.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  };
  const retryable = setOf(engineSrc, "export const RETRYABLE_NODE_TYPES");
  const perInput = setOf(segmentSrc, "export const PER_INPUT_NODE_TYPES");

  const types = Object.keys(labels);
  const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));
  if (types.length === 0) throw new Error("NODE_TYPE_LABELS 解析出 0 个类型");
  if (!sameSet(types, Object.keys(widths))) throw new Error("NODE_CARD_WIDTH 与 NODE_TYPE_LABELS 的类型集合不一致");
  if (!sameSet(types, Object.keys(ports))) throw new Error("NODE_PORTS 与 NODE_TYPE_LABELS 的类型集合不一致");
  if (retryable.length === 0 || perInput.length === 0) throw new Error("可重试 / 逐项透传名单解析为空");
  for (const type of [...retryable, ...perInput]) {
    if (!labels[type]) throw new Error(`${type} 出现在可重试或逐项透传名单里，但不在 NODE_TYPE_LABELS 中`);
  }
  for (const type of types) {
    if (type.startsWith("source.") && ports[type].inputs.length > 0) throw new Error(`来源节点 ${type} 不应有输入端口`);
  }

  return { labels, widths, ports, retryable, perInput, types };
}

function genNodeTable() {
  const { labels, widths, ports, retryable, perInput, types } = parseNodeInventory();
  const cell = (list) =>
    list.length === 0 ? "—" : list.map((p) => (p.accepts.length > 0 ? `\`${p.id}\`（${p.accepts.join(" · ")}）` : `\`${p.id}\``)).join("、");
  return [
    "<!-- 由 `pnpm docs:gen` 从 graph.ts / engine.ts / segment.ts 生成，请勿手改 -->",
    "",
    `共 **${types.length}** 个节点类型。端口列写的是 handle id（连线的 \`sourceHandle\` / \`targetHandle\` 用的就是它）；`,
    "括号里是该端口额外接受的类型（`accepts`），未标注即只接受与端口名相同的类型。",
    "",
    "| 节点 | 类型 | 输入端口 | 输出端口 | 卡宽 | 自动重试 | 逐项透传 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...types.map((type) =>
      [
        `**${labels[type]}**`,
        `\`${type}\``,
        cell(ports[type].inputs),
        cell(ports[type].outputs),
        `${widths[type]}px`,
        retryable.includes(type) ? "是" : "—",
        perInput.includes(type) ? "是" : "—",
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    ),
  ].join("\n");
}

/* ------------------------------------------------------------ 接口清单 */

/**
 * 接口清单同样不手写：新增路由是常态，而手写的接口表只会越来越不准。
 * 推导方式是读 `apps/server/src/app.ts` 的 `app.route("<前缀>", <标识符>(...)` 拿到标识符 → 前缀，
 * 再在每个 `routes/*.ts` 里按 `export function <标识符>` 切段，收集该段里 Hono 实例上的方法声明。
 *
 * 两条断言：app.ts 里挂载的每个标识符都要能在对应文件里找到（否则表会静默缺一块）；
 * `routes/` 下每个文件都必须被挂载（新模块忘了接进 app.ts 时会红）。
 */
function parseApiSurface() {
  const app = read("apps/server/src/app.ts");
  // 两种挂载形态：`app.route(p, xApi(db))` 与 `app.route(p, health)`（后者直接传实例）。
  const mountRe = /app\.route\("([^"]+)",\s*([A-Za-z_$][\w$]*)\s*\(?/g;
  const mounts = new Map();
  for (const m of app.matchAll(mountRe)) mounts.set(m[2], m[1]);
  if (mounts.size === 0) throw new Error("app.ts 里解析不出任何 app.route 挂载");

  const files = walk("apps/server/src/routes", (p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
  const groups = [];
  let total = 0;
  for (const file of files) {
    const src = read(file);
    const hono = /const ([A-Za-z_$][\w$]*)\s*=\s*new Hono\(/.exec(src)?.[1];
    if (!hono) throw new Error(`${file} 里找不到 new Hono()`);
    // 两种导出形态都要认：`export function xApi(...)`（内部 const api = new Hono()）
    // 与 `export const xApi = new Hono()`（随后链式挂载）。按声明顺序切段即可。
    const marks = [...src.matchAll(/export function ([A-Za-z_$][\w$]*)|export const ([A-Za-z_$][\w$]*)\s*=\s*new Hono\(\)/g)].map(
      (m) => ({ ident: m[1] ?? m[2], index: m.index }),
    );
    let mounted = false;
    for (let i = 0; i < marks.length; i += 1) {
      const { ident, index } = marks[i];
      const prefix = mounts.get(ident);
      if (!prefix) continue;
      mounted = true;
      const body = src.slice(index, marks[i + 1]?.index ?? src.length);
      const routeRe = new RegExp(`\\b${hono}\\.(get|post|put|patch|delete)\\("([^"]*)"`, "g");
      const routes = [...body.matchAll(routeRe)].map((m) => ({
        method: m[1].toUpperCase(),
        path: m[2] === "/" ? prefix : `${prefix}${m[2]}`,
      }));
      if (routes.length === 0) throw new Error(`${file} 的 ${ident} 挂载在 ${prefix}，但解析出 0 条路由`);
      total += routes.length;
      groups.push({ prefix, file, ident, routes });
    }
    if (!mounted) throw new Error(`${file} 没有被 app.ts 挂载（新增模块请接进 createApp）`);
  }
  return { groups, total };
}

function genApiTable() {
  const { groups, total } = parseApiSurface();
  const lines = [
    "<!-- 由 `pnpm docs:gen` 从 app.ts 与 routes/*.ts 生成，请勿手改 -->",
    "",
    `共 **${total}** 条接口。路径即挂载后的完整路径，可直接调用（Hono 会把子应用的 \`/\` 合并为前缀本身，故无尾斜杠）；`,
    "本服务**没有任何认证中间件**，CORS 默认放开，仅适合自托管或本机使用。",
    "",
    "| 方法 | 路径 | 实现 |",
    "| --- | --- | --- |",
  ];
  for (const group of groups) {
    for (const route of group.routes) {
      lines.push(`| ${route.method} | \`${route.path}\` | \`${group.file.replace("apps/server/src/", "")}\` 的 \`${group.ident}\` |`);
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ 写回 */

const TARGETS = [
  { file: "README.md", name: "numbers", body: () => genNumbers() },
  { file: "docs/status.md", name: "numbers", body: () => genNumbers() },
  { file: "docs/status.md", name: "map", body: () => genMap("docs/status.md") },
  { file: "docs/nodes.md", name: "inventory", body: () => genNodeTable() },
  { file: "docs/architecture.md", name: "api", body: () => genApiTable() },
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
