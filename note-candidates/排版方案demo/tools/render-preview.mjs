/**
 * 生成「Obsidian 排版方案」对比用的 HTML 与 PNG。
 *
 * 用法：node "note-candidates/排版方案demo/tools/render-preview.mjs"
 *
 * 产物：
 *   docs/research/obsidian-note-typography-demos.html   总览页（自包含，可直接用浏览器打开）
 *   docs/research/obsidian-note-typography-*.png        对比图
 *   .tmp-shots/obs-typography/                          中间文件与 Chrome profile（已 gitignore）
 *
 * 说明：
 * - markdown 用 `marked` 渲染（apps/web 的直接依赖，经 createRequire 解析，不新装依赖）；
 *   `marked` 不认识 Obsidian 的 callout，所以本脚本自带一个 block 级扩展，把
 *   `> [!type]± 标题` 渲染成 Obsidian 的 callout 结构。
 * - 截图用本机真实 Chrome + CDP，零第三方依赖——骨架与 `scripts/cdp-ui-smoke.mjs` 同一套。
 * - 预览样式是近似（标定依据见 tools/obsidian-preview.css 顶部）；**真实观感以在 Obsidian 里
 *   打开 demo 库为准**，不要把 PNG 当成 Obsidian 的截图。
 */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEMO = join(ROOT, "note-candidates", "排版方案demo");
const WORK = join(ROOT, ".tmp-shots", "obs-typography");
const RESEARCH = join(ROOT, "docs", "research");
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9345);

const require = createRequire(join(ROOT, "apps", "web", "package.json"));
const { marked } = await import(pathToFileURL(require.resolve("marked")).href);

const CSS = readFileSync(join(DEMO, "tools", "obsidian-preview.css"), "utf8");
/** 方案 D 的 CSS 片段：直接内联进来，预览里看到的就是这份片段的效果 */
const SNIPPET = readFileSync(join(DEMO, "snippets", "scribeflow.css"), "utf8");

/* ------------------------------------------------------------ callout 扩展 */

/** Lucide 图标（ISC）的内层路径，取自 lucide-static；type → 图标与配色见 tools/*.css 顶部说明。 */
const ICONS = {
  "clipboard-list":
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  list:
    '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
};
const CALLOUT_ICON = {
  abstract: "clipboard-list",
  summary: "clipboard-list",
  tldr: "clipboard-list",
  example: "list",
  quote: "quote",
  cite: "quote",
};
const CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

