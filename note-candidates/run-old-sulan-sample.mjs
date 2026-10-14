/**
 * 对照用：把 **HEAD 版本（改版前）** 的「观点笔记（速览与速查）」再跑两份。
 *
 * 为什么需要它：改版前那份样张（`note-candidates/观点笔记（速览与速查）.md`）只有上一轮的
 * **一次**运行，而改版后我跑了三次。要谈「覆盖有没有被改版拖低」，两边的 N 必须相当——
 * 单次对三次比出来的差值，分不清是改版造成的还是运行波动。提示词直接从 git 里取，
 * 不手抄（手抄会引入不一致，那就成了另一种测量误差）。
 *
 * 用法：node note-candidates/run-old-sulan-sample.mjs [份数]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const COUNT = Number(process.argv[2] ?? 2);

// 从 HEAD 抽旧版提示词：这是纯文本常量，取出来直接当 system 用。
// 刻意用 indexOf 定位而不是正则：`].join("\n")` 里的 `\n` 是两个字符（反斜杠 + n），
// 写成正则要在「正则转义」和「字符串转义」里各绕一圈，实测很容易写成一个都不匹配。
const HEAD = "const PROMPT_SULAN = ";
const source = execFileSync("git", ["show", "HEAD:packages/shared/src/prompt.ts"], { encoding: "utf8" });
const start = source.indexOf(`${HEAD}[`);
const end = source.indexOf('].join("\\n");', start);
if (start === -1 || end === -1) throw new Error("没在 HEAD 里找到 PROMPT_SULAN");
const prompt = new Function(`return ${source.slice(start + HEAD.length, end + 1)}`)().join("\n");

// 前置断言：确认抓到的是改版前那一版，别把新版当旧版跑
if (!prompt.includes("小节标题就写「## 速查」")) throw new Error("取到的不是改版前的提示词");
if (prompt.includes("[!summary]")) throw new Error("取到的提示词里已经有 callout，不是 HEAD 版本");

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const input = readFileSync("note-candidates/文稿-校对版.txt", "utf8");

for (let i = 1; i <= COUNT; i += 1) {
  const res = await fetch(`${cfg("ai.baseUrl").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg("ai.apiKey")}` },
    body: JSON.stringify({ model: cfg("ai.model"), messages: [{ role: "system", content: prompt }, { role: "user", content: input }], temperature: 0.3 }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const text = (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
  const file = `note-candidates/观点笔记（速览与速查）-旧版对照${i + 1}.md`;
  writeFileSync(file, text, "utf8");
  console.log(`${file} · ${text.length} 字 · 含表格行：${/^\|/m.test(text)}`);
}
