// 媒体资产 REST：Range 流式播放/下载、在盘探测、缺失重下（B站）。
// 播放前提：文件为浏览器直放 mp4（H.264+AAC，+faststart），由引擎/恢复管线保证。
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { MediaRestoreJobView } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { biliCookies, mediaAssets } from "../db/schema";
import { restoreBiliVideoAsset } from "../lib/media-store";

interface RestoreJob {
  id: string;
  assetId: string;
  status: "running" | "done" | "error";
  progress: number;
  message?: string;
  error?: string;
  updatedAt: number;
}

export function mediaApi(db: AppDatabase, dataDir: string) {
  const api = new Hono();
  const jobs = new Map<string, RestoreJob>();

  const loadAsset = (id: string) => db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();

  const safeAbs = (relPath: string): string => {
    const root = resolve(dataDir);
    const abs = resolve(root, relPath);
    if (!abs.startsWith(root)) throw new Error("非法媒体路径");
    return abs;
  };

  async function sendFile(c: Context, assetId: string, disposition: "inline" | "attachment") {
    const row = loadAsset(assetId);
    if (!row) return c.json({ error: "媒体资产不存在" }, 404);
    const abs = safeAbs(row.filePath);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile() || info.size <= 0) {
      return c.json(
        { error: "媒体文件不在本地", assetId, status: row.status, kind: row.kind, meta: JSON.parse(row.metaJson ?? "{}") },
        404,
      );
    }
    const mime = row.mime || "video/mp4";
    if (disposition === "attachment") {
      c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(`${assetId}.mp4`)}"`);
    }
    const size = info.size;
    const range = c.req.header("range");
    if (!range) {
      c.header("Content-Type", mime);
      c.header("Accept-Ranges", "bytes");
      c.header("Content-Length", String(size));
      return c.body(Readable.toWeb(createReadStream(abs)) as ReadableStream);
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) {
      c.header("Content-Range", `bytes */${size}`);
      return c.json({ error: "Range 格式不正确" }, 416);
    }
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (!Number.isFinite(start) || start < 0 || end < start || start >= size) {
      c.header("Content-Range", `bytes */${size}`);
      return c.json({ error: "Range 越界" }, 416);
    }
    c.status(206);
    c.header("Content-Type", mime);
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Length", String(end - start + 1));
    c.header("Content-Range", `bytes ${start}-${end}/${size}`);
    return c.body(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream);
  }

  api.get("/:assetId/stream", (c) => sendFile(c, c.req.param("assetId"), "inline"));
  api.get("/:assetId/download", (c) => sendFile(c, c.req.param("assetId"), "attachment"));

  api.get("/:assetId/probe", async (c) => {
    const row = loadAsset(c.req.param("assetId"));
    if (!row) return c.json({ error: "媒体资产不存在" }, 404);
    const info = await stat(safeAbs(row.filePath)).catch(() => null);
    return c.json({
      assetId: row.id,
      status: row.status,
      error: row.error ?? undefined,
      present: Boolean(info?.isFile() && (info?.size ?? 0) > 0),
      size: info?.size,
      mime: row.mime,
      durationSec: row.durationSec,
    });
  });

  api.post("/:assetId/restore", async (c) => {
    const assetId = c.req.param("assetId");
    const row = loadAsset(assetId);
    if (!row) return c.json({ error: "媒体资产不存在" }, 404);
    if (row.kind !== "bili") return c.json({ error: "仅 B站来源支持自动重新下载；本地文件请重新上传后重跑" }, 400);
    for (const job of jobs.values()) {
      if (job.assetId === assetId && job.status === "running") {
        return c.json({ jobId: job.id });
      }
    }
    const jobId = `restore_${randomUUID()}`;
    const job: RestoreJob = { id: jobId, assetId, status: "running", progress: 0, message: "准备下载…", updatedAt: Date.now() };
    jobs.set(jobId, job);
    const cookie = db.select().from(biliCookies).where(eq(biliCookies.id, 1)).get()?.cookie;
    void restoreBiliVideoAsset(db, dataDir, assetId, cookie, (progress, message) => {
      job.progress = progress;
      if (message) job.message = message;
      job.updatedAt = Date.now();
    }).then(
      (result) => {
        job.status = result.status === "ready" ? "done" : "error";
        job.error = result.error;
        job.message = result.status === "ready" ? "视频已重新下载" : result.error;
        job.updatedAt = Date.now();
      },
      (err) => {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        job.updatedAt = Date.now();
      },
    );
    return c.json({ jobId }, 202);
  });

  api.get("/restore-jobs/:jobId", (c) => {
    const job = jobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "恢复任务不存在" }, 404);
    const view: MediaRestoreJobView = {
      id: c.req.param("jobId"),
      assetId: job.assetId,
      status: job.status,
      progress: job.progress,
      message: job.message,
      error: job.error,
      updatedAt: job.updatedAt,
    };
    return c.json(view);
  });

  return api;
}
