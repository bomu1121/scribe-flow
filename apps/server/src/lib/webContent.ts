/**
 * 抓网页正文：把「检索到一条来源」变成「拿到这一页的正文」。
 *
 * 为什么必须有它：检索接口只给 `snippet`（搜索引擎自己截的摘要）。摘要既可能断章取义，
 * 也可能来自转述文章——只靠摘要，溯源报告只能说「网上有类似说法」，说不出「这句话出自哪个页面的哪一段」。
 * 有了正文，才谈得上「引文逐字命中」这条机械约束（见 verifyQuote）。
 *
 * 抽取顺序（与 Cherry Studio 的 `fetchUrls` 能力同一套思路）：
 *   1. 站点选择器——已知站点的正文在自己特有的容器里（微信公众号在 `#js_content`，实测通用算法只抽出 25-45 字，
 *      换选择器拿到 717-1037 字）；
 *   2. 通用算法——`@mozilla/readability`（Cherry 用它，许可 Apache-2.0）；
 *   3. 三方兜底——`r.jinaai.cn`（境内镜像，**无需 key**；实测它抓到了本机直连 403 的知乎问题页）。
 *      境外站 `r.jina.ai` 在本机稳定 21s 超时，所以镜像优先。
 *
 * 抓不到不算失败：`ok:false` 会照实写进报告（`fetched:false`），不假装取到了正文。
 */
import { isBlockedFetchTarget } from "./url-guard";

/**
 * 解析 HTML 需要的两个依赖**按需加载**，不在模块顶层 import。
 *
 * 理由是加载开销：`require("jsdom")` 实测 534 ms，而 `traceExternal` 是引擎的静态依赖——
 * 顶层 import 会让每一个导入引擎的模块（服务启动路径、13 个测试文件）都先付这笔钱，
 * 而真正需要 DOM 的只有「抓一页正文」这一条路径。
 *
 * 注意：这不解决并行跑测试时的 V8 崩溃——实测把相关测试文件移开、以及限制 worker 数到 2
 * 之前，默认并行度的崩溃依旧，原因不在这个模块（见 CHANGELOG 的 2026-10-15 记录）。
 */
type DomLibs = { JSDOM: typeof import("jsdom").JSDOM; Readability: typeof import("@mozilla/readability").Readability };
let domLibs: Promise<DomLibs> | null = null;

