/**
 * 用**同一份真实报告数据**生成 5 套 Obsidian 导出候选：内容一字不差，只改排版。
 *
 * 跑法（tsx 是 apps/server 的依赖，脚本要 import shared 的 TS 源码）：
 *   cd apps/server && node --import tsx "../../note-candidates/溯源导出demo/tools/build-candidates.mts"
 *
 * 输入：note-candidates/溯源导出demo/source-report.json（run_3c81c376 那次真实运行的产物，27 条）
 * 输出：同目录下的 0-现状基线 / A / B / C / D / E 六份 .md（可在 Obsidian 里直接打开这个文件夹当库对比）
 *
 * 生成的 candidate 就是未来 `traceReportToMarkdown` 的备选实现——所以这里不加"演示专用"的东西，
 * 每一句都按真产物该有的样子写。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTraceReport,
  traceReportToMarkdown,
  TRACE_CATEGORY_LABELS,
  TRACE_CONFIDENCE_LABELS,
  TRACE_EVIDENCE_LABELS,
  TRACE_EXTERNAL_STATUS_LABELS,
  TRACE_SOURCE_AUTHORITY_LABELS,
  type TraceExternalSource,
  type TraceItem,
  type TraceReport,
} from "../../../packages/shared/src/trace.ts";

const DIR = fileURLToPath(new URL("..", import.meta.url));
const report = parseTraceReport(readFileSync(join(DIR, "source-report.json"), "utf8"));
if (!report) throw new Error("source-report.json 解析失败");

const TITLE = "《中美社保对比，有哪些不同？》 · 信息溯源";

/* ------------------------------------------------------------------ 公共件 */

/** front matter 与引擎写进库的那份逐字一致（另加 D 的 cssclasses）。 */
function frontMatter(extra: string[] = []): string {
  return [
    "---",
    `标题: ${TITLE}`,
    "类型: 溯源笔记",
    "来源: B站",
    "作者: 内部看美国",
    "原始链接: https://www.bilibili.com/video/BV1DTWw6UE1y",
    "创建日期: 2026-10-16",
    ...extra,
    "tags:",
    "  - 来源/B站",
    "  - UP：内部看美国",
    "---",
    "",
    "",
  ].join("\n");
}

const category = (item: TraceItem) => TRACE_CATEGORY_LABELS[item.category] ?? item.category;
const confidence = (item: TraceItem) => TRACE_CONFIDENCE_LABELS[item.confidence] ?? item.confidence;
const statusOf = (item: TraceItem) => (item.external ? TRACE_EXTERNAL_STATUS_LABELS[item.external.status] ?? item.external.status : "未联网核查");

/** 一行元信息：`客观信息 · 原文可见 · 外部可印证`。 */
const metaLine = (item: TraceItem) => `${category(item)} · ${confidence(item)} · ${statusOf(item)}`;

/**
 * 核查状态 → callout 类型（折叠时一眼看得出哪几条要留意：绿/橙/红/灰）。
 * 类型名必须是 Obsidian 认识的，写错会静默回落成蓝色 note（官方文档：不支持的类型默认为 note）。
 */
function statusCallout(item: TraceItem): string {
  switch (item.external?.status) {
    case "verified":
      return "success";
    case "weak_source":
      return "warning";
    case "contradicted":
      return "danger";
    case "not_found":
      return "failure";
    default:
      return "info";
  }
}

/** 某条主张是否「需要留意」（与网页版 `flagged` 同口径：非权威 / 有反证 / 未找到出处）。 */
const isFlagged = (item: TraceItem) =>
  item.external ? ["weak_source", "contradicted", "not_found"].includes(item.external.status) : false;

const queriesOf = (item: TraceItem) =>
  (item.external?.queries ?? (item.external?.query ? [item.external.query] : [])).map((q) => q.trim()).filter(Boolean);

/** 来源一行：`[权威] 政府网 · 标题 <url>`（与基线同格式，只换承载它的容器）。 */
function sourceLine(source: TraceExternalSource): string {
  const title = source.title?.trim() ?? source.url?.trim() ?? "";
  const authority = source.authority ? `[${TRACE_SOURCE_AUTHORITY_LABELS[source.authority]}] ` : "";
  const publisher = source.publisher?.trim() ? `${source.publisher.trim()} · ` : "";
  const url = source.url?.trim() ? ` <${source.url.trim()}>` : "（本次检索未返回链接）";
  const noFetch = source.fetched === false && source.url ? "（本轮未抓正文）" : "";
  return `${authority}${publisher}${title}${url}${noFetch}`;
}

