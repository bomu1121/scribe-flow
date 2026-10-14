import type { VideoPreview } from "@scribe-flow/shared";

/**
 * 「链接解析结果」（封面/标题/分P/合集列表）的进程内缓存。
 *
 * 为什么需要它：画布开了视口裁剪（`FlowCanvas.vue` 的 `onlyRenderVisibleElements`），
 * 节点滚出视野会被**卸载**。这份解析结果只活在 `ScribeNode.vue` 的本地 ref 里，
 * 卸载就没了——拖回来重新挂载时只能再发一次请求，卡片会退回「正在解析视频信息…」。
 * 实测（CDP 逐帧录制，口径与复现步骤见 docs/research/canvas-viewport-culling-remount.md）：
 * 重新挂载后第 0 帧就进转圈、持续 610ms、38 帧内容不完整。
 * 缓存让重新挂载同步拿到结果：不转圈、不重复请求、也不把同样的值往工程图里再写一遍。
 *
 * 时间上限与后端的预览缓存（`apps/server/src/routes/videos.ts` 的 `PREVIEW_CACHE_TTL`）
 * 同样取 5 分钟、条数上限同样取 30：命中时最坏也只是比「真的再请求一次」旧同样的时长。
 */
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 30;

const cache = new Map<string, { data: VideoPreview; ts: number }>();

/** 以链接原文为键（去掉首尾空白）——同一个视频的分P/合集链接是不同键，不互相覆盖。 */
function keyOf(url: string): string {
  return url.trim();
}

export function readCachedPreview(url: string, now = Date.now()): VideoPreview | null {
  const key = keyOf(url);
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

export function cachePreview(url: string, data: VideoPreview, now = Date.now()): void {
  const key = keyOf(url);
  if (!key) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  // 重写同一键时先删后插，让它变成最新的一条（与后端缓存同样的处置）。
  cache.delete(key);
  cache.set(key, { data, ts: now });
}
