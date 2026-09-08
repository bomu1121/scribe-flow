import type { NutstoreListEntry, NutstoreListResult, NutstoreReadResult } from "@scribe-flow/shared";

/** WebDAV 配置（含服务端明文密码，禁止返回给前端）。 */
export interface NutstoreConfig {
  serverUrl: string;
  account: string;
  password: string;
}

export interface RemoteMarkdownFile {
  path: string;
  name: string;
  size?: number;
  etag?: string;
  lastModified?: number;
}

export interface RemoteMarkdownNote extends RemoteMarkdownFile {
  content: string;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:getetag/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

/** 坚果云单次 PROPFIND 的目录项上限（文件+文件夹）。 */
export const NUTSTORE_PROPFIND_LIMIT = 750;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:(?:[A-Za-z0-9]+:)?${tag})\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${tag}>`, "i");
  const match = re.exec(xml);
  return match?.[1]?.trim() ?? "";
}

function normalizeRemotePath(path: string): string {
  const cleaned = path.replace(/\\/g, "/").trim();
  return cleaned.startsWith("/") ? cleaned.replace(/\/+$/, "") || "/" : `/${cleaned.replace(/\/+$/, "")}`;
}

/** 把逻辑远程路径拼到服务器 URL 上；每个路径段单独 encode，保留中文与空格。 */
export function remoteToUrl(config: NutstoreConfig, remotePath: string): string {
  const base = config.serverUrl.endsWith("/") ? config.serverUrl : `${config.serverUrl}/`;
  const normalized = normalizeRemotePath(remotePath);
  const rel = normalized === "/" ? "" : normalized.replace(/^\/+/, "").split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return rel ? `${base}${rel}` : base.replace(/\/+$/, "") + "/";
}

/** 从 WebDAV href 还原逻辑远程路径（剥离服务器 URL 的 path 前缀）。 */
export function hrefToRemotePath(config: NutstoreConfig, href: string): string {
  try {
    const base = new URL(config.serverUrl);
    const url = new URL(href, config.serverUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    let pathname = decodeURIComponent(url.pathname);
    if (basePath && pathname === basePath) return "/";
    if (basePath && pathname.startsWith(`${basePath}/`)) pathname = pathname.slice(basePath.length);
    return normalizeRemotePath(pathname);
  } catch {
    return normalizeRemotePath(href);
  }
}

function parseHttpDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

/** 解析 WebDAV multistatus XML 中每个 response 的 href/类型/大小/etag/时间。 */
export function parseMultistatus(xml: string): Array<{ href: string; isDirectory: boolean; size?: number; etag?: string; lastModified?: number }> {
  const result: Array<{ href: string; isDirectory: boolean; size?: number; etag?: string; lastModified?: number }> = [];
  const responseRe = /<(?:[A-Za-z0-9]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1];
    const href = decodeXml(extractTag(block, "href").trim());
    if (!href) continue;
    const resourceType = extractTag(block, "resourcetype");
    const isDirectory = /<(?:[A-Za-z0-9]+:)?collection\b/i.test(resourceType);
    const sizeRaw = extractTag(block, "getcontentlength");
    const size = sizeRaw ? Number(decodeXml(sizeRaw)) : undefined;
    const etag = extractTag(block, "getetag") ? decodeXml(extractTag(block, "getetag")).trim() : undefined;
    const lastModified = parseHttpDate(decodeXml(extractTag(block, "getlastmodified")).trim() || undefined);
    result.push({ href, isDirectory, size: isDirectory ? undefined : size, etag, lastModified });
  }
  return result;
}

export interface DavRequestOptions {
  method: string;
  remotePath?: string;
  depth?: "0" | "1" | "infinity";
  body?: string | Buffer;
  headers?: Record<string, string>;
}

/** 统一 dav 请求：Basic Auth + 429/503 退避重试；返回原始 Response。 */
async function davFetch(config: NutstoreConfig, options: DavRequestOptions, retries = 2): Promise<Response> {
  const url = options.remotePath === undefined ? config.serverUrl : remoteToUrl(config, options.remotePath);
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.account}:${config.password}`).toString("base64")}`,
    ...(options.depth ? { Depth: options.depth } : {}),
    ...(options.body !== undefined ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
    ...options.headers,
  };
  let lastError: unknown;
  const body: BodyInit | null | undefined =
    typeof options.body === "string" ? options.body : options.body ? new Uint8Array(options.body) : undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, {
      method: options.method,
      headers,
      body,
      // WebDAV 服务端通常不信任浏览器 CORS，这里由 Node 后端直接请求，不受浏览器限制。
    }).catch((err: unknown) => {
      lastError = err;
      return undefined;
    });
    if (!res) {
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastError instanceof Error ? lastError : new Error("无法连接坚果云 WebDAV 服务");
    }
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      await res.text().catch(() => "");
      if (attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0") * 1000;
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 5000) : 600 * (attempt + 1));
        continue;
      }
    }
    return res;
  }
  throw lastError instanceof Error ? lastError : new Error("无法连接坚果云 WebDAV 服务");
}

function assertConfigured(config: NutstoreConfig) {
  if (!config.account || !config.password) throw new Error("未配置坚果云账号或应用密码，请到设置页填写");
}

async function throwDavError(res: Response, action: string, path: string): Promise<never> {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  let message = `坚果云 ${action}失败（${res.status}）`;
  if (res.status === 401) message = "坚果云认证失败：请确认账号与“应用密码”正确（不是登录密码）";
  else if (res.status === 403) message = "坚果云拒绝访问（403）：可能是访问频率超限或账号被临时限制，请稍后重试";
  else if (res.status === 404) message = `坚果云路径不存在：${path}`;
  else if (res.status === 507) message = "坚果云存储空间不足";
  if (text) message += `：${text}`;
  throw new Error(message);
}

/** 测试连接：对根目录做一次 Depth:0 PROPFIND。 */
export async function testNutstoreConnection(config: NutstoreConfig, remotePath = "/"): Promise<{ webdav: string }> {
  assertConfigured(config);
  const res = await davFetch(config, { method: "PROPFIND", remotePath, depth: "0" });
  if (res.status === 207 || res.status === 200) return { webdav: remoteToUrl(config, remotePath) };
  await throwDavError(res, "连接测试", remotePath);
  throw new Error("坚果云连接测试未完成");
}

/**
 * 列出远程目录（Depth:1）。
 * 坚果云单次最多返回约 750 条；达到该数量时 truncated=true，由上层决定是否继续/报错。
 */
export async function listRemoteDirectory(config: NutstoreConfig, remotePath: string): Promise<NutstoreListResult> {
  assertConfigured(config);
  const path = normalizeRemotePath(remotePath);
  const res = await davFetch(config, { method: "PROPFIND", remotePath: path, depth: "1", body: PROPFIND_BODY });
  if (res.status === 404) return { path, items: [], truncated: false };
  if (res.status === 409) {
    const body = await res.text().catch(() => "");
    if (/AncestorsNotFound|ancestors of this location does not found/i.test(body)) {
      return { path, items: [], truncated: false };
    }
    throw new Error(`坚果云读取目录失败（409）：${body.slice(0, 300) || "未知冲突"}`);
  }
  if (res.status !== 207) await throwDavError(res, "读取目录", path);
  const xml = await res.text();
  const parsed = parseMultistatus(xml);
  const items: NutstoreListEntry[] = [];
  const requested = path === "/" ? "/" : path.replace(/\/+$/, "");
  for (const item of parsed) {
    const itemPath = hrefToRemotePath(config, item.href);
    const normalizedItem = normalizeRemotePath(itemPath);
    if (normalizedItem === requested || normalizedItem === `${requested}/`) continue;
    const name = normalizedItem.split("/").filter(Boolean).pop() ?? normalizedItem;
    items.push({
      path: normalizedItem,
      name,
      type: item.isDirectory ? "folder" : "file",
      size: item.size,
      etag: item.etag,
      lastModified: item.lastModified,
    });
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
  return { path, items, truncated: items.length >= NUTSTORE_PROPFIND_LIMIT };
}

/** 读取远程文件原始字节（含元信息），文本与二进制读取共用。 */
async function downloadRemote(config: NutstoreConfig, remotePath: string): Promise<{ path: string; name: string; data: Buffer; size: number; etag?: string; lastModified?: number }> {
  assertConfigured(config);
  const path = normalizeRemotePath(remotePath);
  const res = await davFetch(config, { method: "GET", remotePath: path });
  if (res.status === 404) throw new Error(`坚果云文件不存在：${path}`);
  if (res.status === 409) {
    const body = await res.text().catch(() => "");
    if (/AncestorsNotFound|ancestors of this location does not found/i.test(body)) {
      throw new Error(`坚果云文件不存在：${path}`);
    }
    await throwDavError(res, "读取文件", path);
  }
  if (!res.ok) await throwDavError(res, "读取文件", path);
  const data = Buffer.from(await res.arrayBuffer());
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return {
    path,
    name,
    data,
    size: data.byteLength,
    etag: res.headers.get("etag") ?? undefined,
    lastModified: res.headers.get("last-modified") ? parseHttpDate(res.headers.get("last-modified") ?? undefined) : undefined,
  };
}

/** 读取远程文本文件（UTF-8）。 */
export async function readRemoteFile(config: NutstoreConfig, remotePath: string): Promise<NutstoreReadResult> {
  const { path, name, data, size, etag, lastModified } = await downloadRemote(config, remotePath);
  return { path, name, content: data.toString("utf8"), size, etag, lastModified };
}

/** 读取远程二进制文件（例如 SQLite 备份）。 */
export async function readRemoteBuffer(config: NutstoreConfig, remotePath: string): Promise<{ path: string; name: string; data: Buffer; size: number; etag?: string; lastModified?: number }> {
  return downloadRemote(config, remotePath);
}

export async function ensureRemoteDirectory(config: NutstoreConfig, remotePath: string): Promise<void> {
  assertConfigured(config);
  const normalized = normalizeRemotePath(remotePath);
  if (normalized === "/") return;
  const segments = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : `/${segment}`;
    const res = await davFetch(config, { method: "MKCOL", remotePath: current });
    if (res.status === 201 || res.status === 200 || res.status === 204 || res.status === 405) continue;
    if (res.status === 409 || res.status === 404) {
      // 父目录不存在时按顺序创建，不应出现；如出现则抛错便于排查。
      await throwDavError(res, "创建目录", current);
    }
    if (!res.ok) await throwDavError(res, "创建目录", current);
  }
}

/** 写入远程文本文件；自动补建父目录。 */
export async function writeRemoteFile(config: NutstoreConfig, remotePath: string, content: string): Promise<void> {
  await writeRemoteBuffer(config, remotePath, Buffer.from(content, "utf8"), "text/markdown; charset=utf-8");
}

/** 写入远程二进制文件；自动补建父目录。 */
export async function writeRemoteBuffer(config: NutstoreConfig, remotePath: string, data: Buffer, contentType = "application/octet-stream"): Promise<void> {
  assertConfigured(config);
  const path = normalizeRemotePath(remotePath);
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
  await ensureRemoteDirectory(config, parent);
  const res = await davFetch(config, { method: "PUT", remotePath: path, body: data, headers: { "Content-Type": contentType } });
  if (!res.ok && res.status !== 201 && res.status !== 204 && res.status !== 200) {
    await throwDavError(res, "写入文件", path);
  }
}

/** 递归列出远程目录下的 .md 文件。 */
export async function listRemoteMarkdown(config: NutstoreConfig, remotePath: string, options: { skipSpecial?: boolean } = {}): Promise<RemoteMarkdownFile[]> {
  assertConfigured(config);
  const root = normalizeRemotePath(remotePath);
  const files: RemoteMarkdownFile[] = [];
  const walk = async (dir: string) => {
    const listing = await listRemoteDirectory(config, dir);
    if (listing.truncated) {
      throw new Error(`远程目录“${dir}”单次超过 ${NUTSTORE_PROPFIND_LIMIT} 项，坚果云 WebDAV 会截断列表。为避免漏读，请先在坚果云中拆分该目录。`);
    }
    for (const item of listing.items) {
      if (item.type === "folder") {
        if (item.name.startsWith(".")) continue;
        if (options.skipSpecial && (item.name === "90-Templates" || item.name === "Attachments")) continue;
        await walk(item.path);
      } else if (item.name.toLowerCase().endsWith(".md")) {
        files.push({ path: item.path, name: item.name, size: item.size, etag: item.etag, lastModified: item.lastModified });
      }
    }
  };
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
  return files;
}

/** 读取远程目录下所有 .md 内容（用于 Obsidian 自动关联扫描）。 */
export async function scanRemoteMarkdown(config: NutstoreConfig, remotePath: string, options: { maxFiles?: number; maxFileBytes?: number } = {}): Promise<RemoteMarkdownNote[]> {
  const files = await listRemoteMarkdown(config, remotePath, { skipSpecial: true });
  const maxFiles = options.maxFiles ?? 2000;
  const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
  const notes: RemoteMarkdownNote[] = [];
  for (const file of files) {
    if (notes.length >= maxFiles) break;
    if (file.size != null && file.size > maxFileBytes) continue;
    try {
      const read = await readRemoteFile(config, file.path);
      if (!read.content.trim()) continue;
      notes.push({ ...file, content: read.content });
    } catch {
      // 单个文件读取失败不阻断整体扫描
    }
  }
  return notes;
}

/** 递归列出远程目录树（仅文件夹），用于设置页“读取目录”。若目录尚不存在，先自动创建。 */
export async function listRemoteDirectories(config: NutstoreConfig, remotePath: string, maxDepth = 3): Promise<string[]> {
  const root = normalizeRemotePath(remotePath);
  await ensureRemoteDirectory(config, root);
  const dirs: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    const listing = await listRemoteDirectory(config, dir);
    if (listing.truncated) {
      throw new Error(`远程目录“${dir}”单次超过 ${NUTSTORE_PROPFIND_LIMIT} 项，无法安全递归读取，请拆分目录后重试。`);
    }
    for (const item of listing.items) {
      if (item.type !== "folder") continue;
      if (item.name.startsWith(".")) continue;
      dirs.push(item.path);
      await walk(item.path, depth + 1);
    }
  };
  await walk(root, 0);
  dirs.sort((a, b) => a.localeCompare(b, "zh-CN"));
  return dirs;
}
