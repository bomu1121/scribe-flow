/** 量「速查表」那一段的拥挤度：单元格字数、串联信号、行数。 */
import { readFileSync } from "node:fs";
const files = process.argv.slice(2);
const rows = [];
for (const f of files) {
  const t = readFileSync(f, "utf8");
  const lines = t.split("\n").filter((l) => /^\|/.test(l.trim()) && !/^\|[\s:|-]+\|$/.test(l.trim()));
  const cells = [];
  for (const l of lines) for (const c of l.split("|").map((x) => x.trim()).filter(Boolean)) cells.push(c);
  const dataCells = cells.slice(3); // 去掉表头
  const max = dataCells.length ? Math.max(...dataCells.map((c) => c.length)) : 0;
  const avg = dataCells.length ? Math.round(dataCells.reduce((s, c) => s + c.length, 0) / dataCells.length) : 0;
  // 串联信号：一格里有分号，或有「1 …2 …3 …」这种编号串
  const chained = dataCells.filter((c) => /[;；]/.test(c) || /1\s*[\.、]?\s*\S+.*2\s*[\.、]?\s*\S+/.test(c)).length;
  const bullets = (t.match(/^- \*\*/gm) ?? []).length;
  rows.push({
    方案: f.split(/[\/]/).pop().replace(/\.md$/, "").replace("速查表-", ""),
    表格行: lines.length || 0,
    清单条数: bullets,
    最大格字数: max,
    平均格字数: avg,
    串联格数: chained,
    总字数: t.length,
  });
}
console.table(rows);
