// 媒体资产库：media_assets / run_media 的读写、去重、GC 与缺失恢复（引擎与 REST 共用）。
// 设计见 docs/video-module-research.md §4–5。
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { RunMediaView } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { mediaAssets, runMedia, type MediaAssetRow } from "../db/schema";
import { downloadBiliVideoStreams, muxToMp4 } from "./media";

export const DEFAULT_VIDEO_QN = 80;

export function biliContentKey(bvid: string, cid: number, qn: number): string {
  return createHash("sha1").update(`bili:${bvid}:${cid}:${qn}`).digest("hex");
}

export function fileContentKey(relPath: string): string {
  return createHash("sha1").update(`file:${relPath}`).digest("hex");
}

function now() {
  return Date.now();
}

async function mediaDir(dataDir: string) {
  const dir = join(dataDir, "media");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function filePresent(dataDir: string, relPath?: string | null): Promise<boolean> {
  if (!relPath) return false;
  try {
    const s = await stat(resolve(dataDir, relPath));
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });
}

/** ffprobe 输出写入临时文件再读回，避免依赖 stdout 管道。 */
function probeJson(file: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolvePromise) => {
    const tmp = join(tmpdir(), `sf-probe-${randomUUID()}.json`);
    let fd: number;
    try {
      fd = openSync(tmp, "w");
    } catch {
      resolvePromise(null);
      return;
    }
    const child = spawn(
      process.env.FFPROBE_PATH ?? "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { stdio: ["ignore", fd, "ignore"] },
    );
    child.once("error", () => {
      closeSync(fd);
      resolvePromise(null);
    });
    child.once("exit", () => {
      closeSync(fd);
      void readFile(tmp, "utf8")
        .then((text) => {
          try {
            resolvePromise(JSON.parse(text) as Record<string, unknown>);
          } catch {
            resolvePromise(null);
          }
        })
        .catch(() => resolvePromise(null))
        .finally(() => rm(tmp, { force: true }).catch(() => undefined));
    });
  });
}

async function probeVideo(file: string): Promise<{ codec?: string; durationSec?: number }> {
  const json = await probeJson(file);
  const streams = (json?.streams as Array<{ codec_type?: string; codec_name?: string }> | undefined) ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const format = json?.format as { duration?: string } | undefined;
  return {
    codec: video?.codec_name,
    durationSec: format?.duration ? Number(format.duration) : undefined,
  };
}

