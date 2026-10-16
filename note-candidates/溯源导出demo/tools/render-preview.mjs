/**
 * 生成「溯源报告 → Obsidian 导出」候选的对比页与截图，并量高度。
 *
 * 用法（在仓库根目录）：
 *   node "note-candidates/溯源导出demo/tools/render-preview.mjs"
 *
 * 产物：
 *   docs/research/trace-export-demos.html     总览页（自包含，浏览器直接打开）
 *   docs/research/trace-export-*.png          对比图
 *   .tmp-shots/trace-export/                  中间文件与 Chrome profile（已 gitignore）
 *
 * 说明：
 * - markdown 用本仓 apps/web 的 `marked` 渲染；额外补三个扩展：callout、`==高亮==`、脚注。
 * - **折叠态按 Obsidian 的默认来**：`> [!x]-` 是折叠的，所以量「整篇多长」时它只算标题那一行。
 *   展开态单独量一列，两个数都给。
 * - 预览样式是近似（标定依据见 tools/obsidian-preview.css 顶部）；真实观感以在 Obsidian 里
 *   打开 `note-candidates/溯源导出demo/` 这个文件夹为准，不要把 PNG 当成 Obsidian 的截图。
 */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEMO = join(ROOT, "note-candidates", "溯源导出demo");
const WORK = join(ROOT, ".tmp-shots", "trace-export");
const RESEARCH = join(ROOT, "docs", "research");
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9346);

const require = createRequire(join(ROOT, "apps", "web", "package.json"));
const { marked } = await import(pathToFileURL(require.resolve("marked")).href);

const CSS = readFileSync(join(DEMO, "tools", "obsidian-preview.css"), "utf8");
const SNIPPET = readFileSync(join(DEMO, "snippets", "scribeflow-trace.css"), "utf8");

const FILES = [
  ["baseline", "0-现状基线.md", "0 · 现状基线"],
  ["a", "A-主张即标题（详情折叠）.md", "A · 主张即标题 + 详情折叠"],
  ["b", "B-按核查状态分组（问题优先）.md", "B · 按核查状态分组（问题优先）"],
  ["c", "C-语法用满（来源用脚注）.md", "C · 语法用满（来源用脚注）"],
  ["d", "D-只改样式（cssclasses）.md", "D · 只改样式（cssclasses + 片段）"],
  ["e", "E-折叠索引（一条一个块）.md", "E · 折叠索引（一条一个块）"],
];

/* ------------------------------------------------------------ 三个 marked 扩展 */