const svgIcon = (name, className) =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.pencil}</svg>`;

const escapeHtml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 折叠 callout 渲染成展开态：用来出「点开后」的对照图。 */
let forceOpen = false;

const calloutExtension = {
  name: "callout",
  level: "block",
  start(src) {
    const index = src.search(/^> \[!/m);
    return index === -1 ? undefined : index;
  },
  tokenizer(src) {
    const head = /^> \[!([^\]]+)\]([+-]?)[ \t]*([^\n]*)/.exec(src);
    if (!head) return undefined;
    const lines = src.split("\n");
    const block = [];
    for (const line of lines) {
      if (!/^>/.test(line)) break;
      block.push(line);
    }
    const token = {
      type: "callout",
      raw: block.join("\n"),
      typeId: head[1].trim().toLowerCase(),
      fold: head[2],
      title: head[3].trim(),
      tokens: [],
    };
    // 内容从第二行开始：第一行是 `> [!type]± 标题` 本身（它的作用只是声明类型与标题）
    this.lexer.blockTokens(block.slice(1).map((line) => line.replace(/^>[ \t]?/, "")).join("\n"), token.tokens);
    return token;
  },
  renderer(token) {
    const title = token.title || token.typeId.replace(/(^|-)([a-z])/g, (_, dash, ch) => (dash ? " " : "") + ch.toUpperCase());
    const icon = svgIcon(CALLOUT_ICON[token.typeId] ?? "pencil", "svg-icon");
    const foldable = token.fold === "+" || token.fold === "-";
    const open = token.fold === "+" || forceOpen;
    const content = this.parser.parse(token.tokens);
    const titleInner = `<div class="callout-icon">${icon}</div><div class="callout-title-inner">${escapeHtml(title)}</div>`;
    if (!foldable) {
      return `<div class="callout" data-callout="${token.typeId}"><div class="callout-title">${titleInner}</div><div class="callout-content">${content}</div></div>`;
    }
    const fold = `<div class="callout-fold${open ? "" : " is-collapsed"}">${CHEVRON}</div>`;
    return `<details class="callout is-collapsible" data-callout="${token.typeId}"${open ? " open" : ""}><summary class="callout-title">${titleInner}${fold}</summary><div class="callout-content">${content}</div></details>`;
  },
};

/** Obsidian 的 `==高亮==`：marked（GFM）不认识，补一个内联扩展，否则预览里会原样打出两个等号。 */
const highlightExtension = {
  name: "highlight",
  level: "inline",
  start(src) {
    const index = src.indexOf("==");
    return index === -1 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^==([^=\n]+)==/.exec(src);
    if (!match) return undefined;
    const token = { type: "highlight", raw: match[0], tokens: [] };
    this.lexer.inlineTokens(match[1], token.tokens);
    return token;
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

marked.use({ gfm: true, extensions: [calloutExtension, highlightExtension] });

/* -------------------------------------------------------------- 解析 demo 文件 */

/** 极简 frontmatter：够读我们写的这几个文件（标量 + 字符串列表）。 */
function splitFrontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { fields: [], body: text };
  const fields = [];
  let current = null;
  for (const line of match[1].split("\n")) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && current) {
      current.values.push(item[1].trim());
      continue;
    }
    const kv = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    current = { name: kv[1].trim(), values: kv[2].trim() ? [kv[2].trim()] : [] };
    fields.push(current);
  }
  return { fields, body: text.slice(match[0].length) };
}

const SCHEMES = [
  { file: "0-现状基线.md", id: "baseline", label: "0 · 现状基线（现在导出的样子）" },
  { file: "A-纯Markdown骨架.md", id: "a", label: "A · 纯 Markdown 骨架（不用 callout）" },
  { file: "B-Callout容器.md", id: "b", label: "B · Callout 容器（推荐）" },
  { file: "C-Obsidian语法上限.md", id: "c", label: "C · Obsidian 语法上限" },
  { file: "D-只改样式（cssclasses）.md", id: "d", label: "D · 只改样式（cssclasses + CSS 片段）" },
];

const notes = SCHEMES.map((scheme) => {
  const raw = readFileSync(join(DEMO, scheme.file), "utf8").replace(/\r\n/g, "\n");
  const { fields, body } = splitFrontMatter(raw);
  const chunks = {
    sulan: sliceChunk(body, /^(## 速览$|> \[!summary\])/, /^(## (?!速览|速查)|### )/),
    body: sliceChunk(body, /^(## (?!速览|速查)|### )/, /^(## 速查$|> \[!example\])/),
    sucha: sliceChunk(body, /^(## 速查$|> \[!example\])/, null),
    // 第 4 节：方案 C 的原话引用块与 ==高亮== 在这里，正文对比图要单独放它（基线里这节是 ###、C 里是 ##）
    quoteSection: sliceChunk(body, /^#{2,3} 中美公共部门退休待遇/, /^(#{2,3} |## 速查$|> \[!example\])/),
  };
  return { ...scheme, fields, body, chunks };
});

/** 取 [start, end) 之间的片段；两端按整行匹配，尾部多余的分隔线去掉。 */
function sliceChunk(body, startRe, endRe) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => startRe.test(line));
  if (start === -1) throw new Error(`找不到片段的起点：${startRe}`);
  const rest = lines.slice(start + 1); // 首行单独取，下面拼回时保留（它是 `## 速览` 或 `> [!summary] 速览` 那一行）
  const end = endRe ? rest.findIndex((line) => endRe.test(line)) : rest.length;
  let chunk = [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
  chunk = chunk.replace(/\n+---\n+$/, "\n");
  return chunk.trim();
}