function loadDomLibs(): Promise<DomLibs> {
  domLibs ??= (async () => {
    const [{ JSDOM, VirtualConsole }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
    // jsdom 默认把页面里的 CSS 解析错误与脚本异常直接打到进程 stdout。服务是长跑进程，
    // 一个样式写得随意的页面就能刷出几百行噪音（实测抓到过整段 CSS），
    // 所以给一个静默的 virtual console：解析失败的样式不影响我们取正文。
    silentConsole = new VirtualConsole();
    return { JSDOM, Readability };
  })();
  return domLibs;
}

/** 与 `domLibs` 一起初始化；`loadDomLibs()` 完成后才可用。 */
let silentConsole: InstanceType<typeof import("jsdom").VirtualConsole> | null = null;

/** 抓取结果。`ok:false` 时 `text` 为空，`error` 写清原因。 */
export interface FetchedPage {
  url: string;
  ok: boolean;
  /** 正文纯文本（已归一空白）；`ok:false` 时为空串。 */
  text: string;
  title?: string;
  /** 正文从哪里来，便于在报告与日志里说清可信度。 */
  via: "selector" | "readability" | "jina" | "none";
  error?: string;
}

export type PageFetcher = (url: string, signal?: AbortSignal) => Promise<FetchedPage>;

/** 浏览器 UA：不少站点对空 UA 直接 403，这是最基本的门槛，不是伪装。 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 15_000;
/** 正文入库上限：够长到能覆盖要引的那句，又不至于把整篇书塞进内存与报告。 */
const CONTENT_MAX = 60_000;
/**
 * 低于这个长度就认为没抓到正文。
 *
 * 取 120 是按实测的「废页」长度定的：百度安全验证 0 字、知乎未登录 35 字、
 * 微信验证墙 86 字（「当前环境异常，完成验证后即可继续访问」）——都在这条线以下。
 * 阈值故意偏高：**宁可把「短但有正文」的页面判成没抓到，也不能把验证墙当成正文引出来**
 * （把拦截页当来源引用，比说「没取到正文」危险得多）。代价是极短的公告/条文页会被漏掉。
 */
const MIN_USABLE = 120;

/**
 * Readability 的 `charThreshold` 默认是 **500**：正文短于它就直接返回 null。
 *
 * 对溯源这是错的——政府公告、标准条文、词条定义常常就一两百字，而它们恰恰是最该被引用的权威来源。
 * 这里降到与 `MIN_USABLE` 同一量级，让「短但有正文」的页面也能被抽出来。
 */
const READABILITY_OPTIONS = { charThreshold: 200 } as const;
/** Jina 走第三方，给它更短的超时：它是兜底，不值得让整轮核查等它。 */
const JINA_TIMEOUT_MS = 20_000;

/**
 * 单请求超时与调用方取消**都要生效**。
 *
 * 写成 `signal ?? AbortSignal.timeout(ms)` 是错的：调用方（引擎）传了运行级 signal 时，
 * 单页超时会被整个关掉，慢站点就把抓取拖到运行结束为止。与 `lib/ai.ts` 的 `withTimeout` 同款。
 */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/**
 * 已知站点的正文容器。命中即优先用选择器，抽不到再退回通用算法。
 * 微信那条是实测结论（3 个样本一致：通用算法 25/40/45 字 → 选择器 717/1037/781 字）。
 */
const SITE_SELECTORS: { match: RegExp; selector: string; note: string }[] = [
  { match: /(^|\.)mp\.weixin\.qq\.com$/i, selector: "#js_content", note: "微信公众号正文容器" },
  { match: /(^|\.)zhihu\.com$/i, selector: ".RichContent-inner, .Post-RichTextContainer, .QuestionAnswer-content", note: "知乎回答/文章正文" },
  { match: /(^|\.)bilibili\.com$/i, selector: ".desc-info-text, .basic-desc-info, .article-holder, #read-article-holder", note: "B 站简介与专栏正文" },
];

/** 三方兜底正文抽取服务的境内镜像（无需 key）。境外站 `r.jina.ai` 在本机实测稳定超时，所以镜像在前。 */
const JINA_READER_HOSTS = ["https://r.jinaai.cn", "https://r.jina.ai"];

export interface ReadableFetchOptions {
  /**
   * 三方兜底主机。传空数组即完全禁用兜底——离线环境与测试用，
   * 否则一次抓取失败会变成一次真实的跨境请求。
   */
  fallbackHosts?: string[];
  /**
   * 放行私网/回环目标。**只有测试会打开**：桩服务只能监听 127.0.0.1，
   * 不开这个开关就没法测 HTTP 层（抓取结果来自检索接口这一第三方数据，生产环境必须拦）。
   */
  allowPrivateNetwork?: boolean;
  /** 单请求超时（毫秒），直连与三方兜底各自计时。默认 15 s / 20 s；测试用短值。 */
  timeoutMs?: number;
}

/** 合并空白；网页正文里的换行/缩进对「逐字命中」没有意义，反而会让同一句话对不上。 */
export function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u200b\ufeff]+/g, " ").trim();
}

/**
 * 逐字比对用的归一化：去空白 + 去零宽字符 + NFKC。
 *
 * NFKC 让全角/半角、全角括号与连字归一（网页排版常混用），否则「（2024）」与「(2024)」
 * 会被判成不同——那不是引文错，是排版差异。
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s\u200b\ufeff]+/g, "")
    .toLowerCase();
}

/** 引文短于这个长度不予校验：太短的片段几乎必然能在任意长文里命中，等于没有约束。 */
const MIN_QUOTE_CHARS = 6;

/** 省略号切分：模型常把中间省略的部分用 `…` 接起来，逐段校验才能既接受它、又不放过拼接。 */
const ELLIPSIS_RE = /\s*(?:\.{3,}|…+)\s*/;

/**
 * 把引文切成若干连续片段并逐字校验。**任一片段命不中，整条引文作废。**
 *
 * 返回通过校验后的规范形式（各片段用 `…` 接回），失败返回 null。
 * 这是溯源不捏造的机械保证：模型写的引文要么在这一页的正文里真实存在，要么不许出现在报告里。
 */