function parseMeta(row: MediaAssetRow | undefined): Record<string, unknown> {
  if (!row?.metaJson) return {};
  try {
    return JSON.parse(row.metaJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface BiliAssetRequest {
  bvid: string;
  cid: number;
  qn: number;
  cookie?: string;
  title?: string;
  cover?: string;
  uploader?: string;
  url?: string;
  durationSec?: number;
}

/**
 * 保证 B站视频资产就绪：命中内容键直接复用；否则下载 DASH 双流并合成 mp4 入库。
 * 绝不抛错（下载失败 → 资产行 status=error + error 信息，由调用方决定节点/附件语义）。
 */
export async function ensureBiliVideoAsset(
  db: AppDatabase,
  dataDir: string,
  req: BiliAssetRequest,
): Promise<{ assetId: string; status: "ready" | "error" | "restoring"; error?: string }> {
  const key = biliContentKey(req.bvid, req.cid, req.qn);
  const existing = db.select().from(mediaAssets).where(eq(mediaAssets.contentKey, key)).get();
  const ts = now();
  const meta = {
    bvid: req.bvid,
    cid: req.cid,
    qn: req.qn,
    title: req.title,
    cover: req.cover,
    uploader: req.uploader,
    url: req.url,
    durationSec: req.durationSec,
  };

  if (existing) {
    if (existing.status === "ready" && (await filePresent(dataDir, existing.filePath))) {
      db.update(mediaAssets).set({ lastUsedAt: ts }).where(eq(mediaAssets.id, existing.id)).run();
      return { assetId: existing.id, status: "ready" };
    }
    if (existing.status === "restoring") return { assetId: existing.id, status: "restoring" };
    db.update(mediaAssets)
      .set({ status: "restoring", metaJson: JSON.stringify(meta), updatedAt: ts })
      .where(eq(mediaAssets.id, existing.id))
      .run();
    return await downloadIntoAsset(db, dataDir, existing.id, meta, req);
  }

  const id = `asset_${randomUUID()}`;
  const finalRel = `media/${id}.mp4`;
  try {
    db.insert(mediaAssets)
      .values({
        id,
        contentKey: key,
        kind: "bili",
        status: "restoring",
        filePath: finalRel,
        mime: "video/mp4",
        durationSec: req.durationSec ?? null,
        title: req.title ?? null,
        metaJson: JSON.stringify(meta),
        createdAt: ts,
        updatedAt: ts,
        lastUsedAt: ts,
      })
      .run();
  } catch {
    const raced = db.select().from(mediaAssets).where(eq(mediaAssets.contentKey, key)).get();
    if (raced) return { assetId: raced.id, status: raced.status === "ready" ? "ready" : "restoring" };
    return { assetId: id, status: "error", error: "媒体资产写入冲突" };
  }
  return await downloadIntoAsset(db, dataDir, id, meta, req);
}

async function downloadIntoAsset(
  db: AppDatabase,
  dataDir: string,
  assetId: string,
  meta: Record<string, unknown>,
  req: BiliAssetRequest,
): Promise<{ assetId: string; status: "ready" | "error" | "restoring"; error?: string }> {
  const dir = await mkdtemp(join(await mediaDir(dataDir), ".tmp-"));
  const finalRel = `media/${assetId}.mp4`;
  try {
    const dl = await downloadBiliVideoStreams(req.bvid, req.cid, req.cookie, dir, req.qn);
    const out = join(dir, "out.mp4");
    await muxToMp4(dl.videoPath, dl.audioPath, out, dl.codecid);
    const size = (await stat(out)).size;
    const target = join(dataDir, finalRel);
    await mkdir(dirname(target), { recursive: true });
    await rename(out, target);
    db.update(mediaAssets)
      .set({
        status: "ready",
        size,
        durationSec: req.durationSec ?? (dl.durationSec ? Math.round(dl.durationSec) : undefined) ?? null,
        title: (meta.title as string | undefined) ?? null,
        metaJson: JSON.stringify({ ...meta, codecid: dl.codecid, qualityId: dl.qualityId }),
        updatedAt: now(),
        lastUsedAt: now(),
      })
      .where(eq(mediaAssets.id, assetId))
      .run();
    return { assetId, status: "ready" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(mediaAssets)
      .set({ status: "error", error: message, updatedAt: now() })
      .where(eq(mediaAssets.id, assetId))
      .run();
    return { assetId, status: "error", error: message };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 按资产记录重下（备份恢复/换机后文件缺失时由结果页触发；cookie 缺失时按游客档下载）。 */
export async function restoreBiliVideoAsset(
  db: AppDatabase,
  dataDir: string,
  assetId: string,
  cookie?: string,
  onProgress?: (progress: number, message?: string) => void,
): Promise<{ status: "ready" | "error"; error?: string }> {
  const row = db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).get();
  if (!row) return { status: "error", error: "媒体资产不存在" };
  if (row.kind !== "bili") return { status: "error", error: "仅 B站来源支持自动重下" };
  const meta = parseMeta(row);
  const bvid = String(meta.bvid ?? "");
  const cid = Number(meta.cid ?? 0);
  const qn = Number(meta.qn ?? DEFAULT_VIDEO_QN);
  if (!bvid || !cid) return { status: "error", error: "资产缺少 B站溯源信息（bvid/cid）" };
  db.update(mediaAssets).set({ status: "restoring", updatedAt: now() }).where(eq(mediaAssets.id, assetId)).run();
  const result = await downloadIntoAsset(db, dataDir, assetId, meta, {
    bvid,
    cid,
    qn,
    cookie,
    title: row.title ?? undefined,
    cover: meta.cover as string | undefined,
    uploader: meta.uploader as string | undefined,
    url: meta.url as string | undefined,
    durationSec: row.durationSec ?? undefined,
  });
  onProgress?.(100, result.status === "ready" ? "视频已重新下载" : undefined);
  return result.status === "ready" ? { status: "ready" } : { status: "error", error: result.error };
}

/** 本地文件资产：mp4/h264 直接引用 uploads 原件（零拷贝），否则转码归一化进媒体库。 */
export async function ensureFileVideoAsset(
  db: AppDatabase,
  dataDir: string,
  relPath: string,
  title?: string,
): Promise<{ assetId: string; status: "ready" | "error" | "restoring"; error?: string }> {
  const key = fileContentKey(relPath);
  const existing = db.select().from(mediaAssets).where(eq(mediaAssets.contentKey, key)).get();
  const ts = now();
  const sourceAbs = resolve(dataDir, relPath);
  if (!(await filePresent(dataDir, relPath))) {
    const message = "本地视频原件不存在，请重新上传后重跑该节点";
    if (existing) {
      db.update(mediaAssets).set({ status: "error", updatedAt: ts }).where(eq(mediaAssets.id, existing.id)).run();
      return { assetId: existing.id, status: "error", error: message };
    }
    const id = `asset_${randomUUID()}`;
    db.insert(mediaAssets)
      .values({
        id,
        contentKey: key,
        kind: "file",
        status: "error",
        filePath: relPath,
        mime: "video/mp4",
        title: title ?? null,
        createdAt: ts,
        updatedAt: ts,
        lastUsedAt: ts,
      })
      .run();
    return { assetId: id, status: "error", error: message };
  }
  if (existing?.status === "ready" && (await filePresent(dataDir, existing.filePath))) {
    db.update(mediaAssets).set({ lastUsedAt: ts }).where(eq(mediaAssets.id, existing.id)).run();
    return { assetId: existing.id, status: "ready" };
  }

  const id = existing?.id ?? `asset_${randomUUID()}`;
  if (!existing) {
    try {
      db.insert(mediaAssets)
        .values({
          id,
          contentKey: key,
          kind: "file",
          status: "restoring",
          filePath: `media/${id}.mp4`,
          mime: "video/mp4",
          title: title ?? null,
          createdAt: ts,
          updatedAt: ts,
          lastUsedAt: ts,
        })
        .run();
    } catch {
      const raced = db.select().from(mediaAssets).where(eq(mediaAssets.contentKey, key)).get();
      if (raced) return { assetId: raced.id, status: raced.status === "ready" ? "ready" : "restoring" };
    }
  } else {
    db.update(mediaAssets)
      .set({ status: "restoring", title: title ?? existing.title, updatedAt: ts })
      .where(eq(mediaAssets.id, id))
      .run();
  }

  try {
    const probe = await probeVideo(sourceAbs);
    if (extname(sourceAbs).toLowerCase() === ".mp4" && probe.codec === "h264") {
      // 浏览器可直放：引用 uploads 原件，不复制（文件生命周期归上传管理）
      db.update(mediaAssets)
        .set({
          status: "ready",
          filePath: relPath,
          size: (await stat(sourceAbs)).size,
          durationSec: probe.durationSec ? Math.round(probe.durationSec) : null,
          updatedAt: now(),
          lastUsedAt: now(),
        })
        .where(eq(mediaAssets.id, id))
        .run();
      return { assetId: id, status: "ready" };
    }
    // 其他容器/编码 → 归一化转码
    const dir = await mkdtemp(join(await mediaDir(dataDir), ".tmp-"));
    const out = join(dir, "out.mp4");
    try {
      await runFfmpeg([
        "-y",
        "-i",
        sourceAbs,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        out,
      ]);
      const target = join(dataDir, `media/${id}.mp4`);
      await rename(out, target);
      db.update(mediaAssets)
        .set({
          status: "ready",
          filePath: `media/${id}.mp4`,
          size: (await stat(target)).size,
          durationSec: probe.durationSec ? Math.round(probe.durationSec) : null,
          updatedAt: now(),
          lastUsedAt: now(),
        })
        .where(eq(mediaAssets.id, id))
        .run();
      return { assetId: id, status: "ready" };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(mediaAssets).set({ status: "error", updatedAt: now() }).where(eq(mediaAssets.id, id)).run();
    return { assetId: id, status: "error", error: message };
  }
}

/** 记录/更新 一次运行里某节点的可播放视频附件（按 run+node+sourceIndex 去重）。 */
export function attachRunMedia(
  db: AppDatabase,
  params: {
    runId: string;
    nodeId: string;
    sourceIndex: number;
    assetId: string;
    status: "ready" | "error" | "restoring";
    error?: string;
  },
): void {
  const ts = now();
  const existing = db
    .select()
    .from(runMedia)
    .where(eq(runMedia.runId, params.runId))
    .all()
    .find((r) => r.nodeId === params.nodeId && r.sourceIndex === params.sourceIndex);
  if (existing) {
    db.update(runMedia)
      .set({ assetId: params.assetId, status: params.status, error: params.error ?? null })
      .where(eq(runMedia.id, existing.id))
      .run();
    return;
  }
  db.insert(runMedia)
    .values({
      id: `runmedia_${randomUUID()}`,
      runId: params.runId,
      nodeId: params.nodeId,
      sourceIndex: params.sourceIndex,
      assetId: params.assetId,
      status: params.status,
      error: params.error ?? null,
      createdAt: ts,
    })
    .run();
}

/** 运行详情页媒体列表（run_media JOIN media_assets + 在盘预检）。 */
export async function listRunMediaViews(db: AppDatabase, dataDir: string, runId: string): Promise<RunMediaView[]> {
  const rows = db.select().from(runMedia).where(eq(runMedia.runId, runId)).orderBy(runMedia.createdAt).all();
  if (rows.length === 0) return [];
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  const assets = db.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds)).all();
  const byId = new Map(assets.map((a) => [a.id, a]));
  const presentMap = new Map<string, boolean>();
  await Promise.all(
    assets.map(async (a) => {
      presentMap.set(a.id, await filePresent(dataDir, a.filePath));
    }),
  );
  return rows.map((r) => {
    const asset = byId.get(r.assetId);
    const meta = parseMeta(asset);
    const label = asset?.title ?? (asset?.kind === "file" ? "本地视频" : "B站视频");
    return {
      id: r.id,
      runId: r.runId,
      nodeId: r.nodeId,
      sourceIndex: r.sourceIndex,
      label,
      kind: (asset?.kind ?? "bili") as RunMediaView["kind"],
      status: r.status as RunMediaView["status"],
      error: r.error ?? undefined,
      asset: asset
        ? {
            id: asset.id,
            title: asset.title ?? undefined,
            meta: {
              cover: meta.cover as string | undefined,
              uploader: meta.uploader as string | undefined,
              bvid: meta.bvid as string | undefined,
              cid: meta.cid as number | undefined,
              qn: meta.qn as number | undefined,
              url: meta.url as string | undefined,
            },
            durationSec: asset.durationSec ?? undefined,
            size: asset.size ?? undefined,
            present: presentMap.get(asset.id) ?? false,
            sourceUrl: (meta.url as string | undefined) ?? undefined,
          }
        : undefined,
    } satisfies RunMediaView;
  });
}

/**
 * 删除运行后的媒体 GC：只清理不再被任何 run_media 引用的资产行；
 * media/ 下的文件一并删除，uploads/ 原件（file 直放引用）只删行不删文件。
 */
export async function gcMediaAssets(db: AppDatabase, dataDir: string, assetIds: string[]): Promise<void> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  const remaining = new Set(
    db
      .select({ assetId: runMedia.assetId })
      .from(runMedia)
      .where(inArray(runMedia.assetId, ids))
      .all()
      .map((r) => r.assetId),
  );
  for (const assetId of ids) {
    if (remaining.has(assetId)) continue;
    const row = db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).get();
    if (!row) continue;
    if (row.status !== "restoring" && row.filePath.startsWith("media/")) {
      await rm(resolve(dataDir, row.filePath), { force: true }).catch(() => undefined);
    }
    db.delete(mediaAssets).where(eq(mediaAssets.id, assetId)).run();
  }
}
