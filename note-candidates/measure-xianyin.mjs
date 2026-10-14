/**
 * 读 `note-candidates/弦外之音对照/` 里的 A/B 两臂产物，回答一个问题：
 * **加了「弦外之音」那一栏，正文有没有被挤掉？那一栏本身是不是把正文换了个说法？**
 *
 * 三个指标（口径与 `measure-redundancy.mjs` 一致，这样能和之前的数字放在一起读）：
 * 1. **分段二元组覆盖**：把产物切成 速览 / 正文 / 弦外之音 / 速查 四段，各段单独算「原稿的字符二元组
 *    有多少出现在这一段里」。之所以必须分段——总覆盖变化时会分不清是"正文缩了"还是"新栏补了字"。
 * 2. **那一栏跟正文的重复度**：3-gram 包含度（|A∩B|/min），问「弦外之音里的字有多少在正文里已经有了」。
 *    接近 1 就是逐字复读（成文版那栏的失败形态），明显低才是带来了新东西。
 * 3. **专名抽查**：一份显式列出的关键专名表。这张表是人挑的，会漏掉表外的损失，作用是抓刺眼的丢失。
 *
 * 前置断言：A 臂产物**不许**出现「弦外之音」，B 臂**必须**出现——否则实验根本不是这个实验。
 *
 * 用法：node note-candidates/measure-xianyin.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync("note-candidates/文稿-社保-校对版.txt", "utf8");
const DIR = "note-candidates/弦外之音对照";
/** 与 run-xianyin-standalone.mjs 里的插入定位标记同一个，写死成常量免得两边漂移。 */
const SUCHA_MARKER = "> [!example]-";
/**
 * 「弦外之音」这一节的两种形态：乙/丙臂那一批是 `## 弦外之音`（二级标题），
 * 丁臂起改成 `> [!quote] 弦外之音`（标注框）——用户拿真实产物反馈「跟正文小节同级同形会被读成顺序续篇」。
 * 两批产物都在这个目录里，所以两种都要认；只有丁臂那一批才算上线形态。
 */
