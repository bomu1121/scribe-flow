// P1 真实链路冒烟：keepVideo 运行 → 媒体资产 → Range 流 → 缺失探测 → restore 重下。
// 用法：node media-smoke.mjs（环境：BASE / SMOKE_DATA_DIR，默认 http://127.0.0.1:8790）
import { rm } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:8790";
const DATA_DIR = process.env.SMOKE_DATA_DIR ?? "";
const BVID = process.env.SMOKE_BVID ?? "BV1eqYx6UE9V";

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(path, isDone, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await j("GET", path);
    if (isDone(last)) return last;
    await sleep(700);
  }
  throw new Error(`轮询超时：${label} ${path} ${JSON.stringify(last)}`);
}

const graph = {
  schemaVersion: 1,
  nodes: [
    {
      id: "n_src",
      type: "source.bili",
      position: { x: 0, y: 0 },
      data: {
        label: "B站链接",
        url: `https://www.bilibili.com/video/${BVID}`,
        bvid: BVID,
        title: "POC 媒体冒烟视频",
        duration: 387,
        keepVideo: true,
        videoQn: 80,
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const project = await j("POST", "/api/projects", { name: "媒体模块 P1 冒烟" });
console.log("[SMOKE] project", project.id);
await j("PUT", `/api/projects/${project.id}/graph`, { graph });
const created = await j("POST", `/api/projects/${project.id}/runs`, { scope: "all" });
const runId = created.id;
console.log("[SMOKE] run started", runId);

const detail = await poll(`/api/runs/${runId}`, (r) => r.status !== "running", 240_000, "运行完成");
console.log("[SMOKE] run status", detail.status, "| summary:", detail.summary);
if (detail.status !== "success") throw new Error(`运行失败：${detail.error}`);
const media = detail.media ?? [];
if (media.length !== 1) throw new Error(`期望 1 个媒体附件，实际 ${media.length}`);
const view = media[0];
const assetId = view.asset.id;
console.log("[SMOKE] media", JSON.stringify({ label: view.label, status: view.status, present: view.asset.present, qn: view.asset.meta.qn, size: view.asset.size, durationSec: view.asset.durationSec }));
if (!view.asset.present || view.status !== "ready") throw new Error("媒体附件未就绪");

const range = await fetch(`${BASE}/api/media/${assetId}/stream`, { headers: { Range: "bytes=0-1023" } });
const buf = await range.arrayBuffer();
if (range.status !== 206 || buf.byteLength !== 1024) throw new Error(`Range 流异常：${range.status} ${buf.byteLength}`);
console.log("[SMOKE] range 206 OK, content-range:", range.headers.get("content-range"));

const probe = await j("GET", `/api/media/${assetId}/probe`);
console.log("[SMOKE] probe before missing:", JSON.stringify(probe));
if (probe.present !== true) throw new Error("probe 应 present=true");

// 模拟备份恢复后文件缺失 → probe false → restore
const file = join(DATA_DIR, "media", `${assetId}.mp4`);
await rm(file, { force: true });
const probe2 = await j("GET", `/api/media/${assetId}/probe`);
console.log("[SMOKE] probe after rm file:", JSON.stringify(probe2));
if (probe2.present !== false) throw new Error("删除文件后 probe 应 present=false");

const restore = await j("POST", `/api/media/${assetId}/restore`);
console.log("[SMOKE] restore job", restore.jobId);
const job = await poll(`/api/media/restore-jobs/${restore.jobId}`, (r) => r.status !== "running", 300_000, "恢复完成");
console.log("[SMOKE] restore job done:", JSON.stringify(job));
if (job.status !== "done") throw new Error(`恢复失败：${job.error}`);

const probe3 = await j("GET", `/api/media/${assetId}/probe`);
const range2 = await fetch(`${BASE}/api/media/${assetId}/stream`, { headers: { Range: "bytes=0-1023" } });
if (probe3.present !== true || range2.status !== 206) throw new Error("恢复后文件或 Range 仍异常");
console.log("[SMOKE] restore 后 probe present=true, range 206 OK");

if (process.env.SMOKE_KEEP !== "1") {
  await j("DELETE", `/api/projects/${project.id}`);
}
console.log("[SMOKE-PASS] 全链路通过：keepVideo 运行 → 资产 → Range → 缺失 → restore 重下");
console.log(`[SMOKE-KEEP] project=${project.id} run=${runId}`);