/* ------------------------------------------------------------------ 页面拼装 */

function renderNote(note) {
  forceOpen = false;
  const properties = note.fields.length
    ? `<div class="properties">${note.fields
        .map(
          (field) =>
            `<div class="prop-row"><div class="prop-name">${escapeHtml(field.name)}</div><div class="prop-value">${field.values
              .map((value) => (field.values.length > 1 || /^(tags|cssclasses)$/.test(field.name) ? `<span class="prop-chip">${escapeHtml(value)}</span>` : escapeHtml(value)))
              .join("")}</div></div>`,
        )
        .join("")}</div>`
    : "";
  const extraClass = note.fields.some((field) => field.name === "cssclasses") ? " scribeflow" : "";
  return `${properties}<div class="markdown-preview-view${extraClass}">${marked.parse(note.body)}</div>`;
}

function renderChunk(note, chunkName, open = false, transform = (md) => md) {
  forceOpen = open;
  const extraClass = note.fields.some((field) => field.name === "cssclasses") ? " scribeflow" : "";
  return `<div class="markdown-preview-view${extraClass}">${marked.parse(transform(note.chunks[chunkName]))}</div>`;
}

const panel = (label, html, clip = false) =>
  `<div class="demo-panel"><div class="demo-panel-label">${escapeHtml(label)}</div>${
    clip ? `<div class="demo-clip">${html}</div>` : html
  }</div>`;

function buildPage() {
  const byId = Object.fromEntries(notes.map((note) => [note.id, note]));
  // C 的速览与 B 完全相同（C 是在 B 上加正文字法与分组 callout 的上限版），这一条里不重复放
  const sulanStrip = notes
    .filter((note) => note.id !== "c")
    .map((note) => panel(note.label, renderChunk(note, "sulan")))
    .join("\n");
  const zhengwenStrip = `<div class="demo-grid">${panel("0 · 现状基线（多一层「正文」空壳标题 + 三级小节）", renderChunk(byId.baseline, "body"), true)}${panel(
    "C · 正文小节升到二级、去掉「正文」空壳标题",
    renderChunk(byId.c, "body"),
    true,
  )}${panel("C · 同一篇的第 4 节：原话用 [!quote] 单独成块、关键数字 ==高亮==", renderChunk(byId.c, "quoteSection"), true)}${panel(
    "C 的变体 · 小节标题降成三级（视觉轻一些，Outline 里仍只有正文小节）",
    renderChunk(byId.c, "body", false, (md) => md.replace(/^## /gm, "### ")),
    true,
  )}</div>`;
  const suchaStrip = `<div class="demo-grid">${panel("0 · 现状基线（28 条平铺）", renderChunk(byId.baseline, "sucha"))}${panel(
    "D · 同一条 Markdown，只加 CSS 片段（条目名上色、整块做成卡片）",
    renderChunk(byId.d, "sucha"),
  )}${panel("B · 折叠 callout（默认，只占一行）", renderChunk(byId.b, "sucha"))}${panel(
    "B · 点开之后（分组标签 + 每组 3-6 条）",
    renderChunk(byId.b, "sucha", true),
  )}</div>`;
  const fullNotes = notes
    .map(
      (note) =>
        `<div class="demo-strip"><h2 class="demo-strip-title">${escapeHtml(note.label)}</h2>${
          note.id === "baseline" ? `<div data-shot="obsidian-note-typography-baseline-full">` : note.id === "b" ? `<div data-shot="obsidian-note-typography-b-full">` : "<div>"
        }${renderNote(note)}</div></div>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>ScribeFlow · Obsidian 笔记排版方案 demo</title>
<style>
${CSS}
${SNIPPET}
</style>
</head>
<body>
<div class="demo-shell">
  <h1 class="demo-title">ScribeFlow 导出的 Obsidian 笔记：五种排版</h1>
  <p class="demo-sub">同一份内容（中美社保那条视频笔记），只改排版。预览样式是近似 Obsidian 默认主题的渲染，不是 Obsidian 的截图；
  真实观感请用 Obsidian 打开 <code>note-candidates/排版方案demo/</code> 这个文件夹。下面先看三个对比条，再看五份完整笔记。</p>

  <section class="demo-strip" data-shot="obsidian-note-typography-sulan">
    <h2 class="demo-strip-title">① 速览区：五种排法</h2>
    ${sulanStrip}
  </section>

  <section class="demo-strip" data-shot="obsidian-note-typography-zhengwen">
    <h2 class="demo-strip-title">② 正文开场（截到 520px 高）：基线 vs 方案 C</h2>
    ${zhengwenStrip}
  </section>

  <section class="demo-strip" data-shot="obsidian-note-typography-sucha">
    <h2 class="demo-strip-title">③ 速查区：平铺 28 条 vs 只加样式 vs 折叠 callout</h2>
    ${suchaStrip}
  </section>

  <section>${fullNotes}</section>
</div>
</body>
</html>
`;
}

/* --------------------------------------------------------------------- CDP */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ws;
let msgId = 0;
const pending = new Map();

async function connect() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          const entry = pending.get(message.id);
          if (!entry) return;
          pending.delete(message.id);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        });
        return;
      }
    } catch {
      /* Chrome 还没起来 */
    }
    await sleep(250);
  }
  throw new Error("连不上 Chrome 的 CDP 端口");
}

