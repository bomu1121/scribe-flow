import QRCode from "qrcode";
import type { BiliAccount, SourceCollection, SourceVideoItem } from "@scribe-flow/shared";

export const BILI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export class BiliApiError extends Error {
  code: number;
  constructor(message: string, code = -1) {
    super(message);
    this.name = "BiliApiError";
    this.code = code;
  }
}

interface BiliResponse<T> {
  code: number;
  message?: string;
  ttl?: number;
  data: T | null;
}

function headers(cookie?: string): Record<string, string> {
  const base: Record<string, string> = {
    "User-Agent": BILI_USER_AGENT,
    Referer: "https://www.bilibili.com/",
    Accept: "application/json",
  };
  if (cookie) base.Cookie = cookie;
  return base;
}

async function biliGet<T>(url: string, cookie?: string): Promise<T> {
  const res = await fetch(url, { headers: headers(cookie), signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new BiliApiError(`B 站接口请求失败（${res.status}）`);
  const body = (await res.json()) as BiliResponse<T>;
  if (body.code === -101) throw new BiliApiError("B 站登录已失效，请重新扫码登录", -101);
  if (body.code !== 0) throw new BiliApiError(body.message || `B 站接口返回错误（${body.code}）`, body.code);
  if (body.data === null || body.data === undefined) throw new BiliApiError("B 站接口没有返回数据");
  return body.data;
}

function coverHttps(url: string | undefined): string {
  if (!url) return "";
  return url.replace(/^http:\/\//i, "https://").replace(/^\/\//, "https://");
}

// ---------- 扫码登录 ----------

export interface QrTicket {
  qrcodeKey: string;
  /** 二维码内容（B 站登录页 URL）。 */
  url: string;
}

export type QrPollStatus = "waiting" | "scanned" | "expired" | "success";

export interface QrPollResult {
  status: QrPollStatus;
  cookie?: string;
}

/** 申请网页登录二维码。 */
export async function startBiliQr(): Promise<QrTicket> {
  const res = await fetch("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", {
    headers: headers(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new BiliApiError(`B 站登录接口请求失败（${res.status}）`);
  const body = (await res.json()) as BiliResponse<{ url: string; qrcode_key: string }>;
  if (body.code !== 0 || !body.data) throw new BiliApiError(body.message || "申请二维码失败");
  return { qrcodeKey: body.data.qrcode_key, url: body.data.url };
}

function cookieFromSetCookie(res: Response): string {
  try {
    const setCookies = res.headers.getSetCookie();
    return setCookies
      .map((line) => line.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
  } catch {
    return "";
  }
}

/** 从登录成功回调 URL 的 query 里兜底重建 Cookie。 */
export function cookieFromSuccessUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const query = new URL(url).searchParams;
    const pairs = ["DedeUserID", "DedeUserID__ckMd5", "SESSDATA", "bili_jct", "sid"]
      .map((key) => {
        const value = query.get(key);
        return value ? `${key}=${value}` : "";
      })
      .filter(Boolean);
    return pairs.join("; ");
  } catch {
    return "";
  }
}

export async function pollBiliQr(qrcodeKey: string): Promise<QrPollResult> {
  const res = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
    { headers: headers(), signal: AbortSignal.timeout(12000) },
  );
  if (!res.ok) throw new BiliApiError(`B 站登录轮询失败（${res.status}）`);
  const body = (await res.json()) as BiliResponse<{ url?: string; code?: number; message?: string }>;

  if (body.code === 0) {
    const cookie = cookieFromSetCookie(res) || cookieFromSuccessUrl(body.data?.url);
    return { status: "success", cookie: cookie || undefined };
  }
  if (body.code === 86038) return { status: "expired" };
  if (body.code === 86090) return { status: "scanned" };
  if (body.code === 86101) return { status: "waiting" };
  throw new BiliApiError(body.message || `登录轮询失败（${body.code}）`, body.code);
}

export function renderQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: "M" });
}

/** 校验 Cookie 并返回账号信息。 */
export async function fetchBiliAccount(cookie: string): Promise<BiliAccount> {
  const data = await biliGet<{
    isLogin?: boolean;
    mid?: number;
    uname?: string;
    face?: string;
  }>("https://api.bilibili.com/x/web-interface/nav", cookie);
  if (!data.isLogin) throw new BiliApiError("B 站登录已失效，请重新扫码登录", -101);
  return { mid: Number(data.mid ?? 0), uname: data.uname ?? "B 站用户", face: coverHttps(data.face) };
}

// ---------- 收藏夹 ----------

export async function fetchFavFolders(cookie: string, mid: number): Promise<SourceCollection[]> {
  const data = await biliGet<{
    count?: number;
    list?: { id: number; title: string; cover?: string; media_count?: number; attr?: number }[];
  }>(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, cookie);
  return (data.list ?? [])
    .filter((f) => (f.attr ?? 0) !== 1)
    .map((f) => ({ id: String(f.id), title: f.title, cover: coverHttps(f.cover), count: Number(f.media_count ?? 0) }));
}

interface FavMediaItem {
  id?: number;
  aid?: number;
  bvid?: string;
  title?: string;
  cover?: string;
  duration?: number;
  upper?: { name?: string; mid?: number };
  page?: number | { cid?: number; page?: number; part?: string; duration?: number };
  pages?: { cid: number; page: number; part: string; duration: number }[];
  videos?: number;
  cnt_info?: { collect?: number };
}

export async function fetchFavVideos(
  cookie: string,
  mediaId: string,
  page: number,
  keyword: string,
  pageSize = 20,
): Promise<{ items: SourceVideoItem[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    media_id: mediaId,
    pn: String(page),
    ps: String(pageSize),
    keyword,
    order: "mtime",
    type: "0",
    platform: "web",
  });
  const data = await biliGet<{ medias?: FavMediaItem[]; has_more?: boolean }>(
    `https://api.bilibili.com/x/v3/fav/resource/list?${params.toString()}`,
    cookie,
  );
  return { items: (data.medias ?? []).map(normalizeFavItem), hasMore: Boolean(data.has_more) };
}

