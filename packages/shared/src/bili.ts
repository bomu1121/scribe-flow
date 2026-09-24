import type { PageRef } from "./graph";

/** 登录后的 B 站账号摘要（Cookie 只存服务端，不返回任何凭证）。 */
export interface BiliAccount {
  mid: number;
  uname: string;
  face: string;
}

/** 快捷选择器里的一个来源集合（收藏夹 / 我的合集）。 */
export interface SourceCollection {
  id: string;
  title: string;
  cover?: string;
  count: number;
}

/** 快捷选择器里的一个可选视频。 */
export interface SourceVideoItem {
  bvid: string;
  aid?: number;
  cid?: number;
  title: string;
  cover: string;
  uploader: string;
  duration: number;
  pageCount: number;
  pages?: PageRef[];
}

/** 本地文件上传结果。 */
export interface UploadedFile {
  fileId: string;
  fileName: string;
  /** 服务端相对存储路径（如 uploads/xxxx.mp4），只存工程，不含绝对路径。 */
  storedPath: string;
  size: number;
}

/** B 站链接判定用的域名（含 App 分享短链）。 */
const BILI_HOST = /(?:^|\.)(?:bilibili\.com|b23\.tv|bili2233\.cn)$/i;

/**
 * 从一段文本里抠出 B 站链接。
 *
 * 「复制链接」常常带前后缀（App 分享是「【标题】+ 短链」，网页是整段分享文案），
 * 直接把整段丢给解析接口会失败，所以先取其中的 URL。
 * 文本里没有 URL 时退回裸 BV / av 号——`POST /api/videos/preview` 也认这两种输入。
 */
export function extractBiliUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const urls = trimmed.match(/https?:\/\/[^\s"'<>（）()【】{}，。；]+/gi) ?? [];
  const biliUrl = urls.find((url) => {
    try {
      return BILI_HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  });
  if (biliUrl) return biliUrl;

  // 少 scheme 的写法（b23.tv/xxx、www.bilibili.com/video/BVxxx）；前面不能是域名/路径字符，
  // 免得把 notbilibili.com 这类地址也当成 B 站链接。
  const bareUrl = trimmed.match(/(?<![\w.-])(?:b23\.tv|(?:www\.)?bilibili\.com)\/[^\s"'<>（）()【】{}，。；]*/i);
  if (bareUrl) return `https://${bareUrl[0]}`;

  // 其它域名的链接不认，但 BV / av 号仍可作为输入。
  const bv = trimmed.match(/\bBV[0-9A-Za-z]{8,}\b/);
  if (bv) return bv[0];
  const av = trimmed.match(/\bav(\d+)\b/i);
  if (av) return `av${av[1]}`;
  return null;
}

/** 分享文案里 `【…】` 形式的主标题（B 站分享的默认格式）；没有则返回空串。 */
export function extractShareTitle(text: string): string {
  return text.match(/【([^】]+)】/)?.[1]?.trim() ?? "";
}

/** 视频链接里的分 P 号（`?p=3` / `&p=3`）；没有或不是正整数时返回 1。 */
export function pageFromUrl(url: string): number {
  const matched = url.match(/[?&]p=(\d+)/i);
  const page = matched ? Number.parseInt(matched[1], 10) : Number.NaN;
  return Number.isFinite(page) && page >= 1 ? page : 1;
}