function send(method, params = {}) {
  const id = (msgId += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function shoot(fileUrl, pageHeight) {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1560, height: pageHeight, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: fileUrl });
  await sleep(500);
  await send("Runtime.evaluate", { expression: "window.document.fonts ? document.fonts.ready.then(() => true) : true", awaitPromise: true });
  const rects = await send("Runtime.evaluate", {
    expression: `JSON.stringify([...document.querySelectorAll("[data-shot]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.shot, x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    }))`,
    returnByValue: true,
  });
  // 量一遍各面板的高度：文档里的「平铺 28 条 vs 折叠后占几行」要用实测数字
  const measured = await send("Runtime.evaluate", {
    expression: `JSON.stringify([...document.querySelectorAll(".demo-panel")].map((el) => ({
      label: (el.querySelector(".demo-panel-label")?.textContent ?? "").trim(),
      h: Math.round(el.getBoundingClientRect().height),
      note: Math.round((el.querySelector(".markdown-preview-view")?.getBoundingClientRect().height ?? 0)),
    })))`,
    returnByValue: true,
  });
  for (const item of JSON.parse(measured.result.value)) {
    console.log(`[render-preview] 量：${item.note}px（含标签 ${item.h}px）  ${item.label}`);
  }
  for (const rect of JSON.parse(rects.result.value)) {
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1.5 },
    });
    const path = join(RESEARCH, `${rect.id}.png`);
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    const size = readFileSync(path).length;
    console.log(`[render-preview] ${rect.id}.png  ${Math.round(rect.width)}×${Math.round(rect.height)}  ${Math.round(size / 1024)}KB`);
  }
}

/* -------------------------------------------------------------------- main */

mkdirSync(WORK, { recursive: true });
mkdirSync(RESEARCH, { recursive: true });

const page = buildPage();
const htmlPath = join(RESEARCH, "obsidian-note-typography-demos.html");
writeFileSync(htmlPath, page, "utf8");
console.log(`[render-preview] HTML → ${htmlPath}（${Math.round(readFileSync(htmlPath).length / 1024)}KB）`);

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(WORK, "profile")}`,
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  await connect();
  await shoot(pathToFileURL(htmlPath).href, 40000);
  console.log("[render-preview] 完成");
} finally {
  chrome.kill();
  ws?.close();
}
