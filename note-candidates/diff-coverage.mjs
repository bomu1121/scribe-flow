/** 逐句看原稿哪些句子在产出里没有被覆盖（3-gram 包含度），只做初筛，结论须人工复核。 */
import { readFileSync } from "node:fs";
const src = readFileSync("note-candidates/文稿-校对版.txt", "utf8");
const out = readFileSync(`note-candidates/${process.argv[2]}.md`, "utf8");
const norm = (s) => s.replace(/[#*>|`\-\s，。！？；：、（）()「」“”"'’·…—\[\]]/g, "");
const grams = (s) => { const t = norm(s), set = new Set(); for (let i = 0; i + 3 <= t.length; i += 1) set.add(t.slice(i, i + 3)); return set; };
const OUT = grams(out);
const rows = [];
for (const s of src.split(/(?<=[。！？])/)) {
  const c = s.trim();
  if (norm(c).length < 14) continue;
  const G = grams(c);
  let hit = 0;
  for (const g of G) if (OUT.has(g)) hit += 1;
  rows.push({ 覆盖: +(hit / G.size).toFixed(2), 原句: c });
}
rows.sort((a, b) => a.覆盖 - b.覆盖);
console.log(`原稿 ${rows.length} 句，对 ${process.argv[2]} 的覆盖从低到高：\n`);
for (const r of rows) console.log(`[${r.覆盖.toFixed(2)}] ${r.原句.slice(0, 105)}`);
