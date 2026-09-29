/**
 * 文档门禁各脚本的共享工具。
 *
 * docs-gen / docs-lint 必须对「什么是正文」「front matter 长什么样」「CRLF 怎么处理」有一致的理解，
 * 所以这些定义只在这里写一份。
 *
 * 关键约定：所有文本读取都做 CRLF→LF 归一。Windows 检出（core.autocrlf）与 CI 的 ubuntu
 * 必须得到逐字节一致的结果。
 *
 * front matter 刻意只有三个字段（title / class / status）。2026-09-30 之前还有
 * owner / last_reviewed / review_days / frozen_at / content_hash 五个字段，配一条新鲜度告警、
 * 一条内容指纹校验与 pnpm docs:freeze 重冻流程——那是给多人团队与审计场景设计的，
 * 单人仓库里的实际作用是：每篇文档多五行手写元数据、每次改动多一道摩擦。已删除。
 * 冻结能力本来也不需要专门的机制：git 提交哈希就是不可伪造的冻结。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".tmp-shots", ".dsh-vision-router"]);

/** 每个 class 的必填键。class 只有三种：现状说明、决策、调研。 */
export const CLASS_RULES = {
  doc: { required: ["title", "class"] },
  decision: { required: ["title", "class", "status"] },
  research: { required: ["title", "class"] },
};

export const STATUS_ENUM = new Set(["proposed", "accepted", "superseded", "deprecated", "done"]);

/**
 * front matter 的豁免路径：样例稿是产品输出的存档，不是生命周期文档。
 * 其余 docs 下的 markdown 一律强制要求——刻意全量强制，否则 front matter 被误删时无人发现。
 *
 * （原先还豁免 `docs/research/raw/` 的抓取原文；那批存档已于 2026-09-30 移出仓库。）
 */
export const FRONT_MATTER_EXEMPT = [/^docs\/samples\//];

export const requiresFrontMatter = (path) =>
  path.startsWith("docs/") && !FRONT_MATTER_EXEMPT.some((re) => re.test(path));

/**
 * 目录 ↔ class 的对应关系。目录名就是分类信号（见 AGENTS.md）。
 *
 * 2026-09-30 之前还有 plans/ 与 evidence/ 两个目录，各配一条「class 必须与目录一致」的规则。
 * 计划与验收快照属于时序信息：放进仓库就会腐烂，还要额外用指纹冻住才算「不可改」。
 * 它们的内容由 CHANGELOG 与 git 历史承担，目录本身已删除，那条一致性规则也一并删除。
 */
export const DIRECTORY_CLASS = [
  { re: /^docs\/[^/]+\.md$/, cls: "doc", label: "docs/ 根" },
  { re: /^docs\/decisions\//, cls: "decision", label: "docs/decisions/" },
  { re: /^docs\/research\//, cls: "research", label: "docs/research/" },
];

export function walk(dir, filter, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path, filter, out);
    } else if (filter(path)) {
      out.push(path);
    }
  }
  return out;
}

export const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

/** 极简 front matter 解析：只支持 `key: value` 标量，够用且不引入 yaml 依赖。 */
export function parseFrontMatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    data[m[1]] = raw === "" || raw === "null" || raw === "~" ? null : raw.replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(end + 4) };
}

export const blockRe = (name) => new RegExp(`(<!-- docs-gen:${name}:start -->)([\\s\\S]*?)(<!-- docs-gen:${name}:end -->)`);
