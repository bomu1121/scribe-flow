/**
 * 用改版后的「观点笔记（速览与速查）」跑一份样张，并**机器检查输出形状**。
 *
 * 与 `run-sulan-sample.mjs` 的区别：那份写回老文件名（是上一轮的证据），这份写 `-B版.md`，
 * 并额外断言 callout 的写法没被模型漏掉——形状错了要当场喊出来，不能等打开 Obsidian 才发现。
 *
 * 用法：node note-candidates/run-sulan-sample-b.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

/*
 * 用法：
 *   node note-candidates/run-sulan-sample-b.mjs           真跑一次并检查形状
 *   node note-candidates/run-sulan-sample-b.mjs --check   只看已有的样张（不再花一次调用）
 */
const CHECK_ONLY = process.argv.includes("--check");
/** `--out=文件名`：跑第二份样张时用，避免覆盖第一份（单次运行之间的差异要能被量出来）。 */
const OUT_FILE = (process.argv.find((arg) => arg.startsWith("--out=")) ?? "").slice(6) || "note-candidates/观点笔记（速览与速查-B版）.md";

let text;
if (CHECK_ONLY) {
  text = readFileSync(OUT_FILE, "utf8");
  console.log(`只检查已有样张：${OUT_FILE}\n`);
} else {
  const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
  const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
  const input = readFileSync("note-candidates/文稿-校对版.txt", "utf8");
  const block = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6");
  if (!block) throw new Error("找不到 builtin.insight.v6");

  const res = await fetch(`${cfg("ai.baseUrl").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg("ai.apiKey")}` },
    body: JSON.stringify({ model: cfg("ai.model"), messages: [{ role: "system", content: block.prompt }, { role: "user", content: input }], temperature: 0.3 }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  text = (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
  writeFileSync(OUT_FILE, text, "utf8");
  console.log(`样张：${OUT_FILE} · ${text.length} 字 · 模型 ${cfg("ai.model")}\n`);
}

/* ---------------------------------------------------------------- 形状检查 */

const lines = text.split("\n");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const calloutBlocks = (marker) => {
  const start = lines.findIndex((line) => line.startsWith(marker));
  if (start === -1) return [];
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(">")) break;
    body.push(line);
  }
  return body;
};

const sulan = calloutBlocks("> [!summary] 速览");
check("速览：`> [!summary] 速览` 存在", lines.some((line) => line.startsWith("> [!summary] 速览")));
check("速览：默认展开（标题行不带 `-`）", !lines.some((line) => line.startsWith("> [!summary]- ")));
check(
  "速览：框内每行都有 `> ` 前缀（空行写成单独 `>`）",
  sulan.every((line) => /^>( |$)/.test(line)),
  sulan.find((line) => !/^>( |$)/.test(line)) ?? "",
);
const sulanItems = sulan.filter((line) => /^> - /.test(line));
check("速览：4-6 条", sulanItems.length >= 4 && sulanItems.length <= 6, `${sulanItems.length} 条`);

const sucha = calloutBlocks("> [!example]- 速查");
check("速查：`> [!example]- 速查` 存在（带折叠标记）", lines.some((line) => line.startsWith("> [!example]- 速查")));
check(
  "速查：框内每行都有 `> ` 前缀",
  sucha.every((line) => /^>( |$)/.test(line)),
  sucha.find((line) => !/^>( |$)/.test(line)) ?? "",
);
const groups = [];
for (const line of sucha) {
  const group = /^> \*\*(.+)\*\*\s*$/.exec(line);
  if (group) groups.push({ name: group[1], items: [] });
  else if (/^> - /.test(line)) groups.at(-1)?.items.push(line.replace(/^> - /, ""));
}
check("速查：3-6 组", groups.length >= 3 && groups.length <= 6, `${groups.length} 组：${groups.map((g) => `${g.name}(${g.items.length})`).join(" / ")}`);
check(
  "速查：每组 3-6 条",
  groups.every((g) => g.items.length >= 3 && g.items.length <= 6),
  groups.filter((g) => g.items.length < 3 || g.items.length > 6).map((g) => `${g.name}:${g.items.length}`).join(" ") || "",
);
/**
 * 条目名超 12 字算不算问题：书名（《…》）与整句原话（「…」）是允许的形态——原话本身就是内容，
 * 把它压成短名反而丢了信息；带英文括注的（`关键投入品（critical inputs）`）也放行：那是原术语。
 * 真正要拦的是「一条描述句被加粗当条目名」。
 */
const nameOkay = (name) => name.length <= 12 || /《|》|「|」|“|”|[A-Za-z]/.test(name);
const tooLongName = groups.flatMap((g) => g.items).filter((item) => !nameOkay(/^\*\*(.+?)\*\*/.exec(item)?.[1] ?? ""));
const tooLongDesc = groups.flatMap((g) => g.items).filter((item) => (item.replace(/^\*\*.+?\*\*[：:]/, "").length > 40));
check("速查：条目名 ≤12 字（书名 / 原话 / 原文术语除外）", tooLongName.length === 0, tooLongName.map((i) => i.slice(0, 24)).join(" / "));
check("速查：说明 ≤40 字", tooLongDesc.length === 0, tooLongDesc.map((i) => i.slice(0, 30)).join(" / "));

const h2 = lines.filter((line) => /^## /.test(line));
const h3 = lines.filter((line) => /^### /.test(line));
check("正文：小节用 `## `（5-9 个）", h2.length >= 5 && h2.length <= 9, `${h2.length} 个`);
check("正文：没有 `### `", h3.length === 0, h3.slice(0, 2).join(" / "));
const shells = ["## 速览", "## 正文", "## 速查"].filter((shell) => lines.some((line) => line.trim() === shell));
check("旧版式：`## 速览/正文/速查` 空壳标题都不在", shells.length === 0, shells.join(" / "));
check("没有表格", !lines.some((line) => /^\|/.test(line.trim())));

const failed = checks.filter((c) => !c.ok);
console.log(`\n[run-sulan-sample-b] ${checks.length - failed.length}/${checks.length} 项通过`);
if (failed.length > 0) process.exitCode = 1;
