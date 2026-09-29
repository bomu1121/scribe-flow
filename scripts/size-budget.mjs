#!/usr/bin/env node
/**
 * 前端首屏关键路径的体积预算。
 *
 * 这里断言的是 `apps/web/dist/index.html` 直接引用的资源（首屏关键路径）的 gzip 体积。
 * 它原本写在 scripts/docs-lint.mjs 的 R9 里——一个跟文档毫无关系的构建产物断言，
 * 藏在文档门禁中，而且本地没构建时静默跳过。2026-09-30 移到这里，由 CI 在 build 之后显式执行。
 *
 * 阈值是**拦住继续恶化**的回归线，不是目标值：真正的主因是 Element Plus 全量 import，
 * 根治手段是改按需引入。所以这里只在超线时失败，不假装它是产品目标。
 *
 * 用法：node scripts/size-budget.mjs（dist 不存在时跳过并退出 0）
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { ROOT } from "./lib/docs-shared.mjs";

const FAIL_KIB = 650;
const WARN_KIB = 620;

const distDir = join(ROOT, "apps", "web", "dist");
const indexPath = join(distDir, "index.html");

if (!existsSync(indexPath)) {
  console.log("[size-budget] 未找到 apps/web/dist/index.html，跳过（需先 pnpm build）");
  process.exit(0);
}

const refs = [...readFileSync(indexPath, "utf8").matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
const files = [...new Set(refs)]
  .map((r) => join(distDir, r.replace(/^\//, "")))
  .filter((p) => existsSync(p) && statSync(p).isFile());
const measured = files.map((p) => ({ name: relative(join(distDir, "assets"), p), kib: gzipSync(readFileSync(p)).length / 1024 }));
const total = measured.reduce((sum, f) => sum + f.kib, 0);
const detail = measured
  .sort((a, b) => b.kib - a.kib)
  .map((f) => `${f.name} ${f.kib.toFixed(0)}KiB`)
  .join(" · ");

if (total > FAIL_KIB) {
  console.error(`[size-budget] 首屏关键路径 ${total.toFixed(0)}KiB 超过预算 ${FAIL_KIB}KiB（${detail}）`);
  process.exit(1);
}
if (total > WARN_KIB) {
  console.warn(`[size-budget] 首屏关键路径 ${total.toFixed(0)}KiB 已接近预算 ${FAIL_KIB}KiB（${detail}）`);
}
console.log(`[size-budget] 首屏关键路径 ${total.toFixed(0)}KiB / 预算 ${FAIL_KIB}KiB`);
