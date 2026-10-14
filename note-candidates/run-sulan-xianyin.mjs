/**
 * 【对照实验】给「观点笔记（速览与速查）」加一栏「弦外之音」，正文会不会被挤掉？
 *
 * 起因是用户很青睐「弦外之音」这个模块，而它的风险不在篇幅总量（提示词里没有字数上限），
 * 在于**弹性只留在正文一处**：速览写死了 4-6 条、速查写死了 3-6 组×每组 3-6 条，
 * 只有正文是「5-9 段」而每段多细没人管。加的每一栏，压力最后都流向正文。
 *
 * 两条臂（**一次只改一个变量**：B 相对 A 只多了「## 弦外之音」那一段指令）：
 *   A 现状   = builtin.insight.v6 的 prompt 原文
 *   B 加栏   = A + 结构里第 4 条「弦外之音」，措辞照「观点笔记（详尽版）」那一栏
 *              （它给出了「找什么」：情绪色彩 / 未明说的潜台词 / 反复流露的矛盾心态），
 *              而不是像成文版那样只留一个空壳标题——成文版实测那栏变成了正文的逐字复读。
 *
 * 前置断言：B 的拼接必须真的发生（找不到锚点就抛错），否则会"两臂跑出来一模一样"却看不出来。
 *
 * 用法：
 *   node note-candidates/run-sulan-xianyin.mjs                两条臂各 3 次
 *   node note-candidates/run-sulan-xianyin.mjs --runs=2
 *   node note-candidates/run-sulan-xianyin.mjs --arms=A       只跑现状
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const RUNS = Number(arg("runs", "3"));
const ARMS = arg("arms", "A,B").split(",").map((s) => s.trim());
const MATERIAL = "note-candidates/文稿-社保-校对版.txt";
const OUT_DIR = "note-candidates/弦外之音对照";

const base = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6")?.prompt;
if (!base) throw new Error("找不到 builtin.insight.v6 —— 提示词 id 改了？");

/** B 臂新增的那一段。措辞照详尽版」（`PROMPT_GUANDIAN` 的「情绪基调与弦外之音」）。 */
const XIANYIN_SECTION = [
  "4. **弦外之音**：正文之后另起一个二级小节（`## 弦外之音`），1-3 句话，点出作者的语气与他没说破的判断——",
  "   - 明显的情绪色彩（他在夸谁、在讽谁）；",
  "   - 未明说的潜台词（哪句话的言外之意和他的字面表述不是一回事）；",
  "   - 他反复流露的某种矛盾心态。",
  "   - 原文确实没有这些的时候写「未见明显弦外之音」，不要硬凑；这一栏要说出正文与速览里没直接讲过的判断。",
].join("\n");

// 锚点：结构段第 3 条（速查）之后、底线之前。
const ANCHOR = "\n\n## 底线";
const ARM_B = base.replace(ANCHOR, `\n\n${XIANYIN_SECTION}${ANCHOR}`);
// 前置断言：拼接必须真的发生，否则两臂会跑出同一份东西而脚本不报错。
if (ARM_B === base) throw new Error(`锚点没命中，B 臂与 A 臂完全相同：${JSON.stringify(ANCHOR)}`);
if (!ARM_B.includes("## 弦外之音")) throw new Error("B 臂没有含「弦外之音」小节");

const PROMPTS = { A: { name: "甲-现状（无弦外之音）", prompt: base }, B: { name: "乙-加弦外之音", prompt: ARM_B } };

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const MODEL = cfg("ai.model");
const input = readFileSync(MATERIAL, "utf8");
console.log(`素材 ${MATERIAL} · ${input.replace(/\s/g, "").length} 字（去空白）· 模型 ${MODEL} · 每臂 ${RUNS} 次\n`);
console.log(`A 臂 prompt ${base.length} 字 / B 臂 prompt ${ARM_B.length} 字（+${ARM_B.length - base.length}）\n`);

mkdirSync(OUT_DIR, { recursive: true });

async function runOnce(arm) {
  const res = await fetch(`${cfg("ai.baseUrl").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg("ai.apiKey")}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: PROMPTS[arm].prompt },
        { role: "user", content: input },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
}

for (const arm of ARMS) {
  for (let i = 1; i <= RUNS; i += 1) {
    const started = Date.now();
    const text = await runOnce(arm);
    const file = `${OUT_DIR}/${PROMPTS[arm].name}-${i}.md`;
    writeFileSync(file, text, "utf8");
    console.log(`${file} · ${text.length} 字 · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}
console.log("\n跑完。下一步：node note-candidates/measure-xianyin.mjs");