const XIANYIN_HEAD = /^(?:## 弦外之音|> \[!quote\] 弦外之音)/m;
const xianyinAt = (text) => text.search(XIANYIN_HEAD);
/** 是标注框形态还是标题形态（丁臂要求前者）。 */
const isCalloutForm = (text) => /^> \[!quote\] 弦外之音/m.test(text);

const norm = (s) => s.replace(/[#*>|`\-\s，。！？；：、（）()「」“”"'’·…—\[\]]/g, "");
const bigrams = (s) => {
  const clean = norm(s);
  const set = new Set();
  for (let i = 0; i + 2 <= clean.length; i += 1) set.add(clean.slice(i, i + 2));
  return set;
};
const trigrams = (s) => {
  const clean = norm(s);
  const set = new Set();
  for (let i = 0; i + 3 <= clean.length; i += 1) set.add(clean.slice(i, i + 3));
  return set;
};
/** 包含度：A 的字有多少被 B 覆盖。长度悬殊时用 min 作分母（要抓的正是"短的被长的说过了"）。 */
const containment = (a, b) => {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return hit / Math.min(A.size, B.size);
};

/** 关键专名：丢了会很刺眼的那类（数字一律用原稿里的中文写法）。人挑的，见文件头第 3 条。 */
const SPOT_TERMS = [
  "人社部", "中国社会保险法", "灵活就业人员", "Social Security", "Medicare", "自雇税",
  "四百美元", "百分之六点二", "百分之十二点四", "三千一百三十", "四零一K", "TSP",
  "马斯克", "效率部", "法币", "AGI", "累退", "累进", "五点二", "国税局",
  "财产税", "资产划拨", "加拿大", "新西兰", "澳大利亚", "记账符号", "货币的迷雾", "生育率", "公务员",
];

/** 把产物切成四段：速览 callout / 正文小节 / 弦外之音 / 速查 callout。 */
function segments(text) {
  const lines = text.split("\n");
  const out = { 速览: [], 正文: [], 弦外之音: [], 速查: [] };
  let where = null;
  for (const line of lines) {
    const t = line.trim();
    if (/^> \[!summary\]/.test(t)) { where = "速览"; out.速览.push(line); continue; }
    if (/^> \[!example\]/.test(t)) { where = "速查"; out.速查.push(line); continue; }
    // 丁臂起那一节是标注框形态：`> [!quote] 弦外之音` 与它后面连续的 `>` 行都算这一段。
    if (/^> \[!quote\]/.test(t)) { where = "弦外之音"; out.弦外之音.push(line); continue; }
    if (/^#{1,6}\s/.test(t)) {
      where = /弦外之音/.test(t) ? "弦外之音" : "正文";
      out[where].push(line);
      continue;
    }
    if (where && (t || where === "速览" || where === "速查")) out[where].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n")]));
}

const srcBi = bigrams(SOURCE);
const coverage = (s) => {
  const seg = bigrams(s);
  if (seg.size === 0) return null;
  let hit = 0;
  for (const g of srcBi) if (seg.has(g)) hit += 1;
  return { 字数: norm(s).length, 覆盖: +(hit / srcBi.size).toFixed(3) };
};

const files = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) throw new Error(`${DIR} 里没有产物，先跑 run-sulan-xianyin.mjs`);

const rows = [];
for (const file of files) {
  const text = readFileSync(join(DIR, file), "utf8");
  const arm = file.startsWith("甲") ? "A" : file.startsWith("乙") ? "B" : file.startsWith("丙") ? "C" : "D";
  const hasXianyin = xianyinAt(text) >= 0;
  // 前置断言：臂与产物形状必须对得上。
  if (arm === "A" && hasXianyin) throw new Error(`前置断言失败：A 臂产物出现了「弦外之音」——${file}`);
  if (arm !== "A" && !hasXianyin) throw new Error(`前置断言失败：${arm} 臂产物没有「弦外之音」——${file}`);
  // 丁臂是**上线形态**：那一节必须是标注框，不能退回二级标题（用户反馈过会与正文同级同形）。
  if (arm === "D" && !isCalloutForm(text)) throw new Error(`前置断言失败：丁臂的「弦外之音」不是标注框形态——${file}`);
  // 丙臂的全部意义是「正文一个字节都不动」：把补写的那一节摘掉，剩下的必须与第一次调用逐字相同。
  let 正文未改动 = "—";
  if (arm === "C") {
    const first = readFileSync(join(DIR, `${file.replace(/\.md$/, "")}.正文对照.txt`), "utf8");
    const withoutXianyin = text.slice(0, xianyinAt(text)) + text.slice(text.indexOf(SUCHA_MARKER));
    const flat = (s) => s.replace(/\s+/g, "");
    正文未改动 = flat(withoutXianyin) === flat(first) ? "是（逐字）" : "否";
    if (正文未改动 !== "是（逐字）") throw new Error(`前置断言失败：丙臂摘掉新栏后与第一次调用不一致——${file}`);
  }

  const seg = segments(text);
  const segCov = Object.fromEntries(Object.entries(seg).filter(([, v]) => v.trim()).map(([k, v]) => [k, coverage(v)]));
  const fail = text.replace(/[ \t]/g, "");
  const missed = SPOT_TERMS.filter((t) => !fail.includes(t.replace(/[ \t]/g, "")));

  rows.push({
    产物: file.replace(/\.md$/, ""),
    臂: arm,
    总字数: norm(text).length,
    总覆盖: coverage(text).覆盖,
    速览段: segCov.速览 ? `${segCov.速览.字数}字/${(segCov.速览.覆盖 * 100).toFixed(0)}%` : "—",
    正文段: `${segCov.正文.字数}字/${(segCov.正文.覆盖 * 100).toFixed(0)}%`,
    弦外之音段: segCov.弦外之音 ? `${segCov.弦外之音.字数}字/${(segCov.弦外之音.覆盖 * 100).toFixed(0)}%` : "—",
    速查段: segCov.速查 ? `${segCov.速查.字数}字/${(segCov.速查.覆盖 * 100).toFixed(0)}%` : "—",
    那一栏与正文重复度: seg.弦外之音 ? containment(seg.弦外之音, seg.正文).toFixed(2) : "—",
    正文未改动,
    专名丢失: missed.length ? missed.join("、") : "无",
  });
}

console.table(rows);
console.log("口径同 measure-redundancy.mjs：二元组覆盖＝原稿字符二元组出现在该段的比例（分母固定＝原稿），");
console.log("该指标天然偏向长产出，只作 A/B 之间的相对刻度；重复度＝3-gram 包含度，接近 1 即逐字复读。");
