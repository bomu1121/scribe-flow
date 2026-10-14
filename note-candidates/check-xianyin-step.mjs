/**
 * 用**上线的那段提示词**真跑一次配方第二步，验五件事：
 * 1. 产物是 `> [!quote] 弦外之音` 标注框（配方里那条 contains 断言的门）；
 * 2. 而且**没有**退回 `## ` 标题形态——跟正文小节同级同形时，读者会把它读成正文的顺序续篇（用户反馈过）；
 * 3. 长度 ≤ 1500（那条 lengthLte 的门）；
 * 4. 插在速查折叠框**之前**；
 * 5. 拼出来的笔记里，正文与第一步产物**逐字相同**（`appendStepOutput` 的保证）。
 *
 * 为什么要单独跑这一趟：三臂对照实验里用的措辞与最终上线的不完全一样
 * （上线版另加了一句「不要把已经写过的话换个说法再写一遍」）。提示词改一个字就不是同一份，
 * 光靠实验数字不能替上线版本背书。
 *
 * 提示词直接从 `BUILTIN_PROMPT_BLOCKS` 里取，不复制粘贴——复制会漂移。
 * 拼接直接调服务端的 `appendStepOutput`，与引擎走同一份实现。
 *
 * 用法：node note-candidates/check-xianyin-step.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";
import { appendStepOutput } from "../apps/server/src/lib/recipe.ts";

const RUNS = Number((process.argv.find((a) => a.startsWith("--runs=")) ?? "").slice(7) || "2");
const SOURCE = readFileSync("note-candidates/文稿-社保-校对版.txt", "utf8");
/** 拿一份**真实的**第一步产物当输入（不是造的），这样验的是真实链路形状。 */
const FIRST_STEP_PRODUCT = readFileSync("note-candidates/弦外之音对照/甲-现状（无弦外之音）-1.md", "utf8");

const recipe = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6")?.recipe;
if (!recipe) throw new Error("v6 没有配方——上线版本不是这一步的形态");
const step2 = recipe.steps.at(-1);
if (!step2?.append) throw new Error("末步不是追加步");

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const MODEL = cfg("ai.model");
console.log(`上线提示词：${step2.system.length} 字 · 断言 ${JSON.stringify(step2.expects?.asserts)}\n`);

const norm = (s) => s.replace(/[#*>`|\-\s，。！？；：、（）()「」“”"'’·…—\[\]]/g, "");
const trigrams = (s) => {
  const set = new Set();
  const clean = norm(s);
  for (let i = 0; i + 3 <= clean.length; i += 1) set.add(clean.slice(i, i + 3));
  return set;
};

/** 正文段 = 第一个 `## ` 到「弦外之音」那一节（或速查框）之间。 */
const bodyOf = (text) => {
  const start = text.indexOf("## ");
  const end = Math.min(...["弦外之音", "> [!example]"].map((m) => text.indexOf(m)).filter((i) => i > 0));
  return text.slice(start, end);
};

const failures = [];
for (let i = 1; i <= RUNS; i += 1) {
  // 与引擎一致：system 展开 {{input}}，user 消息 = 上一步产物。
  const system = step2.system.replace(/\{\{input\}\}/g, SOURCE);
  const res = await fetch(`${cfg("ai.baseUrl").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg("ai.apiKey")}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: FIRST_STEP_PRODUCT },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const section = (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";

  // 断言门：与配方里声明的一模一样，门不过是**整节点失败**级别的，所以这里必须当失败报。
  const XIANYIN = "> [!quote] 弦外之音";
  const hasHeading = section.includes(XIANYIN);
  // 还要拦「退回二级标题」这一种：跟正文小节同级同形时，读者会把它读成正文的顺序续篇。
  const titleForm = /^#{1,6}\s.*弦外之音/m.test(section);
  const len = section.length;
  const merged = appendStepOutput(FIRST_STEP_PRODUCT, section, step2.append.before);
  const at = merged.indexOf(XIANYIN);
  const sucha = merged.indexOf("> [!example]-");
  const positionOk = at > 0 && sucha > at;
  const strippedSame =
    `${merged.slice(0, at)}${merged.slice(sucha)}`.replace(/\s+/g, "") === FIRST_STEP_PRODUCT.replace(/\s+/g, "");

  // 这一栏与正文的重复度（3-gram 包含度）：接近 1 就是复读正文，等于白加一栏。
  const A = trigrams(section);
  const B = trigrams(bodyOf(FIRST_STEP_PRODUCT));
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  const repetition = A.size ? hit / Math.min(A.size, B.size) : 0;

  console.log(`第 ${i} 次：${len} 字 · 标注框 ${hasHeading ? "有" : "**没有**"} · 未退回标题 ${titleForm ? "**否**" : "是"} · ` +
    `位置 ${positionOk ? "在速查前" : "**不对**"} · 正文逐字 ${strippedSame ? "相同" : "**被改动**"} · 与正文重复度 ${repetition.toFixed(2)}`);
  if (!hasHeading) failures.push(`第 ${i} 次：没有 ${XIANYIN}（配方断言会判这一步失败）`);
  if (titleForm) failures.push(`第 ${i} 次：写成了标题形态，会被读成正文的顺序续篇`);
  if (len > 1500) failures.push(`第 ${i} 次：${len} 字，超 lengthLte 1500（配方断言会判这一步失败）`);
  if (!positionOk) failures.push(`第 ${i} 次：没插到速查框之前`);
  if (!strippedSame) failures.push(`第 ${i} 次：正文被改动了`);
  writeFileSync(`note-candidates/弦外之音对照/丁-上线提示词-${i}.md`, merged, "utf8");
}

console.log(`\n[check-xianyin-step] ${RUNS * 5 - failures.length}/${RUNS * 5} 项通过`);
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exitCode = 1;
}
