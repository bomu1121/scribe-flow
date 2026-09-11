/**
 * 文档门禁各脚本的共享工具。
 *
 * 三个脚本（docs-gen / docs-lint / docs-freeze）必须对「什么是正文」「front matter 长什么样」
 * 「CRLF 怎么处理」有一致的理解，否则生成块与校验会互相打架。所以这些定义只在这里写一份。
 *
 * 关键约定：所有文本读取都做 CRLF→LF 归一。Windows 检出（core.autocrlf）与 CI 的 ubuntu
 * 必须得到逐字节一致的结果。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".tmp-shots", ".dsh-vision-router"]);

/** 调研原文是抓取存档，不进入文档地图、不参与链接检查、不要求 front matter。 */
export const ARCHIVE_PREFIXES = ["docs/research/raw/"];

/** 每个 class 的必填键与新鲜度阈值。文档可用 front matter 的 review_days 覆盖阈值。 */
export const CLASS_RULES = {
  status: { required: ["title", "class", "owner", "last_reviewed"], maxAgeDays: 90 },
  decision: { required: ["title", "class", "status", "owner", "last_reviewed"], maxAgeDays: 180 },
  plan: { required: ["title", "class", "status", "owner", "last_reviewed"], maxAgeDays: 90 },
  evidence: { required: ["title", "class", "owner", "frozen_at", "content_hash"], maxAgeDays: null },
  research: { required: ["title", "class", "owner", "last_reviewed"], maxAgeDays: 365 },
};

export const STATUS_ENUM = new Set(["proposed", "accepted", "superseded", "deprecated", "done"]);

/**
 * front matter 的豁免路径：产物存档（样例稿、抓取原文）不是生命周期文档，不需要 front matter。
 * 其余 docs 下的 markdown 一律强制要求——刻意全量强制，否则 front matter 被误删时无人发现。
 */
export const FRONT_MATTER_EXEMPT = [/^docs\/samples\//, /^docs\/research\/raw\//];

export const requiresFrontMatter = (path) =>
  path.startsWith("docs/") && !FRONT_MATTER_EXEMPT.some((re) => re.test(path));

/**
 * 目录 ↔ class 的对应关系。目录名就是分类信号（见 AGENTS.md），R11 用它检查两者一致——
 * 这是「分类错误」里唯一能被机器判定的部分：判错 class 本身机器管不了，但放错目录能管。
 */
export const DIRECTORY_CLASS = [
  { re: /^docs\/[^/]+\.md$/, cls: "status", label: "docs/ 根" },
  { re: /^docs\/decisions\//, cls: "decision", label: "docs/decisions/" },
  { re: /^docs\/plans\//, cls: "plan", label: "docs/plans/" },
  { re: /^docs\/evidence\//, cls: "evidence", label: "docs/evidence/" },
  { re: /^docs\/research\//, cls: "research", label: "docs/research/" },
];

export const DAY_MS = 86_400_000;

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

export const isArchived = (p) => ARCHIVE_PREFIXES.some((prefix) => p.startsWith(prefix));

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

/** 正文指纹：只忽略结尾空白（编辑器增删末尾换行不该算"改动内容"）。 */
export const contentHash = (body) => createHash("sha256").update(body.replace(/\s+$/, ""), "utf8").digest("hex").slice(0, 16);

export function lastCommitDate(path) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ad", "--date=short", "--", path], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || "（未提交）";
  } catch {
    return "（未知）";
  }
}

export function docTitle(path) {
  const m = /^#\s+(.+)$/m.exec(read(path));
  return m ? m[1].trim() : path;
}

export const blockRe = (name) => new RegExp(`(<!-- docs-gen:${name}:start -->)([\\s\\S]*?)(<!-- docs-gen:${name}:end -->)`);

export function countRe(text, re) {
  return (text.match(re) ?? []).length;
}