function normalizeFavItem(item: FavMediaItem): SourceVideoItem {
  const pageObj = typeof item.page === "object" && item.page !== null ? item.page : undefined;
  const pageRef = pageObj
    ? {
        cid: pageObj.cid ?? 0,
        page: pageObj.page ?? 1,
        part: pageObj.part ?? "",
        duration: pageObj.duration ?? 0,
      }
    : undefined;
  const pages = item.pages?.length ? item.pages : pageRef ? [pageRef] : undefined;
  return {
    bvid: item.bvid ?? "",
    aid: Number(item.id ?? item.aid ?? 0),
    cid: pageObj?.cid,
    title: item.title ?? "",
    cover: coverHttps(item.cover),
    uploader: item.upper?.name ?? "",
    duration: Number(item.duration ?? 0),
    pageCount: Number(item.pages?.length ?? (pageRef ? 1 : item.videos ?? 1)),
    pages,
  };
}

// ---------- 稍后再看 ----------

interface ToviewItem {
  aid?: number;
  bvid?: string;
  title?: string;
  pic?: string;
  duration?: number;
  owner?: { name?: string; mid?: number };
  videos?: number;
  cid?: number;
}

export async function fetchWatchLater(cookie: string): Promise<SourceVideoItem[]> {
  const data = await biliGet<{ count?: number; list?: ToviewItem[] }>("https://api.bilibili.com/x/v2/history/toview", cookie);
  return (data.list ?? []).map((item) => ({
    bvid: item.bvid ?? "",
    aid: Number(item.aid ?? 0),
    cid: Number(item.cid ?? 0) || undefined,
    title: item.title ?? "",
    cover: coverHttps(item.pic),
    uploader: item.owner?.name ?? "",
    duration: Number(item.duration ?? 0),
    pageCount: Number(item.videos ?? 1),
  }));
}

// ---------- 观看历史 ----------

interface HistoryItem {
  title?: string;
  cover?: string;
  history?: { bvid?: string; cid?: number; page?: number; part?: string; business?: string };
  author_name?: string;
  duration?: number;
  videos?: number;
}