export function verifyQuote(quote: string, content: string): string | null {
  const raw = collapseWhitespace(quote);
  if (!raw) return null;
  const fragments = raw
    .split(ELLIPSIS_RE)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  if (fragments.length === 0) return null;
  const haystack = normalizeForMatch(content);
  for (const fragment of fragments) {
    if (normalizeForMatch(fragment).length < MIN_QUOTE_CHARS) return null;
    if (!haystack.includes(normalizeForMatch(fragment))) return null;
  }
  return fragments.join(" … ");
}

/**
 * 从正文里挑一段最相关的窗口给模型看（不是给用户看）。
 *
 * 为什么不直接把正文前 N 字给模型：权威页（政府/学术）往往是长文，关键数据常在中后段，
 * 头部截断会把要引的那句切掉。这里按「与主张/检索词的字面重合度」挑段落窗口，
 * 是纯机械打分、可复现，不额外调模型。
 */
export function pickExcerpt(text: string, terms: string[], budget: number): string {
  const normalized = collapseWhitespace(text);
  if (normalized.length <= budget) return normalized;
  const paragraphs = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return normalized.slice(0, budget);

  const grams = new Set<string>();
  for (const term of terms) {
    const chars = normalizeForMatch(term);
    for (let size = 3; size >= 2; size--) {
      for (let i = 0; i + size <= chars.length; i++) grams.add(chars.slice(i, i + size));
    }
  }

  let bestIndex = 0;
  let bestScore = -1;
  paragraphs.forEach((paragraph, index) => {
    const haystack = normalizeForMatch(paragraph);
    let score = 0;
    for (const gram of grams) if (haystack.includes(gram)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  // 命中段落为中心向两侧撑到预算，保证上下文连续而不是碎片拼接。
  const picked: string[] = [paragraphs[bestIndex]];
  let used = picked[0].length;
  for (let offset = 1; used < budget && (bestIndex - offset >= 0 || bestIndex + offset < paragraphs.length); offset++) {
    const after = paragraphs[bestIndex + offset];
    if (after && used + after.length <= budget) {
      picked.push(after);
      used += after.length;
    }
    const before = paragraphs[bestIndex - offset];
    if (before && used + before.length <= budget) {
      picked.unshift(before);
      used += before.length;
    }
  }
  const window = picked.join("\n");
  return window.length > budget ? window.slice(0, budget) : window;
}

/** 该 URL 是否有专门的选择器。 */
export function selectorFor(url: string): { selector: string; note: string } | null {
  const host = safeHost(url);
  if (!host) return null;
  return SITE_SELECTORS.find((entry) => entry.match.test(host)) ?? null;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 从 HTML 里抽出正文纯文本：站点选择器优先，通用算法兜底。
 *
 * 单独导出是为了能被直接测到——选择器表按域名匹配，而测试里的桩服务只能在 127.0.0.1 上，
 * 不导出的话「微信正文走选择器」这条只能靠真连微信来验，那既不快也不稳。
 */
export async function extractReadable(html: string, url: string): Promise<{ text: string; title?: string; via: FetchedPage["via"] } | null> {
  const { JSDOM, Readability } = await loadDomLibs();
  const dom = new JSDOM(html, { url, virtualConsole: silentConsole ?? undefined });
  const document = dom.window.document;
  const pageTitle = collapseWhitespace(document.title ?? "").slice(0, 120) || undefined;

  const site = selectorFor(url);
  if (site) {
    const node = document.querySelector(site.selector);
    const text = collapseWhitespace(node?.textContent ?? "");
    if (text.length >= MIN_USABLE) return { text, title: pageTitle, via: "selector" };
  }

  const article = new Readability(document, READABILITY_OPTIONS).parse();
  const text = collapseWhitespace(article?.textContent ?? "");
  if (text.length >= MIN_USABLE) {
    return { text, title: collapseWhitespace(article?.title ?? "") || pageTitle, via: "readability" };
  }
  return null;
}

/** 直连抓取：站点选择器 → readability。 */
async function fetchDirect(url: string, signal?: AbortSignal, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchedPage> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: withTimeout(signal, timeoutMs),
  });
  if (!res.ok) return { url, ok: false, text: "", via: "none", error: `HTTP ${res.status}` };
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
    return { url, ok: false, text: "", via: "none", error: `非网页内容（${contentType || "未知类型"}）` };
  }
  const html = await res.text();
  const extracted = await extractReadable(html, url);
  if (!extracted) return { url, ok: false, text: "", via: "none", error: "未能从页面里抽出正文" };
  return { url, ok: true, text: extracted.text.slice(0, CONTENT_MAX), title: extracted.title, via: extracted.via };
}

/** 三方兜底：Jina Reader。境外站先试境内镜像，失败再试全球站。 */
async function fetchViaJina(url: string, hosts: string[], signal?: AbortSignal, timeoutMs = JINA_TIMEOUT_MS): Promise<FetchedPage> {
  const errors: string[] = [];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/${url}`, {
        headers: { Accept: "application/json", "X-Retain-Images": "none" },
        signal: withTimeout(signal, timeoutMs),
      });
      if (!res.ok) {
        errors.push(`${host} HTTP ${res.status}`);
        continue;
      }
      const payload = (await res.json()) as { data?: { content?: string; title?: string }; content?: string; title?: string };
      const data = payload.data ?? payload;
      const text = collapseWhitespace(data.content ?? "");
      if (text.length >= MIN_USABLE) {
        return { url, ok: true, text: text.slice(0, CONTENT_MAX), title: collapseWhitespace(data.title ?? "").slice(0, 120) || undefined, via: "jina" };
      }
      errors.push(`${host} 未返回可用正文`);
    } catch (err) {
      errors.push(`${host} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { url, ok: false, text: "", via: "none", error: errors.join("；") || "未启用三方兜底" };
}

/**
 * 抓一页正文。直连失败才走三方兜底——第三方会看到用户检索到的 URL，
 * 能直连就别把 URL 递出去（`url-guard` 只管私网，这里的顺序是隐私上的取舍）。
 */
export async function fetchReadablePage(
  url: string,
  signal?: AbortSignal,
  options: ReadableFetchOptions = {},
): Promise<FetchedPage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, ok: false, text: "", via: "none", error: "非法链接" };
  }
  // SSRF 防线：这些 URL 来自检索接口（第三方数据），不能让服务端代取内网目标。
  if (!options.allowPrivateNetwork && isBlockedFetchTarget(parsed)) {
    return { url, ok: false, text: "", via: "none", error: "目标是私网/回环地址，已拦截" };
  }

  const fallbackHosts = options.fallbackHosts ?? JINA_READER_HOSTS;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  try {
    const direct = await fetchDirect(url, signal, timeoutMs);
    if (direct.ok) return direct;
    const viaJina = await fetchViaJina(url, fallbackHosts, signal, options.timeoutMs ?? JINA_TIMEOUT_MS);
    if (viaJina.ok) return viaJina;
    return { url, ok: false, text: "", via: "none", error: [direct.error, viaJina.error].filter(Boolean).join("；") };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // 直连本身抛错（超时/DNS/连接被拒）时也给兜底一次机会：阻断形态的站点正是靠这个救回来。
    const viaJina = await fetchViaJina(url, fallbackHosts, signal, options.timeoutMs ?? JINA_TIMEOUT_MS);
    if (viaJina.ok) return viaJina;
    return { url, ok: false, text: "", via: "none", error: `${reason}；${viaJina.error ?? ""}` };
  }
}

/**
 * 一轮抓取内的正文缓存（按 URL）。
 *
 * 同一页常被多条主张命中（一次核查里重复抓同一页既慢又给对方添流量），
 * 缓存按「轮」而不是全局：进程常驻服务，全局缓存会让很久以前的正文永远不更新。
 *
 * `has` 供调用方判断「这次是不是新页面」——抓取预算是按新页面算的，复用不该吃预算。
 */
export function createPageCache(fetcher: PageFetcher) {
  const cache = new Map<string, Promise<FetchedPage>>();
  return {
    has: (url: string): boolean => cache.has(url.trim()),
    size: (): number => cache.size,
    get: (url: string, signal?: AbortSignal): Promise<FetchedPage> => {
      const key = url.trim();
      const hit = cache.get(key);
      if (hit) return hit;
      const pending = fetcher(key, signal).catch((err): FetchedPage => ({
        url: key,
        ok: false,
        text: "",
        via: "none",
        error: err instanceof Error ? err.message : String(err),
      }));
      cache.set(key, pending);
      return pending;
    },
  };
}
