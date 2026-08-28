import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { biliCookies } from "../db/schema";
import {
  BiliApiError,
  fetchCollectionVideos,
  fetchFavFolders,
  fetchFavVideos,
  fetchHistory,
  fetchMyCollections,
  fetchWatchLater,
} from "../lib/bilibili";

async function requireCookie(db: AppDatabase) {
  const row = await db.select().from(biliCookies).where(eq(biliCookies.id, 1)).get();
  if (!row) {
    throw new BiliApiError("请先登录 B 站", -101);
  }
  return row;
}

function pageOf(value: string | undefined, fallback = 1): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function bilibiliApi(db: AppDatabase) {
  const api = new Hono();

  api.onError((err, c) => {
    if (err instanceof BiliApiError) {
      const status = err.code === -101 ? 401 : 400;
      return c.json({ error: err.message }, status);
    }
    console.error("[bilibili] 未处理错误：", err);
    return c.json({ error: err instanceof Error ? err.message : "B 站接口调用失败" }, 500);
  });

  // 收藏夹列表
  api.get("/fav/folders", async (c) => {
    const auth = await requireCookie(db);
    const folders = await fetchFavFolders(auth.cookie, auth.mid);
    return c.json({ items: folders });
  });

  // 收藏夹内容（支持搜索/分页）
  api.get("/fav/folders/:id/videos", async (c) => {
    const auth = await requireCookie(db);
    const result = await fetchFavVideos(auth.cookie, c.req.param("id"), pageOf(c.req.query("page")), c.req.query("keyword")?.trim() ?? "", 20);
    return c.json(result);
  });

  // 我的合集 / 系列列表（官方稳定接口）
  api.get("/seasons", async (c) => {
    const auth = await requireCookie(db);
    const result = await fetchMyCollections(auth.cookie, auth.mid, pageOf(c.req.query("page")));
    return c.json(result);
  });

  // 合集 / 系列内视频
  api.get("/collections/:id/videos", async (c) => {
    const auth = await requireCookie(db);
    const result = await fetchCollectionVideos(auth.cookie, auth.mid, c.req.param("id"), pageOf(c.req.query("page")));
    return c.json(result);
  });

  // 兼容方案文档里的旧路径
  api.get("/collected/:id/videos", async (c) => {
    const auth = await requireCookie(db);
    const result = await fetchCollectionVideos(auth.cookie, auth.mid, c.req.param("id"), pageOf(c.req.query("page")));
    return c.json(result);
  });

  // 稍后再看（一次性返回，上限 100）
  api.get("/watch-later", async (c) => {
    const auth = await requireCookie(db);
    const items = await fetchWatchLater(auth.cookie);
    return c.json({ items, hasMore: false });
  });

  // B 站历史（游标分页）
  api.get("/history", async (c) => {
    const auth = await requireCookie(db);
    const result = await fetchHistory(auth.cookie, c.req.query("max") ?? "0", c.req.query("viewAt") ?? "0", 20);
    return c.json(result);
  });

  return api;
}