const ICONS = {
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2-2-2H4c-1.25 0-2 .75-2 2v4c0 1.25.75 2 2 2h2v1c0 3-1 4-3 4v3z"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};
const CALLOUT_ICON = {
  note: "pencil",
  info: "info",
  abstract: "clipboard",
  summary: "clipboard",
  tldr: "clipboard",
  example: "list",
  quote: "quote",
  cite: "quote",
  success: "check",
  check: "check",
  done: "check",
  warning: "alert",
  caution: "alert",
  attention: "alert",
  question: "help",
  help: "help",
  faq: "help",
  failure: "x",
  fail: "x",
  missing: "x",
  danger: "alert",
  error: "alert",
  bug: "alert",
  todo: "list",
  tip: "pencil",
  important: "pencil",
};
const CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
const svgIcon = (name, className) =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
    ICONS[name] ?? ICONS.pencil
  }</svg>`;
const escapeHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    const block = [];
    for (const line of src.split("\n")) {
      if (!/^>/.test(line)) break;
      block.push(line);
    }
    const token = { type: "callout", raw: block.join("\n"), typeId: head[1].trim().toLowerCase(), fold: head[2], title: head[3].trim(), tokens: [] };
    this.lexer.blockTokens(block.slice(1).map((line) => line.replace(/^>[ \t]?/, "")).join("\n"), token.tokens);
    return token;
  },
  renderer(token) {
    const title = token.title || token.typeId;
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

/** 脚注：`[^1]` 上标 + 文末 `[^1]: 定义`（含缩进的续行）。Obsidian 的原生写法。 */
const footnoteExtension = {
  // 名字必须与 token 的 type 一致——marked 按扩展名找渲染器，不一致会报「Token with "x" type was not found」
  name: "footnoteDef",
  level: "block",
  start(src) {
    const index = src.search(/^\[\^\d+\]:/m);
    return index === -1 ? undefined : index;
  },
  tokenizer(src) {
    const lines = src.split("\n");
    if (!/^\[\^\d+\]:/.test(lines[0])) return undefined;
    const block = [lines[0]];
    for (let i = 1; i < lines.length; i += 1) {
      // 定义块 = 定义行 + 紧跟的缩进续行（引文写在缩进行里）
      if (/^( {2,}|\t)/.test(lines[i]) && !/^\[\^\d+\]:/.test(lines[i])) block.push(lines[i]);
      else break;
    }
    const id = /^\[\^(\d+)\]:/.exec(block[0])[1];
    const rest = [block[0].replace(/^\[\^\d+\]:[ \t]*/, ""), ...block.slice(1)].map((l) => l.replace(/^ {2,}/, "")).join("\n");
    const token = { type: "footnoteDef", raw: block.join("\n"), id, tokens: [] };
    this.lexer.blockTokens(rest, token.tokens);
    return token;
  },
  renderer(token) {
    return `<li id="fn-${token.id}"><p id="fnref-${token.id}">${this.parser.parse(token.tokens)}</p></li>`;
  },
};

/** 行内 `[^1]` → 上标链接。放在 callout 之后注册，避免把 callout 里的脚注吃掉。 */
const footnoteRefExtension = {
  name: "footnoteRef",
  level: "inline",
  start(src) {
    const index = src.indexOf("[^");
    return index === -1 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^\[\^(\d+)\]/.exec(src);
    if (!match) return undefined;
    return { type: "footnoteRef", raw: match[0], id: match[1] };
  },
  renderer(token) {
    return `<sup class="footnote-ref"><a href="#fn-${token.id}">${token.id}</a></sup>`;
  },
};

marked.use({ gfm: true, extensions: [calloutExtension, highlightExtension, footnoteExtension, footnoteRefExtension] });

/* -------------------------------------------------------------- 读候选文件 */

/** 极简 frontmatter：够读我们写的这几个文件（标量 + 字符串列表）。 */
function splitFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: [], body: text };
  const fields = [];
  let current = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && current) {
      current.values.push(item[1].trim());
      continue;
    }
    const kv = /^([^:]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    current = { name: kv[1].trim(), values: kv[2].trim() ? [kv[2].trim()] : [] };
    fields.push(current);
  }
  return { fields, body: text.slice(match[0].length) };
}

const notes = FILES.map(([id, file, label]) => {
  const { fields, body } = splitFrontMatter(readFileSync(join(DEMO, file), "utf8"));
  const lines = body.split("\n");
  /** 取某一段：从匹配 start 的行到下一个匹配 end 的行（不含）。 */
  const slice = (startRe, endRe) => {
    const from = lines.findIndex((l) => startRe.test(l));
    if (from === -1) return "";
    let to = lines.length;
    for (let i = from + 1; i < lines.length; i += 1) {
      if (endRe.test(lines[i])) {
        to = i;
        break;
      }
    }
    return lines.slice(from, to).join("\n");
  };
  return {
    id,
    label,
    fields,
    body,
    /**
     * 首屏区：正文开头到**第一个条目**为止（标题 + 摘要 + 速览 + 分组或索引）。
     * 不能按「到第一个 `## `」切：现状的速览本身就是一个 `## 联网核查速览` 小节，
     * 那样切出来只剩标题与摘要（177px），与别的候选不是同一段。
     */
    chunkTop: slice(/^# /, /^### \d+\.|^> \[![a-z]+\]- \d\d · /),
    /** 第 11 条那个条目（未找到外部出处，细节最全）；E 的条目是 callout、没有 ### 标题 */
    chunkItem: slice(/^### 11\./, /^### \d+\.|^## /),
    chunkItemE: slice(/^> \[![a-z]+\]- 11 · /, /^> \[![a-z]+\]- 12 · /),
    /** 待核实那一节 */
    chunkTail: slice(/^## 待核实/, /^## (?!待核实)/),
    /** 脚注区（只有 C 有） */
    chunkFoot: slice(/^## 来源/, /$^/),
  };
});

function render(markdown, { open = false, extraClass = "" } = {}) {
  forceOpen = open;
  return `<div class="markdown-preview-view${extraClass}">${marked.parse(markdown)}</div>`;
}

const panel = (label, html, clip = false, shotId = null) =>
  `<div class="demo-panel"${shotId ? ` data-shot="${shotId}"` : ""}><div class="demo-panel-label">${escapeHtml(label)}</div>${
    clip ? `<div class="demo-clip">${html}</div>` : html
  }</div>`;

/* ------------------------------------------------------------------ 页面 */

function buildPage() {
  const by = Object.fromEntries(notes.map((n) => [n.id, n]));
  const sulanStrip = ["baseline", "a", "b", "c"]
    .map((id) => panel(`${by[id].label}　（最多截 700px，整段高度见下）`, render(by[id].chunkTop), true))
    .join("\n");
  const itemStrip = [
    panel("0 · 现状：一条主张 = 一屏扁平 bullet（此处展开的是第 11 条）", render(by.baseline.chunkItem), true),
    panel("A · 折叠态（默认看到的样子）", render(by.a.chunkItem), true),
    panel("A · 点开之后", render(by.a.chunkItem, { open: true }), true),
    panel("E · 折叠索引里的同一条（标题带主张）", render(by.e.chunkItemE), true),
  ].join("\n");
  // 整篇那条只截首屏：三份整篇都两万像素上下，出一张两万六千像素高的图没法看，
  // 总高度以量出来的数为准（下面 measured 里那三行）。
  // 六套都进这一条：整篇高度是「这份笔记有多长」的直接答案，缺一套就少一格
  const fullStrip = ["baseline", "a", "b", "c", "d", "e"]
    .map(
      (id) =>
        `<div class="demo-col" data-shot="trace-export-full-${id}">${panel(`${by[id].label}　（只截首 700px）`, render(by[id].body), true)}</div>`,
    )
    .join("\n");
  const cFoot = panel("C · 文末：37 条来源收成脚注", render(by.c.chunkFoot), true);
  const dTail = panel("D · 同一份 Markdown + 一行 cssclasses，靠片段改观感（条目区）", render(by.d.chunkItem, { extraClass: " scribeflow-trace" }), true);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>ScribeFlow · 溯源报告导出到 Obsidian：六套排版候选</title>
<style>
${CSS}
${SNIPPET}
body { margin: 0; padding: 28px 32px 64px; background: #f2f4f6; }
.demo-shell { max-width: 2400px; margin: 0 auto; }
.demo-title { margin: 0 0 6px; font-size: 20px; }
.demo-sub { margin: 0 0 22px; max-width: 1000px; color: #545b66; font-size: 13px; line-height: 1.7; }
.demo-sub code { padding: 1px 4px; border-radius: 3px; background: #e8ebee; }
.demo-strip { margin: 0 0 26px; padding: 16px; border: 1px solid #e4e7eb; border-radius: 12px; background: #fff; }
.demo-strip-title { margin: 0 0 14px; font-size: 15px; }
.demo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(720px, 1fr)); gap: 16px; align-items: start; }
.demo-panel { border: 1px solid #e4e7eb; border-radius: 8px; background: #fff; overflow: hidden; }
.demo-panel-label { padding: 8px 12px; border-bottom: 1px solid #e4e7eb; background: #f7f8f9; color: #545b66; font-size: 12px; font-weight: 600; }
.demo-clip { max-height: 420px; overflow: hidden; position: relative; }
.demo-col .demo-clip { max-height: 700px; }
.demo-strip--tall .demo-clip { max-height: 700px; }
.demo-clip::after { content: ""; position: absolute; inset: auto 0 0 0; height: 56px; background: linear-gradient(transparent, #fff); }
.disable-clip .demo-clip { max-height: none; overflow: visible; }
.disable-clip .demo-clip::after { display: none; }
.demo-col { min-width: 0; }
</style>
</head>
<body>
<div class="demo-shell">
  <h1 class="demo-title">溯源报告导出到 Obsidian：六套排版候选</h1>
  <p class="demo-sub">
    同一份真实报告（中美社保那次运行，27 条主张、38 条来源、17 段原文引证），<b>内容一字不差，只改排版</b>。
    预览是近似 Obsidian 默认主题的渲染，<b>不是 Obsidian 的截图</b>；真实观感请用 Obsidian 打开
    <code>note-candidates/溯源导出demo/</code> 这个文件夹当库。诊断、先例与取舍见
    <code>docs/research/trace-export-research.md</code>。
  </p>

  <section class="demo-strip demo-strip--tall" data-shot="trace-export-overview">
    <h2 class="demo-strip-title">① 速览区：现状是「13 条平均 242 字的长 bullet」，四套的改法</h2>
    <div class="demo-grid">${sulanStrip}</div>
  </section>

  <section class="demo-strip disable-clip" data-shot="trace-export-item">
    <h2 class="demo-strip-title">② 同一条主张（第 11 条 · 未找到外部出处）：现状 vs A 的折叠/展开 vs E</h2>
    <div class="demo-grid">${itemStrip}</div>
  </section>

  <section class="demo-strip" data-shot="trace-export-full">
    <h2 class="demo-strip-title">③ 整篇（折叠态，Obsidian 打开时的默认样子）</h2>
    <div class="demo-grid">${fullStrip}</div>
  </section>

  <section class="demo-strip" data-shot="trace-export-extras">
    <h2 class="demo-strip-title">④ C 的脚注区与 D 的样式片段</h2>
    <div class="demo-grid">${cFoot}${dTail}</div>
  </section>
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
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
          }
        });
        await send("Page.enable");
        await send("Runtime.enable");
        return;
      }
    } catch {
      /* 等 Chrome */
    }
    await sleep(400);
  }
  throw new Error("连不上 Chrome CDP");
}
function send(method, params = {}) {
  const id = (msgId += 1);
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const html = buildPage();
mkdirSync(WORK, { recursive: true });
const pageFile = join(WORK, "trace-export-demos.html");
writeFileSync(pageFile, html, "utf8");
writeFileSync(join(RESEARCH, "trace-export-demos.html"), html, "utf8");

const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(WORK, "profile")}`, "--window-size=2400,1200", "about:blank"],
  { stdio: "ignore" },
);

try {
  await connect();
  await send("Page.navigate", { url: pathToFileURL(pageFile).href });
  await sleep(1200);

  // ---------- 量高度：700px 正文栏宽下，每份的折叠态与展开态整篇高度 ----------
  const measured = await send("Runtime.evaluate", {
    expression: `(() => {
      const lanes = [...document.querySelectorAll(".demo-col")].map((el) => ({
        id: el.dataset.shot,
        label: el.querySelector(".demo-panel-label")?.textContent ?? "",
        collapsed: Math.round(el.querySelector(".markdown-preview-view").getBoundingClientRect().height),
      }));
      return JSON.stringify(lanes);
    })()`,
    returnByValue: true,
  });
  const lanes = JSON.parse(measured.result.value);

  // 展开态：把所有折叠 callout 打开再量一遍（同一页，只改 open 属性）
  // 量完必须逐条还原：页面里本来就有「设计上就展开」的面板（②里的「A · 点开之后」），
  // 一律 false 收尾会把它一起关掉，后面量到的与截图里的都不是它该有的样子（踩过一次）。
  const expanded = await send("Runtime.evaluate", {
    expression: `(() => {
      const all = [...document.querySelectorAll("details.callout")];
      const before = all.map((el) => el.open);
      all.forEach((el) => { el.open = true; el.querySelector(".callout-fold")?.classList.remove("is-collapsed"); });
      const lanes = [...document.querySelectorAll(".demo-col")].map((el) => ({
        id: el.dataset.shot,
        expanded: Math.round(el.querySelector(".markdown-preview-view").getBoundingClientRect().height),
      }));
      all.forEach((el, i) => {
        el.open = before[i];
        el.querySelector(".callout-fold")?.classList.toggle("is-collapsed", !before[i]);
      });
      return JSON.stringify(lanes);
    })()`,
    returnByValue: true,
  });
  const expandedMap = Object.fromEntries(JSON.parse(expanded.result.value).map((l) => [l.id, l.expanded]));

  // 速览区与单条的高度（各候选同一段）
  const parts = await send("Runtime.evaluate", {
    expression: `(() => {
      const out = {};
      document.querySelectorAll("[data-shot]").forEach((section) => {
        const id = section.dataset.shot;
        if (!/overview|item/.test(id)) return;
        out[id] = [...section.querySelectorAll(".demo-panel")].map((p) => {
          const mv = p.querySelector(".markdown-preview-view");
          const details = [...p.querySelectorAll("details.callout")];
          return {
            label: p.querySelector(".demo-panel-label").textContent,
            h: Math.round(mv.getBoundingClientRect().height),
            scroll: mv.scrollHeight,
            clipMax: p.querySelector(".demo-clip") ? getComputedStyle(p.querySelector(".demo-clip")).maxHeight : null,
            details: details.length,
            open: details.filter((d) => d.open).length,
            firstContent: details[0] ? Math.round(details[0].querySelector(".callout-content").getBoundingClientRect().height) : null,
          };
        });
      });
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });

  const lines = [];
  lines.push("=== 整篇高度（正文栏宽 700px，含 front matter 之外的正文区）===");
  for (const lane of lanes) {
    lines.push(`${lane.label.padEnd(30)} 折叠态 ${String(lane.collapsed).padStart(6)}px · 全展开 ${String(expandedMap[lane.id]).padStart(6)}px`);
  }
  lines.push("\n=== 首屏区（正文开头 → 第一条）===");
  for (const p of JSON.parse(parts.result.value)["trace-export-overview"]) lines.push(`${p.label.padEnd(42)} ${p.h}px`);
  lines.push("\n=== 第 11 条那一段 ===");
  for (const p of JSON.parse(parts.result.value)["trace-export-item"]) lines.push(`${p.label.padEnd(34)} h=${p.h} scroll=${p.scroll} clipMax=${p.clipMax} details=${p.details} open=${p.open} content0=${p.firstContent}`);
  console.log(lines.join("\n"));
  writeFileSync(join(WORK, "measured.txt"), lines.join("\n") + "\n", "utf8");

  // ---------- 截图 ----------
  const shots = [
    ["trace-export-overview", 1500, 1.5],
    ["trace-export-item", 2000, 1.3],
    ["trace-export-full", 1800, 1.1],
    ["trace-export-extras", 1400, 1.5],
  ];
  for (const [id, height, scale] of shots) {
    await send("Emulation.setDeviceMetricsOverride", { width: 2400, height, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const layout = await send("Runtime.evaluate", { expression: "JSON.stringify({ inner: window.innerWidth, client: document.documentElement.clientWidth, section: Math.round(document.querySelector('[data-shot=\"" + id + "\"]').getBoundingClientRect().width) })", returnByValue: true });
    console.log("[layout]", id, layout.result.value);
    const rect = await send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector('[data-shot="${id}"]'); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }); })()`,
      returnByValue: true,
    });
    const box = JSON.parse(rect.result.value);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale },
      captureBeyondViewport: true,
    });
    const file = join(RESEARCH, `${id}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[render-preview] ${id}.png  ${Math.round(box.width)}×${Math.round(box.height)}`);
  }
} finally {
  try {
    chrome.kill();
  } catch {
    /* 忽略 */
  }
}
