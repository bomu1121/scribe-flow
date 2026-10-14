/**
 * 【对照实验·丙臂】把「弦外之音」拆成**单独一次调用**，而不是挤在正文那次里。
 *
 * 这条路线要回答的问题：「单独开个模块，就不会影响正文了」——到底成不成立、代价多大。
 * 做法（跑两次调用）：
 *   第 1 次 = 现状速览（与甲臂逐字相同的那份 prompt），得到正文；
 *   第 2 次 = 一份只做弦外之音的小提示词，输入是【原稿全文 + 第 1 次的产物】。
 *
 * 第 2 次的输入**必须带正文**：不给正文，它无从知道哪些话已经写过了，就会把正文复述一遍——
 * 那是成文版那一栏的失败形态（实测逐字复读正文第 8 段）。
 *
 * 产物按 B 臂的同一个位置插进笔记（正文之后、速查标注框之前），段落位置与乙臂一致，
 * 这样两边的弦外之音段可以逐条比。
 *
 * 用法：node note-candidates/run-xianyin-standalone.mjs [--runs=3]
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const RUNS = Number((process.argv.find((a) => a.startsWith("--runs=")) ?? "").slice(7) || "3");
const MATERIAL = "note-candidates/文稿-社保-校对版.txt";
const OUT_DIR = "note-candidates/弦外之音对照";
const SUCHA_MARKER = "> [!example]-";

const base = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6")?.prompt;
if (!base) throw new Error("找不到 builtin.insight.v6");

/** 第二次调用的提示词。任务描述与乙臂那段同义，只是搬成了独立一步。 */
const STANDALONE = [
  "你是笔记编辑。用户消息里依次是【原稿全文】和【已经写好的笔记】（用标记分隔）。",
  "你只做一件事：给这份笔记补一栏「弦外之音」，写 1-3 句话，点出作者的语气与他没说破的判断——",
  "- 明显的情绪色彩（他在夸谁、在讽谁）；",
  "- 未明说的潜台词（哪句话的言外之意和他的字面表述不是一回事）；",
  "- 他反复流露的某种矛盾心态。",
  "原文确实没有这些的时候写「未见明显弦外之音」，不要硬凑；这一栏要说出正文与速览里没直接讲过的判断。",
  "",
  "只输出 `## 弦外之音` 这一节（标题 + 正文），不要复述笔记的其他部分，不要写解释或前言。",
].join("\n");

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const MODEL = cfg("ai.model");
const input = readFileSync(MATERIAL, "utf8");
mkdirSync(OUT_DIR, { recursive: true });

async function call(system, user) {
  const res = await fetch(`${cfg("ai.baseUrl").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg("ai.apiKey")}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.3 }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  return { text: json.choices?.[0]?.message?.content?.trim() ?? "", usage: json.usage ?? {} };
}

console.log(`素材 ${MATERIAL} · 每跑两次调用 · 共 ${RUNS} 跑\n`);

for (let i = 1; i <= RUNS; i += 1) {
  const t0 = Date.now();
  const first = await call(base, input);
  const t1 = Date.now();
  // 第二次带上原稿与第一次的产物（顺序：原稿在前，笔记在后）。
  const second = await call(STANDALONE, `【原稿全文】\n${input}\n\n【已经写好的笔记】\n${first.text}`);
  const t2 = Date.now();

  // 插到速查之前，与乙臂同一个位置；插不进去就抛错，不要"悄悄落到文件末尾"。
  const at = first.text.indexOf(SUCHA_MARKER);
  if (at < 0) throw new Error(`第 ${i} 跑的产物里找不到速查标注框，无法定位插入点`);
  const merged = `${first.text.slice(0, at).trimEnd()}\n\n${second.text.trim()}\n\n${first.text.slice(at)}`;
  if (!/## 弦外之音/.test(merged)) throw new Error(`第 ${i} 跑的第二次调用没吐出「## 弦外之音」：${second.text.slice(0, 80)}`);

  // 正文必须与第一次调用逐字一致（拆出去的意义就在这）：把两段正文单独存下来给脚本比对。
  writeFileSync(`${OUT_DIR}/丙-单独调用-${i}.md`, merged, "utf8");
  writeFileSync(`${OUT_DIR}/丙-单独调用-${i}.正文对照.txt`, first.text, "utf8");
  console.log(
    `丙-单独调用-${i}.md · 第1次 ${((t1 - t0) / 1000).toFixed(1)}s(${first.usage.prompt_tokens ?? "?"}/${first.usage.completion_tokens ?? "?"} tok) · ` +
      `第2次 ${((t2 - t1) / 1000).toFixed(1)}s(${second.usage.prompt_tokens ?? "?"}/${second.usage.completion_tokens ?? "?"} tok) · 弦外之音 ${second.text.replace(/\s/g, "").length} 字`,
  );
}
console.log("\n跑完。下一步：node note-candidates/measure-xianyin.mjs");