/** 联网核查的全部详情，逐行加 `> ` 前缀后塞进 callout。 */
function externalCalloutBody(item: TraceItem): string[] {
  const ext = item.external!;
  const lines: string[] = [];
  if (ext.summary?.trim()) lines.push(ext.summary.trim(), "");
  for (const source of ext.sources ?? []) {
    lines.push(`- ${sourceLine(source)}`);
    for (const quote of source.quotes ?? []) lines.push(`  - 原文：“${quote.text.trim()}”${quote.note?.trim() ? ` —— ${quote.note.trim()}` : ""}`);
  }
  const queries = queriesOf(item);
  if (queries.length > 0) lines.push("", `检索词：${queries.join(" / ")}`);
  if (ext.note?.trim()) lines.push("", `说明：${ext.note.trim()}`);
  return lines;
}

/** 核查结论做成 callout 的标题（「有原文引证」这类也带上，正文里就不再重复一遍状态）。 */
function externalCalloutTitle(item: TraceItem): string {
  const evidence = item.external?.evidence ? ` · ${TRACE_EVIDENCE_LABELS[item.external.evidence]}` : "";
  return `联网核查 · ${statusOf(item)}${evidence}`;
}

/** 原文依据的行（与基线一致：`（来源 · 定位）“引文”`）。 */
function evidenceLines(item: TraceItem): string[] {
  if (item.evidence.length === 0) return ["_本条无直接原文引用，需结合备注判断。_"];
  return item.evidence.map((e) => `- （${e.source?.name ?? "原文"} · ${e.locator ?? e.source?.locator ?? "未标注"}）“${e.quote.trim()}”`);
}

/** 归因 / 判断依据 / 备注 / 提及 —— 四类旁注，各候选的承载方式不同，内容取这里。 */
function sideLines(item: TraceItem): { attribution?: string; basis?: string; note?: string; mentions: string[] } {
  const attribution = item.attribution
    ? item.attribution.kind === "external"
      ? `外部归因：${item.attribution.name ?? "未指明"}${item.attribution.detail ? `（${item.attribution.detail}）` : ""}`
      : item.attribution.kind === "self"
        ? "内部观点：作者/讲述者本人提出"
        : "归属不明：无法判断是原创还是转述"
    : undefined;
  return {
    attribution,
    basis: item.basis?.trim() ? `判断依据：${item.basis.trim()}` : undefined,
    note: item.note?.trim() ? `备注：${item.note.trim()}` : undefined,
    mentions: (item.mentions ?? []).map((m) => `其他位置：${m.source?.locator ?? "未标注"}“${m.quote.trim()}”`),
  };
}

/** 把若干行包进一个折叠 callout。 */
function callout(type: string, title: string, body: string[], fold = true): string[] {
  return [`> [!${type}]${fold ? "-" : ""} ${title}`, ...body.map((line) => (line ? `> ${line}` : ">")), ""];
}

const stats = (r: TraceReport) => {
  const items = r.items;
  const external = items.filter((i) => i.external);
  const authority = external.filter((i) => i.external!.authorityCounts?.authoritative || i.external!.authorityCounts?.reference);
  const verbatim = external.filter((i) => i.external!.evidence === "verbatim" || (i.external!.sources ?? []).some((s) => (s.quotes ?? []).length > 0));
  const flagged = items.filter(isFlagged);
  const byStatus = (status: string) => items.filter((i) => i.external?.status === status).length;
  return { items, external, authority, verbatim, flagged, byStatus };
};

/* ------------------------------------------------------- A 主张即标题 + 折叠 */

