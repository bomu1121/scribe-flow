/**
 * 五版「观点笔记」产物的**形状**测量：字数、标题层级、callout、表格、速览条数、速查组/条。
 *
 * 为什么单独量形状：这几版的差异有一半不在字数上（同一输入下 2,022–8,510 字），
 * 而在「有没有一级标题」「速览是清单还是 callout」「速查是几组几条」这类结构特征上。
 * 速查是否分组、正文小节是 `##` 还是 `###` 直接决定结果页目录与 Obsidian 大纲长什么样，
 * 这些光看字数看不出来。
 *
 * **前置断言**：每份文件先按预期形状校验（callout 数、有无表格），对不上就抛错。
 * 理由见仓库里反复踩到的坑——探针写错值时不会报错，只会静默给出一份看着正常的数字。
 *
 * 用法：node note-candidates/measure-shapes.mjs
 * 输入：note-candidates/ 下五版同一份 2,884 字校对稿的产物（详见 PROMPTS 表）。
 */
import { readFileSync } from "node:fs";

/** [显示名, 文件, 预期形状]——预期值来自提示词源码，不是来自产物本身。 */
const PROMPTS = [
  ["详尽版 v2", "观点笔记（详尽版）.md", { callouts: 0, hasTable: true }],
  ["成文版 v4", "观点笔记（成文版）.md", { callouts: 0, hasTable: false }],
  ["连贯版 v5", "观点笔记（连贯版）.md", { callouts: 0, hasTable: false }],
  ["问答笔记", "问答笔记.md", { callouts: 0, hasTable: false }],
  ["速览与速查 v6（旧排版）", "观点笔记（速览与速查）-旧版对照3.md", { callouts: 0, hasTable: false }],
  ["速览与速查 v6（B 版）", "观点笔记（速览与速查-B版3）.md", { callouts: 2, hasTable: false }],
];

const dir = "note-candidates/";
const rows = [];

for (const [name, file, expect] of PROMPTS) {
  const text = readFileSync(dir + file, "utf8");
  const lines = text.split(/\r?\n/);
  const count = (re) => lines.filter((line) => re.test(line)).length;

  const callouts = count(/^> \[!/);
  const tableRows = count(/^\|/);
  // 前置断言：形状与提示词不符就停下。写错的探针比没有探针更危险。
  if (callouts !== expect.callouts) {
    throw new Error(`前置断言失败：${name} 的 callout 数 ${callouts} != 预期 ${expect.callouts}（${file}）`);
  }
  if (tableRows > 0 !== expect.hasTable) {
    throw new Error(`前置断言失败：${name} 的表格行 ${tableRows} 与预期不符（${file}）`);
  }

  // 速览条数：B 版在 callout 里，旧版在「## 速览」小节下；两处都按「紧邻的 `- ` 行」数。
  const summaryHead = lines.findIndex((line) => /^> \[!summary\]/.test(line));
  const legacyHead = lines.findIndex((line) => /^## 速览/.test(line));
  const summaryFrom = summaryHead >= 0 ? summaryHead + 1 : legacyHead + 1;
  const summaryPrefix = summaryHead >= 0 ? /^> - / : /^- /;
  let summaryBullets = 0;
  if (summaryFrom > 0) {
    for (let i = summaryFrom; i < lines.length; i += 1) {
      if (summaryHead >= 0 && !/^>/.test(lines[i])) break;
      if (legacyHead >= 0 && summaryHead < 0 && /^#{1,6} /.test(lines[i])) break;
      if (summaryPrefix.test(lines[i])) summaryBullets += 1;
    }
  }

  // 速查：从「速查」抬头之后开始数条数与组数（组名＝`> **组名**` 或 `### 组名`）。
  const suchaAt = lines.findIndex((line) => /速查/.test(line));
  const suchaLines = suchaAt >= 0 ? lines.slice(suchaAt) : [];
  const suchaItems = suchaLines.filter((line) => /^(?:> )?- /.test(line)).length;
  const suchaGroups = suchaLines.filter((line) => /^> \*\*/.test(line)).length;

  rows.push({
    版本: name,
    字数: text.replace(/\s/g, "").length,
    H1: count(/^# /),
    H2: count(/^## /),
    H3: count(/^### /),
    callout: callouts,
    表格行: tableRows,
    速览条: summaryBullets,
    速查: suchaAt >= 0 ? `${suchaGroups} 组 / ${suchaItems} 条` : "—",
  });
}

console.table(rows);
console.log("口径：字数＝去掉空白后的字符数；H1/H2/H3 只数行首标题；速查从含「速查」的那行起算。");
