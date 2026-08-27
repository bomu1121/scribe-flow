import { Hono } from "hono";
import { z } from "zod";
import type { PageRef, VideoPreview } from "@scribe-flow/shared";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const PREVIEW_CACHE_TTL = 5 * 60 * 1000;
const PREVIEW_CACHE_MAX = 30;
const previewCache = new Map<string, { data: VideoPreview; ts: number }>();

function cacheGet(key: string): VideoPreview | null {
  const hit = previewCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > PREVIEW_CACHE_TTL) {
    previewCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key: string, data: VideoPreview) {
  if (previewCache.size >= PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
  previewCache.delete(key);
  previewCache.set(key, { data, ts: Date.now() });
}

function normalizeCover(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

function extractBvid(input: string): string | null {
  const text = input.trim();
  const bv = text.match(/(BV[0-9A-Za-z]+)/);
  if (bv) return bv[1];
  const av = text.match(/\bav(\d+)\b/i);
  if (av) return `av${av[1]}`;
  return null;
}

async function resolveBvid(input: string): Promise<string | null> {
  const direct = extractBvid(input);
  if (direct) return direct;

  // b23.tv / 短链：跟随重定向后取最终地址
  try {
    const res = await fetch(input, { method: "GET", redirect: "follow", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    return extractBvid(res.url);
  } catch {
    return null;
  }
}

async function fetchVideo(bvid: string): Promise<VideoPreview> {
  const cached = cacheGet(bvid);
  if (cached) return cached;

  const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://www.bilibili.com/",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`B 站接口请求失败（${res.status}）`);
  }

  const body = (await res.json()) as {
    code: number;
    message?: string;
    data?: {
      bvid: string;
      aid: number;
      cid: number;
      title: string;
      desc: string;
      duration: number;
      pic: string;
      pubdate: number;
      owner?: { name?: string; mid?: number };
      pages?: { page: number; cid: number; part: string; duration: number }[];
    };
  };

  if (body.code !== 0 || !body.data) {
    throw new Error(body.message || "无法解析该视频，请检查链接");
  }

  const d = body.data;
  const pages: PageRef[] =
    d.pages && d.pages.length > 0
      ? d.pages.map((p) => ({ page: p.page, cid: p.cid, part: p.part, duration: p.duration }))
      : [{ page: 1, cid: d.cid, part: d.title, duration: d.duration }];

  const data: VideoPreview = {
    bvid: d.bvid,
    aid: d.aid,
    cid: d.cid,
    title: d.title,
    description: d.desc ?? "",
    duration: d.duration,
    cover: normalizeCover(d.pic),
    uploader: d.owner?.name ?? "未知 UP 主",
    uploaderUid: d.owner?.mid ?? 0,
    pubdate: d.pubdate,
    pages,
  };

  cacheSet(bvid, data);
  return data;
}

const bodySchema = z.object({
  url: z.string().trim().min(1, "链接不能为空").max(2000, "链接过长"),
});

export const videosApi = new Hono();

videosApi.post("/preview", async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
  }

  try {
    const bvid = await resolveBvid(parsed.data.url);
    if (!bvid) {
      return c.json({ error: "未识别到 B 站视频链接（需要 BV 号或 av 号）" }, 400);
    }
    const video = await fetchVideo(bvid);
    return c.json(video);
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析视频失败";
    return c.json({ error: message }, 400);
  }
});