export async function fetchHistory(
  cookie: string,
  max: string | number,
  viewAt: string | number,
  pageSize = 20,
): Promise<{ items: SourceVideoItem[]; next: { max: number; viewAt: number }; hasMore: boolean }> {
  const params = new URLSearchParams({
    max: String(max || 0),
    view_at: String(viewAt || 0),
    business: "archive",
    ps: String(pageSize),
  });
  const data = await biliGet<{
    cursor?: { max?: number; view_at?: number; business?: string };
    list?: HistoryItem[];
  }>(`https://api.bilibili.com/x/web-interface/history/cursor?${params.toString()}`, cookie);
  const items = (data.list ?? [])
    .filter((item) => item.history?.business === "archive" && item.history?.bvid)
    .map((item) => ({
      bvid: item.history?.bvid ?? "",
      cid: item.history?.cid,
      title: item.title ?? "",
      cover: coverHttps(item.cover),
      uploader: item.author_name ?? "",
      duration: Number(item.duration ?? 0),
      pageCount: Number(item.videos ?? 1),
    }));
  return {
    items,
    next: { max: Number(data.cursor?.max ?? 0), viewAt: Number(data.cursor?.view_at ?? 0) },
    hasMore: items.length > 0 && Boolean(data.cursor?.max),
  };
}

// ---------- 我的合集（官方稳定接口） ----------

export async function fetchMyCollections(
  cookie: string | undefined,
  mid: number,
  pageNum: number,
  pageSize = 20,
): Promise<{ items: SourceCollection[]; total: number }> {
  const params = new URLSearchParams({ mid: String(mid), page_num: String(pageNum), page_size: String(pageSize) });
  const data = await biliGet<{
    items_lists?: {
      seasons_list?: { meta?: { season_id: number; title?: string; name?: string; cover?: string; total?: number } }[];
      series_list?: { meta?: { series_id: number; title?: string; name?: string; cover?: string; total?: number } }[];
      page?: { page_num?: number; page_size?: number; total?: number };
    };
  }>(`https://api.bilibili.com/x/polymer/web-space/seasons_series_list?${params.toString()}`, cookie);
  const seasons = (data.items_lists?.seasons_list ?? []).map((s) => ({
    id: `season:${s.meta?.season_id ?? ""}`,
    title: s.meta?.title || s.meta?.name || "未命名合集",
    cover: coverHttps(s.meta?.cover),
    count: Number(s.meta?.total ?? 0),
  }));
  const series = (data.items_lists?.series_list ?? []).map((s) => ({
    id: `series:${s.meta?.series_id ?? ""}`,
    title: s.meta?.title || s.meta?.name || "未命名系列",
    cover: coverHttps(s.meta?.cover),
    count: Number(s.meta?.total ?? 0),
  }));
  return { items: [...seasons, ...series], total: Number(data.items_lists?.page?.total ?? 0) };
}

interface SeasonArchive {
  aid?: number;
  bvid?: string;
  title?: string;
  pic?: string;
  duration?: number;
  ctime?: number;
}

export async function fetchCollectionVideos(
  cookie: string | undefined,
  mid: number,
  collectionId: string,
  pageNum: number,
  pageSize = 20,
): Promise<{ items: SourceVideoItem[]; hasMore: boolean }> {
  const [kind, rawId] = collectionId.split(":");
  const params = new URLSearchParams({
    mid: String(mid),
    [kind === "series" ? "series_id" : "season_id"]: rawId,
    page_num: String(pageNum),
    page_size: String(pageSize),
  });
  const data = await biliGet<{
    archives?: SeasonArchive[];
    page?: { total?: number; page_num?: number; page_size?: number };
  }>(`https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?${params.toString()}`, cookie);
  const items = (data.archives ?? []).map((a) => ({
    bvid: a.bvid ?? "",
    aid: Number(a.aid ?? 0),
    title: a.title ?? "",
    cover: coverHttps(a.pic),
    uploader: "",
    duration: Number(a.duration ?? 0),
    pageCount: 1,
  }));
  const total = Number(data.page?.total ?? 0);
  return { items, hasMore: pageNum * pageSize < total };
}
