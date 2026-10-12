/** 用结果页自己的 documentHeadings 验证目录条目（不是我用正则猜的）。 */
import { readFileSync } from "node:fs";
import { documentHeadings } from "../apps/web/src/lib/markdown.ts";

import { readdirSync } from "node:fs";
for (const f of readdirSync("note-candidates").filter((x) => x.endsWith(".md")).map((x) => x.replace(/.md$/, ""))) {
  const md = readFileSync(`note-candidates/${f}.md`, "utf8");
  const toc = documentHeadings(md);
  console.log(`\n### ${f}：目录 ${toc.length} 条`);
  for (const t of toc) console.log(`   L${t.level}  ${t.text.slice(0, 40)}`);
}