function buildA(r: TraceReport): string {
  const s = stats(r);
  const out: string[] = [frontMatter().trimEnd(), "", `# ${TITLE}`, ""];
  if (r.summary?.trim()) out.push(r.summary.trim(), "");
  out.push(
    ...callout(
      "summary",
      "溯源速览",
      [
        `**${s.items.length}** 条主张 · 原文可见 ${s.items.filter((i) => i.confidence === "confirmed").length} · 间接推断 ${s.items.filter((i) => i.confidence === "likely").length} · 待核实 ${s.items.filter((i) => i.confidence === "uncertain").length + (r.uncertainties?.length ?? 0)}`,
        `进入联网核查 **${s.external.length}** 条 · 有权威来源 ${s.authority.length} 条 · 附来源原文引证 ${s.verbatim.length} 条`,
        `**需要留意 ${s.flagged.length} 条**（折叠块标题就是核查结论：绿色已印证 / 橙色仅非权威 / 红色未找到出处）`,
        "",
        `条目明细见下，每条的主张都是标题（可被 \`[[#主张]]\` 指向），长的部分默认折起来。`,
      ],
      false,
    ),
    `## 条目明细（${s.items.length} 条）`,
    "",
  );
  r.items.forEach((item, index) => {
    out.push(`### ${index + 1}. ${item.claim}`, "", `\`${metaLine(item)}\``, "");
    const side = sideLines(item);
    if (item.external) out.push(...callout(statusCallout(item), externalCalloutTitle(item), externalCalloutBody(item)));
    out.push(...callout("quote", "原文依据", evidenceLines(item)));
    for (const line of [side.attribution, side.basis, side.note, ...side.mentions].filter(Boolean)) out.push(`- ${line}`);
    out.push("");
  });
  out.push(...tailSections(r));
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ------------------------------------------------- B 按核查状态分组（问题优先） */

const GROUPS: { status: string; title: string; note: string }[] = [
  { status: "contradicted", title: "外部有反证", note: "检索到与说法矛盾的权威来源——先看这一组。" },
  { status: "not_found", title: "未找到外部出处", note: "网上查不到支持它的来源，只能当「视频里的说法」看。" },
  { status: "weak_source", title: "仅非权威来源", note: "网上有说法，但都来自自媒体/未判定站点，不构成权威出处。" },
  { status: "verified", title: "外部可印证", note: "拿到了权威来源（政府/学术/官方机构/官方媒体）。" },
];

function buildB(r: TraceReport): string {
  const s = stats(r);
  const out: string[] = [frontMatter().trimEnd(), "", `# ${TITLE}`, ""];
  if (r.summary?.trim()) out.push(r.summary.trim(), "");
  out.push(
    ...callout(
      "summary",
      "溯源速览",
      [
        `**${s.items.length}** 条主张 · 进入联网核查 **${s.external.length}** 条 · 有权威来源 ${s.authority.length} 条 · 附来源原文引证 ${s.verbatim.length} 条`,
        "",
        ...GROUPS.filter((g) => s.byStatus(g.status) > 0).map((g) => `- ${g.title} **${s.byStatus(g.status)}** 条`),
        `- 未联网核查 **${s.items.length - s.external.length}** 条`,
        "",
        "条目**按上面的顺序分组**（问题优先），组内保持原文顺序。",
      ],
      false,
    ),
  );
  for (const group of GROUPS) {
    const items = r.items.filter((i) => i.external?.status === group.status);
    if (items.length === 0) continue;
    out.push(`## ${group.title}（${items.length} 条）`, "", `_${group.note}_`, "");
    items.forEach((item) => {
      const index = r.items.indexOf(item) + 1;
      out.push(`### ${index}. ${item.claim}`, "", `\`${metaLine(item)}\``, "");
      const side = sideLines(item);
      out.push(...callout(statusCallout(item), externalCalloutTitle(item), externalCalloutBody(item)));
      out.push(...callout("quote", "原文依据", evidenceLines(item)));
      for (const line of [side.attribution, side.basis, side.note, ...side.mentions].filter(Boolean)) out.push(`- ${line}`);
      out.push("");
    });
  }
  const rest = r.items.filter((i) => !i.external);
  if (rest.length > 0) {
    out.push(`## 未联网核查（${rest.length} 条）`, "", "_作者观点、术语定义这类不需要外部出处的内容，或本轮未进入核查的条目。_", "");
    rest.forEach((item) => {
      const index = r.items.indexOf(item) + 1;
      out.push(`### ${index}. ${item.claim}`, "", `\`${metaLine(item)}\``, "");
      const side = sideLines(item);
      out.push(...callout("quote", "原文依据", evidenceLines(item)));
      for (const line of [side.attribution, side.basis, side.note, ...side.mentions].filter(Boolean)) out.push(`- ${line}`);
      out.push("");
    });
  }
  out.push(...tailSections(r));
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------------------------------------------------------- C 语法用满（脚注收来源） */

function buildC(r: TraceReport): string {
  const s = stats(r);
  const footnotes: string[] = [];
  const footnoteIndex = new Map<string, number>();
  const noteFor = (source: TraceExternalSource): number => {
    const key = `${source.url ?? ""}|${source.title ?? ""}`;
    const existing = footnoteIndex.get(key);
    if (existing) return existing;
    const index = footnotes.length + 1;
    footnoteIndex.set(key, index);
    const quotes = (source.quotes ?? []).map((q) => `    > “${q.text.trim()}”`).join("\n");
    footnotes.push(`[^${index}]: ${sourceLine(source)}${quotes ? `\n${quotes}` : ""}`);
    return index;
  };

  const out: string[] = [frontMatter().trimEnd(), "", `# ${TITLE}`, ""];
  if (r.summary?.trim()) out.push(r.summary.trim(), "");
  out.push(
    ...callout(
      "summary",
      "溯源速览",
      [
        `**${s.items.length}** 条主张 · 进入联网核查 **${s.external.length}** 条 · 需要留意 **${s.flagged.length}** 条`,
        "",
        "来源全部以脚注收在文末（正文里只留 `[^n]`），点角标可跳转；条目按核查结论分组。",
      ],
      false,
    ),
  );
  for (const group of GROUPS) {
    const items = r.items.filter((i) => i.external?.status === group.status);
    if (items.length === 0) continue;
    out.push(`## ${group.title}（${items.length} 条）`, "");
    items.forEach((item) => {
      const index = r.items.indexOf(item) + 1;
      const ext = item.external!;
      const refs = (ext.sources ?? []).map((source) => `[^${noteFor(source)}]`).join(" ");
      // 关键数字高亮：报告里最常被回头引用的是数字
      const summary = (ext.summary ?? "").replace(/(\d[\d,.]*\s*(?:%|美元|条|倍|岁|个月|年)?)/g, "==$1==");
      out.push(`### ${index}. ${item.claim}`, "", `\`${metaLine(item)}\``, "");
      out.push(`> [!${statusCallout(item)}]- ${externalCalloutTitle(item)}`, `> ${summary}`, `> 来源：${refs || "（本次检索未返回链接）"}`, "");
      out.push(...callout("quote", "原文依据", evidenceLines(item)));
      const side = sideLines(item);
      for (const line of [side.attribution, side.basis, side.note, ...side.mentions].filter(Boolean)) out.push(`- ${line}`);
      out.push("");
    });
  }
  const rest = r.items.filter((i) => !i.external);
  if (rest.length > 0) {
    out.push(`## 未联网核查（${rest.length} 条）`, "");
    rest.forEach((item) => {
      const index = r.items.indexOf(item) + 1;
      out.push(`### ${index}. ${item.claim}`, "", `\`${metaLine(item)}\``, "");
      out.push(...callout("quote", "原文依据", evidenceLines(item)));
      const side = sideLines(item);
      for (const line of [side.attribution, side.basis, side.note, ...side.mentions].filter(Boolean)) out.push(`- ${line}`);
      out.push("");
    });
  }
  out.push(...tailSections(r));
  out.push(`## 来源（${footnotes.length} 条）`, "", ...footnotes);
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ------------------------------------------------ E 折叠索引（一条一个 callout） */

function buildE(r: TraceReport): string {
  const s = stats(r);
  const out: string[] = [frontMatter().trimEnd(), "", `# ${TITLE}`, ""];
  if (r.summary?.trim()) out.push(r.summary.trim(), "");
  out.push(
    ...callout(
      "summary",
      "溯源速览",
      [
        `**${s.items.length}** 条 · 需要留意 **${s.flagged.length}** 条（橙色/红色那几行）`,
        "",
        "每条一行，点开看结论与来源；**不带标题**，所以右侧大纲只有这一行速览。",
      ],
      false,
    ),
    `## 条目明细（${s.items.length} 条，点开看）`,
    "",
  );
  /*
   * 索引按核查结论分组：平铺时状态只是行中间的一句文字，扫不出哪几条有问题——
   * 而「一眼看出问题」正是这一套的全部卖点（分组后每组一个小标题，组内保持原文顺序）。
   */
  const INDEX_GROUPS: { status: string; title: string }[] = [
    { status: "contradicted", title: "外部有反证" },
    { status: "not_found", title: "未找到外部出处" },
    { status: "weak_source", title: "仅非权威来源" },
    { status: "verified", title: "外部可印证" },
  ];
  const indexBody: string[] = [];
  for (const group of INDEX_GROUPS) {
    const items = r.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.external?.status === group.status);
    if (items.length === 0) continue;
    indexBody.push(`**${group.title}（${items.length}）**`, "", ...items.map(({ item, index }) => `- ${String(index + 1).padStart(2, "0")} · ${item.claim}`), "");
  }
  const noCheck = r.items.map((item, index) => ({ item, index })).filter(({ item }) => !item.external);
  if (noCheck.length > 0) {
    indexBody.push(`**未联网核查（${noCheck.length}）**`, "", ...noCheck.map(({ item, index }) => `- ${String(index + 1).padStart(2, "0")} · ${item.claim}`), "");
  }
  out.push(...callout("example", "打开全部条目（按核查结论分组）", indexBody));
  r.items.forEach((item, index) => {
    const side = sideLines(item);
    const body: string[] = [`**${metaLine(item)}**`, ""];
    if (item.external) {
      body.push(...externalCalloutBody(item));
    }
    body.push("**原文依据**", "", ...evidenceLines(item));
    const sides = [side.attribution, side.basis, side.note, ...side.mentions].filter(Boolean);
    if (sides.length > 0) body.push("", ...sides.map((line) => `- ${line}`));
    out.push(...callout(statusCallout(item), `${String(index + 1).padStart(2, "0")} · ${item.claim}`, body));
  });
  out.push(...tailSections(r));
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/* --------------------------------------------------------------- 尾部两节 */

function tailSections(r: TraceReport): string[] {
  const out: string[] = [];
  if ((r.uncertainties ?? []).length > 0) {
    out.push(`## 待核实（${r.uncertainties!.length} 条）`, "");
    // 照已落地的写法：标题带保持短（「待核实 N」），claim 加粗放在正文首行——长句塞进标题会挤成一团
    (r.uncertainties ?? []).forEach((u, index) => {
      out.push(...callout("question", `待核实 ${index + 1}`, [`**${u.claim}**`, "", u.reason ?? "原文未明确说明"]));
    });
  }
  if ((r.warnings ?? []).length > 0) {
    out.push(`## 提醒（${r.warnings!.length} 条）`, "");
    for (const w of r.warnings!) out.push(`- ${w}`);
    out.push("");
  }
  return out;
}

/* ------------------------------------------------------------------ 输出 */

const files: [string, string][] = [
  ["0-现状基线.md", traceReportToMarkdown(report, { fallbackTitle: TITLE })],
  // A/B/C/E 的构造函数自己开头就写了 front matter；D 是「Markdown 与基线逐字一致、只多一行 cssclasses」
  ["A-主张即标题（详情折叠）.md", buildA(report)],
  ["B-按核查状态分组（问题优先）.md", buildB(report)],
  ["C-语法用满（来源用脚注）.md", buildC(report)],
  ["D-只改样式（cssclasses）.md", frontMatter(["cssclasses:", "  - scribeflow-trace"]) + traceReportToMarkdown(report, { fallbackTitle: TITLE })],
  ["E-折叠索引（一条一个块）.md", buildE(report)],
];

const rows: string[] = [];
for (const [name, content] of files) {
  writeFileSync(join(DIR, name), content, "utf8");
  const lines = content.split("\n");
  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
  rows.push(
    [
      name.padEnd(34),
      `字符 ${String(content.length).padStart(6)}`,
      `行 ${String(lines.length).padStart(4)}`,
      `二级 ${count(/^## /)}`,
      `三级 ${count(/^### /)}`,
      `callout ${count(/^> \[!/)}`,
      `顶层 bullet ${count(/^- /)}`,
      `缩进 bullet ${count(/^ {2,}- /)}`,
      `脚注 ${count(/^\[\^\d+\]:/)}`,
    ].join(" · "),
  );
}
console.log(rows.join("\n"));
