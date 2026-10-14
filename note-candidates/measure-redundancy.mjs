/**
 * 笔记冗余度测量。两件事：
 *
 * 1) 「单元重复率」：把产出切成单元（表格行 / 引用行 / 正文艺句），
 *    用字符 3-gram 的**包含度**（|A∩B| / min(|A|,|B|)）找"一个单元被另一个单元重复了一遍"。
 *    用包含度而不是 Jaccard，是因为要抓的典型形态就是「短的表行/引用 被 长的正文句子 说过了」——
 *    Jaccard 在这种长度悬殊的配对上数值偏低，会漏掉真正要抓的东西。
 * 2) 「数字保留率」：原稿里出现的数字有多少在产出里还能找到。这是"信息没丢"的**代理指标**
 *    （不是覆盖率，覆盖不到非数字信息），只看相对高低，不当绝对结论。
 *
 * 用法：tsx .tmp-notes/measure.mjs <目录或文件>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync("note-candidates/文稿-校对版.txt", "utf8");

const norm = (s) => s.replace(/[#*>|`\-\s，。！？；：、（）()「」“”"'’·…—\[\]]/g, "");
const grams = (s, n = 3) => {
  const set = new Set();
  for (let i = 0; i + n <= s.length; i += 1) set.add(s.slice(i, i + n));
  return set;
};
const containment = (a, b) => {
  const A = grams(a), B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return hit / Math.min(A.size, B.size);
};

/**
 * 切单元：表格行 / 引用行 / 正文艺句。标题本身不参与（它是标签，不是内容），
 * 但**独立成行的标题/加粗主张句要用来划分区**——v4 的观点标题就是 `**1. ……**` 这种。
 */
function units(text) {
  const out = [];
  let section = "(开头)";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    // 分区：标题、独立成行的加粗主张句，以及 **Obsidian callout 的标记行**（`> [!summary] 速览`）。
    // 最后一条是 2026-10-14 补的：产物改版后速览与速查都装进 callout，不认它的话，速查里的条目
    // 会落到它上面那个正文章节里，「正文 vs 速查」的重复就被误判成「同区」。
    if (/^#{1,6}\s/.test(t) || /^\*\*[^*]+\*\*$/.test(t) || /^> \[!/.test(t)) {
      section = t.replace(/^>\s*/, "").replace(/\[![^\]]+\]/, "").replace(/[*#]/g, "").trim().slice(0, 24);
      continue;
    }
    if (/^\|/.test(t)) {
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // 表头分隔行
      const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
      cells.forEach((c) => c && out.push({ kind: "表格行", text: c, section }));
      continue;
    }
    if (/^>/.test(t)) {
      out.push({ kind: "引用行", text: t.replace(/^>\s?/, ""), section });
      continue;
    }
    for (const s of t.split(/(?<=[。！？；])/)) {
      const clean = s.replace(/^[-*\d.、\s]+/, "").trim();
      if (clean) out.push({ kind: "正文", text: clean, section });
    }
  }
  return out.map((u) => ({ ...u, norm: norm(u.text) })).filter((u) => u.norm.length >= 14);
}

/**
 * 信息保留的两个代理指标。**第一版用的「阿拉伯数字保留率」是错的**：这份原稿里一个阿拉伯数字都没有
 * （数量全写成中文：四个高地 / 三大领域 / 两点 / 漏一点总比漏三点好），于是它恒为 0/0，属无效指标。
 *
 * 换成的两个：
 * 1) 覆盖（bigram）：原稿的所有不重复字符二元组有多少出现在产出里。规则统一、不挑词，
 *    但天然偏向长产出（短笔记覆盖必然低），所以**只当"信息取舍"的相对刻度**，不当质量分。
 * 2) 专名抽查：一份**我显式列出**的关键专名表，看哪些在产出里丢了。
 *    这张表是人挑的——这是它的局限（会漏掉表外的信息损失），作用是抓"丢了会很刺眼"的东西。
 */
const SPOT_TERMS = [
  "沙利文", "科技高地", "外交事务", "芯片战争", "关键投入品", "critical inputs",
  "稀土", "原料药", "重稀土", "磁体", "台海", "小院高墙", "去风险化",
  "范永鹏", "二丫", "异鬼", "民主AI", "美欧日韩", "生物制造", "电力电子",
];

const bigrams = (s) => {
  const set = new Set();
  const clean = norm(s);
  for (let i = 0; i + 2 <= clean.length; i += 1) set.add(clean.slice(i, i + 2));
  return set;
};

function score(file) {
  const text = readFileSync(file, "utf8");
  const us = units(text);
  const pairs = [];
  for (let i = 0; i < us.length; i += 1) {
    let worst = { c: 0, j: -1 };
    for (let j = 0; j < us.length; j += 1) {
      if (i === j) continue;
      const c = containment(us[i].norm, us[j].norm);
      if (c > worst.c) worst = { c, j };
    }
    if (worst.c >= 0.8 && worst.j > i) {
      const other = us[worst.j];
      pairs.push({
        a: us[i],
        b: other,
        c: +worst.c.toFixed(2),
        // 同区重复 = 同一个分区里把同一件事说了两遍（图1 那种就地复述）：基本没有用途
        // 跨区重复 = 正文 vs 速览/附录表（图2 那种）：可能是"换一个用途再说一次"，交给人判
        跨区: us[i].section !== other.section,
      });
    }
  }
  const sameArea = pairs.filter((p) => !p.跨区).length;
  const crossArea = pairs.filter((p) => p.跨区).length;
  const srcBi = bigrams(SOURCE);
  let hitBi = 0;
  const outBi = bigrams(text);
  for (const g of srcBi) if (outBi.has(g)) hitBi += 1;
  // 专名抽查对**半角空格**不敏感：产出里写「民主 AI」（词与英文之间按习惯加了空格）时，
  // 不该报成「丢了」。只去空格与制表符，不去换行——跨行的两个词不算同一个专名。
  const missTarget = text.replace(/[ \t]/g, "");
  const missed = SPOT_TERMS.filter((t) => !missTarget.includes(t.replace(/[ \t]/g, "")));
  const tableRows = (text.match(/^\|/gm) ?? []).length;
  const quotes = (text.match(/^>\s?\S/gm) ?? []).length;
  return {
    字数: text.length,
    单元数: us.length,
    同区重复: sameArea,
    跨区重复: crossArea,
    同区重复率: us.length ? +(sameArea / us.length).toFixed(3) : 0,
    二元组覆盖: `${hitBi}/${srcBi.size} = ${((hitBi / srcBi.size) * 100).toFixed(0)}%`,
    专名丢失: missed.length ? missed.join("、") : "无",
    表格行: tableRows,
    引用块行: quotes,
    _pairs: pairs,
  };
}

const target = process.argv[2];
const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith(".md")).map((f) => join(target, f))
  : [target];

const rows = [];
for (const f of files) {
  const r = score(f);
  rows.push({ 方案: f.split(/[\\/]/).pop().replace(/\.md$/, ""), ...r, _pairs: undefined });
  if (process.env.SHOW_PAIRS) {
    console.log(`\n### ${f}`);
    for (const p of r._pairs) console.log(`  [${p.c}] ${p.a.kind}「${p.a.text.slice(0, 46)}」\n        ≈ ${p.b.kind}「${p.b.text.slice(0, 46)}」`);
  }
}
console.table(rows);
