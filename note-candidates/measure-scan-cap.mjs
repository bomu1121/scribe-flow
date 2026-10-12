/** 实测 scan 步的引用条数上限：同一份真实文稿、同一个模型，新旧提示词各跑 2 次。 */
import { DatabaseSync } from "node:sqlite";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const AI = { baseUrl: cfg("ai.baseUrl"), model: cfg("ai.model"), apiKey: cfg("ai.apiKey") };
const input = db
  .prepare("SELECT content FROM run_node_logs WHERE run_id=? AND node_id='n_right' AND kind='input'")
  .get("run_33859ee5-e480-4a16-a8dd-94efac6c46dc").content;

const v4scan = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v4").recipe.steps[0];
/** 改动前的 scan（用于对照）：把条数上限那句去掉，其余原样。 */
const OLD = v4scan.system.replace(
  /；\*\*每个观点 2-4 条、全篇合计不超过 20 条\*\*——起草步会拿到原文全文，引用只是核对用的锚点，不要靠它覆盖细节、更不要把原文整段重抄；/,
  "；事实、数据、案例、关键表述不能漏摘；",
);
console.log("对照提示词里的旧句是否还原成功:", OLD.includes("不能漏摘"), "| 新句是否已移除:", !OLD.includes("不超过 20 条"));

async function run(system) {
  const res = await fetch(`${AI.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI.apiKey}` },
    body: JSON.stringify({ model: AI.model, messages: [{ role: "system", content: system }, { role: "user", content: input }], temperature: 0.3 }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const text = (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : text);
  return (j.blocks ?? []).reduce((s, b) => s + (b.quotes ?? []).length, 0);
}

const rows = [];
for (const [name, system] of [["改前（不能漏摘）", OLD], ["改后（≤20 条）", v4scan.system]]) {
  for (let i = 1; i <= 2; i += 1) {
    const n = await run(system);
    rows.push({ 提示词: name, 第几次: i, 引用条数: n });
  }
}
console.table(rows);
