/**
 * 速查表的字段规划对照：只替换「速查表」那一段，其余提示词一字不动，同一份文稿跑三种形状。
 * 通用要求（三个方案都带）：表头必须有分隔行（漏了就渲染不成表格）、并列项用顿号不用半角分号。
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const cfg = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const AI = { baseUrl: cfg("ai.baseUrl"), model: cfg("ai.model"), apiKey: cfg("ai.apiKey") };
const transcript = readFileSync("note-candidates/文稿-校对版.txt", "utf8");

const BASE = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6").prompt;
const OLD =
  "3. **速查表**：一张表，只放真的值得回头查或单独引用的东西——数字、书名与文章名、机构与人名、关键原话。凑数的行不要：作者的口播习惯、节目安排、转述时的感想都不算。";
if (!BASE.includes(OLD)) throw new Error("找不到要替换的那句，停止");

const COMMON = [
  "   - 表头行下面必须有分隔行（| --- | --- | 这种），漏了这一行整个渲染不成表格。",
  "   - 一格里的并列项用顿号，不要用半角分号把几条串在一起。",
].join("\n");

const KEEP = [
  "   - 只放真的值得回头查或单独引用的：数字、书名与文章名、机构与人名、概念、关键原话。",
  "   - 凑数的不要：作者的口播习惯、节目安排、转述时的感想都不算。",
].join("\n");

const VARIANTS = {
  "甲-条目清单（不用表格）": [
    "3. **速查表**：这一段**不要用表格**（阅读区窄，表格的列一挤就糊成一团）。改成一串条目清单，每条一行：",
    "   - 格式：- **〈条目〉**（〈类别〉）：〈一句话说明〉",
    "   - **一条一行、一事一格**：一条里只说一件事，不要把好几条串在一行。",
    "   - 条目不超过 12 字，说明不超过 40 字，超了就拆成两条。",
    "   - 需要列 3 项以上的内容（例如「四个制高点」）不要挤成一条，拆成四条；拆不动就不进这份清单——正文里已经讲过了。",
    KEEP,
  ].join("\n"),

  "乙-两列表（条目｜说明）": [
    "3. **速查表**：一张两列表，表头固定写成 | 条目 | 说明 |。",
    "   - **一条一行、一事一格**：一格只说一件事，不要把好几条串进同一格。",
    "   - 条目不超过 12 字，说明不超过 40 字，超了就拆成两行。",
    "   - 需要列 3 项以上的内容（例如「四个制高点」）不要挤进一格，拆成多行；拆不动就不要再进这张表——正文里已经讲过了。",
    KEEP,
  ].join("\n"),

  "丙-三列表（类别｜条目｜要点）": [
    "3. **速查表**：一张三列表，表头固定写成 | 类别 | 条目 | 要点 |。",
    "   - **一条一行、一事一格**：一格只说一件事，不要把好几条串进同一格。",
    "   - 类别不超过 4 字（人物 / 文章 / 概念 / 判断 / 原话），条目不超过 8 字，要点不超过 25 字，超了就拆成两行。",
    "   - 需要列 3 项以上的内容（例如「四个制高点」）不要挤进一格，拆成多行；拆不动就不要再进这张表——正文里已经讲过了。",
    KEEP,
  ].join("\n"),
};

async function gen(system) {
  const res = await fetch(`${AI.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI.apiKey}` },
    body: JSON.stringify({
      model: AI.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcript },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
}

for (const [name, spec] of Object.entries(VARIANTS)) {
  const text = await gen(BASE.replace(OLD, [spec, COMMON].join("\n")));
  writeFileSync(`note-candidates/速查表-${name}.md`, text, "utf8");
  const hasSep = /^\|\s*---/m.test(text);
  console.log(`${name} → ${text.length} 字 | 有表头分隔行: ${hasSep}`);
}
