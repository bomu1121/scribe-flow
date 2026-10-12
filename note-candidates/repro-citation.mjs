/** 用引擎自己的函数复现这次断言失败，定位规范化后到底差在哪。 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { evaluateAsserts } from "../apps/server/src/lib/recipe.ts";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const rid = "run_33859ee5-e480-4a16-a8dd-94efac6c46dc";
const input = db.prepare("SELECT content FROM run_node_logs WHERE run_id=? AND node_id='n_right' AND kind='input'").get(rid).content;

const scan = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v4").recipe.steps[0];
const resps = db.prepare("SELECT content FROM run_node_logs WHERE run_id=? AND node_id='n_right' AND kind='ai-response' AND step='scan' ORDER BY id").all(rid);

let n = 0;
for (const r of resps) {
  n += 1;
  const body = r.content.replace(/^\[.*?\] 输出 \d+ 字\s*/, "").trim();
  const res = evaluateAsserts(scan, body, { input, prev: "", all: "" });
  console.log(`\n===== 第 ${n} 次 scan：断言 ${res.ok ? "通过" : "未通过"}`);
  for (const e of res.errors) console.log("   ", e);
}
console.log("\n输入里那句原文（逐码点）:");
const i = input.indexOf("这个速胜");
const seg = input.slice(i, i + 50);
console.log(JSON.stringify(seg));
