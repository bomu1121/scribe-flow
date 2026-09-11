#!/usr/bin/env node
/**
 * 冻结验收档案：写入/更新 class: evidence 文档的 content_hash 与 frozen_at。
 *
 * 为什么需要一个显式命令：验收档案的规则是"正文一个字节都不能变"，由 docs-lint 的 R6 用内容指纹校验。
 * 指纹不匹配时 lint 只会报错、不会自动修复——否则"改了验收结论"就会被静默合法化。
 * 因此确需改动时必须显式跑一次本命令，这一步的摩擦是刻意保留的。
 *
 * 用法：
 *   node scripts/docs-freeze.mjs docs/evidence/2026-08-28-m5-acceptance.md     冻结指定文档
 *   node scripts/docs-freeze.mjs --all                     冻结全部 evidence 文档（首次迁移用）
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, contentHash, isArchived, parseFrontMatter, read, walk } from "./lib/docs-shared.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ALL = process.argv.includes("--all");

if (!ALL && args.length === 0) {
  console.error("[docs-freeze] 用法：node scripts/docs-freeze.mjs <文档路径>… | --all");
  process.exit(1);
}

const targets = ALL ? walk("docs", (p) => p.endsWith(".md") && !isArchived(p)) : args;

let changed = 0;
let skipped = 0;
for (const file of targets) {
  const parsed = parseFrontMatter(read(file));
  // --all 模式只处理"已经是 evidence"的文档；没有 front matter 的（样例、调研原文）本就不需要冻结。
  if (!parsed || parsed.data.class !== "evidence") {
    if (!ALL) {
      console.error(
        `[docs-freeze] 跳过 ${file}：${parsed ? `class 为 ${parsed.data.class ?? "(空)"}，只有 evidence 需要冻结` : "没有 front matter"}`,
      );
    }
    skipped += 1;
    continue;
  }

  const hash = contentHash(parsed.body);
  const frozenAt = parsed.data.frozen_at ?? new Date().toISOString().slice(0, 10);
  if (parsed.data.content_hash === hash && parsed.data.frozen_at === frozenAt) {
    skipped += 1;
    continue;
  }

  const next = read(file).replace(
    /^---\n([\s\S]*?)\n---/,
    (_, fm) => {
      const lines = fm
        .split("\n")
        .filter((line) => !/^(?:content_hash|frozen_at):/.test(line))
        .concat([`frozen_at: ${frozenAt}`, `content_hash: ${hash}`]);
      return `---\n${lines.join("\n")}\n---`;
    },
  );
  writeFileSync(join(ROOT, file), next, "utf8");
  console.log(`[docs-freeze] 已冻结 ${file} → frozen_at: ${frozenAt}, content_hash: ${hash}`);
  changed += 1;
}

console.log(`[docs-freeze] 完成：更新 ${changed} 份，跳过 ${skipped} 份`);
