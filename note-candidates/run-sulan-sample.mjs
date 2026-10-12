/** 用改动后的「观点笔记（速览与速查）」跑一份样张，并量同区/跨区重复与覆盖。 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const input = readFileSync("note-candidates/文稿-校对版.txt", "utf8");
const block = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6");

const res = await fetch(`${cfg("ai.baseUrl").replace(/\/+$/, "")}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg("ai.apiKey")}` },
  body: JSON.stringify({ model: cfg("ai.model"), messages: [{ role: "system", content: block.prompt }, { role: "user", content: input }], temperature: 0.3 }),
  signal: AbortSignal.timeout(300_000),
});
if (!res.ok) throw new Error(`${res.status}`);
const text = (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
writeFileSync("note-candidates/观点笔记（速览与速查）.md", text, "utf8");
console.log("新样张:", text.length, "字 | 含表格行:", /^\|/m.test(text));
