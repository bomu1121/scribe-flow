import type { TraceExternalSource, TraceSourceAuthority } from "@scribe-flow/shared";

/**
 * 来源权威度判定。
 *
 * 检索接口的排序服务于「相关度」，不服务于「可信度」：实测同一批结果里既有权威机构页，
 * 也有 CSDN / 搜狐号 / 文库这类自媒体与聚合站，而且自媒体常常排得更前。溯源要回答的是
 * 「有没有权威出处」，所以这里按域名给来源分档，再按档位重排。
 *
 * 这是一份启发式清单，不是完备分类：命名分档（gov/edu/ac）优先于主机名清单，清单只覆盖
 * 常见来源；判不出来的一律给 unknown，由上层按「未判定」处理，不假装它是权威。
 */

/** 命名分档：政府、军队、学术机构域名。 */
const AUTHORITATIVE_SUFFIXES = [".gov.cn", ".gov", ".edu.cn", ".edu", ".ac.cn", ".ac.uk", ".ac.jp", ".mil", ".go.jp", ".gov.uk"];

/** 权威来源：学术出版、国际组织、官方统计与主流官方媒体。 */
const AUTHORITATIVE_HOSTS = new Set([
  // 学术出版与预印本
  "arxiv.org",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "link.springer.com",
  "wiley.com",
  "ieee.org",
  "acm.org",
  "aps.org",
  "iop.org",
  "jstor.org",
  "cell.com",
  "thelancet.com",
  "bmj.com",
  "nejm.org",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "cnki.net",
  "wanfangdata.com.cn",
  "cqvip.com",
  "cas.cn",
  "cae.cn",
  // 国际组织与官方机构
  "who.int",
  "un.org",
  "worldbank.org",
  "imf.org",
  "oecd.org",
  "nobelprize.org",
  "nasa.gov",
  "noaa.gov",
  "cdc.gov",
  "nih.gov",
  // 官方媒体与权威财经
  "xinhuanet.com",
  "news.cn",
  "people.com.cn",
  "cctv.com",
  "chinadaily.com.cn",
  "chinanews.com.cn",
  "gmw.cn",
  "thepaper.cn",
  "caixin.com",
  "yicai.com",
  "stcn.com",
  "bjnews.com.cn",
]);

/** 参考级：百科、标准与规范、官方项目文档。 */
const REFERENCE_HOSTS = new Set([
  "wikipedia.org",
  "wikimedia.org",
  "britannica.com",
  "baike.baidu.com",
  "w3.org",
  "ietf.org",
  "rfc-editor.org",
  "iso.org",
  "developer.mozilla.org",
  "docs.python.org",
  "nodejs.org",
  "kernel.org",
  "apache.org",
  "github.com",
  "gitlab.com",
  "stackoverflow.com",
]);

/** 自媒体与聚合站：UGC 内容农场、问答、文库、号类平台。 */
const SELF_MEDIA_HOSTS = new Set([
  "csdn.net",
  "wenku.csdn.net",
  "blog.csdn.net",
  "cnblogs.com",
  "jianshu.com",
  "zhihu.com",
  "zhuanlan.zhihu.com",
  "sohu.com",
  "baijiahao.baidu.com",
  "mp.weixin.qq.com",
  "weixin.qq.com",
  "toutiao.com",
  "163.com",
  "126.com",
  "sina.com.cn",
  "qq.com",
  "51cto.com",
  "juejin.cn",
  "segmentfault.com",
  "oschina.net",
  "cloud.tencent.com",
  "developer.aliyun.com",
  "developer.huaweicloud.com",
  "bilibili.com",
  "douyin.com",
  "xiaohongshu.com",
  "52pojie.cn",
  "zhidao.baidu.com",
  "wenku.baidu.com",
  "tieba.baidu.com",
  "docin.com",
  "book118.com",
  "360doc.com",
  "doc88.com",
]);

/** 档位排序：数字越小越优先。 */
const AUTHORITY_ORDER: TraceSourceAuthority[] = ["authoritative", "reference", "self-media", "unknown"];

/** 站点名（检索接口的 media 字段）里的权威媒体与知名平台，用于拿不到域名时兜底判定。 */
const AUTHORITATIVE_PUBLISHERS = [
  "人民网",
  "新华网",
  "新华社",
  "央视",
  "央视新闻",
  "中国政府网",
  "光明网",
  "中国新闻网",
  "中国日报",
  "经济日报",
  "澎湃",
  "财新",
  "第一财经",
  "环球时报",
  "证券时报",
  "上海证券报",
  "中国证券报",
  "第一财经日报",
];

const REFERENCE_PUBLISHERS = ["维基百科", "百度百科", "MBA智库", "国家统计局"];

const SELF_MEDIA_PUBLISHERS = [
  "csdn",
  "csdn博客",
  "知乎",
  "简书",
  "搜狐",
  "网易",
  "腾讯",
  "百家号",
  "头条",
  "b站",
  "哔哩哔哩",
  "掘金",
  "博客园",
  "51cto",
  "微博",
  "小红书",
  "东方财富",
  "同花顺",
  "jrj.com.cn",
  "金融界",
  "东方资讯",
];

/** 每个主机/站点最多保留几条，避免同一站点的多条结果挤掉其它来源。 */
const MAX_PER_HOST = 2;

/** 解析 URL；非法或非 http(s) 的返回 null。 */
export function parseSourceUrl(url?: string): URL | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 按站点名兜底判档：检索接口有时不返回域名，只给一个站点名。 */
function authorityOfPublisher(publisher: string): TraceSourceAuthority | undefined {
  const name = publisher.trim().toLowerCase();
  if (!name) return undefined;
  if (AUTHORITATIVE_PUBLISHERS.some((candidate) => name.includes(candidate.toLowerCase()))) return "authoritative";
  if (REFERENCE_PUBLISHERS.some((candidate) => name.includes(candidate.toLowerCase()))) return "reference";
  if (SELF_MEDIA_PUBLISHERS.some((candidate) => name.includes(candidate.toLowerCase()))) return "self-media";
  return undefined;
}

/**
 * 按域名判定来源权威度；域名缺失时退回站点名，两者都判不出来给 unknown。
 *
 * 检索接口对相当一部分查询会返回「只有标题+正文、没有域名也没有站点名」的结果，
 * 这种情况下我们不假装它是权威，也不因为它没链接就丢掉（丢掉会把整池清空，
 * 进而把「拿不到链接」误报成「没有出处」）。
 */
export function authorityOf(url?: string, publisher?: string): TraceSourceAuthority {
  const parsed = parseSourceUrl(url);
  if (parsed) {
    const host = parsed.hostname.toLowerCase();
    if (AUTHORITATIVE_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) return "authoritative";
    if (matchesHost(host, AUTHORITATIVE_HOSTS)) return "authoritative";
    if (matchesHost(host, REFERENCE_HOSTS)) return "reference";
    if (matchesHost(host, SELF_MEDIA_HOSTS)) return "self-media";
    return "unknown";
  }
  return authorityOfPublisher(publisher ?? "") ?? "unknown";
}

/** 主机清单命中：既匹配主域，也匹配其子域（`blog.csdn.net` 命中 `csdn.net`）。 */
function matchesHost(host: string, hosts: Set<string>): boolean {
  if (hosts.has(host)) return true;
  for (const candidate of hosts) {
    if (host.endsWith(`.${candidate}`)) return true;
  }
  return false;
}

/** 去重与回查用的归一化键：忽略协议、www、末尾斜杠与锚点。 */
export function normalizeSourceUrl(url: string): string {
  const parsed = parseSourceUrl(url);
  if (!parsed) return url.trim();
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${host}${path}${parsed.search}`;
}

export interface RankedSources {
  /** 按「权威档位优先、档内保持检索相关度序」选出的来源，已标注 authority。 */
  selected: TraceExternalSource[];
  /** 候选池（去重后的全部可用来源）里各档位的数量。 */
  counts: Partial<Record<TraceSourceAuthority, number>>;
}

/**
 * 对候选来源去重、分档、重排后取前 `limit` 条。
 *
 * 无链接的结果**保留**：检索接口对相当一部分查询只返回标题+正文（没有域名、没有站点名），
 * 全丢掉会把候选池清空，进而把「拿不到链接」误报成「找不到外部出处」——那是在撒谎。
 * 这类来源一律判为 unknown 档，报告里也会标出「无链接」。
 * 同一站点（有域名按域名、没有按站点名）最多 MAX_PER_HOST 条。
 */
export function rankSources(sources: TraceExternalSource[], limit: number): RankedSources {
  const seen = new Set<string>();
  const deduped: { source: TraceExternalSource; authority: TraceSourceAuthority; index: number }[] = [];

  sources.forEach((source, index) => {
    const key = sourceKey(source);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push({ source, authority: authorityOf(source.url, source.publisher), index });
  });

  const counts: Partial<Record<TraceSourceAuthority, number>> = {};
  for (const entry of deduped) {
    counts[entry.authority] = (counts[entry.authority] ?? 0) + 1;
  }

  const ordered = [...deduped].sort((a, b) => {
    const tier = AUTHORITY_ORDER.indexOf(a.authority) - AUTHORITY_ORDER.indexOf(b.authority);
    return tier !== 0 ? tier : a.index - b.index;
  });

  const perHost = new Map<string, number>();
  const selected: TraceExternalSource[] = [];
  for (const entry of ordered) {
    if (selected.length >= limit) break;
    // 有域名按域名配额；没有域名的按站点名配额；两者都没有的按「无来源站点」共用一个配额，
    // 避免一堆无链接标题把名额占满。
    const host = parseSourceUrl(entry.source.url)?.hostname.toLowerCase() || entry.source.publisher?.trim().toLowerCase() || "（未标注站点）";
    const used = perHost.get(host) ?? 0;
    if (used >= MAX_PER_HOST) continue;
    perHost.set(host, used + 1);
    selected.push({ ...entry.source, authority: entry.authority });
  }

  return { selected, counts };
}

/** 去重键：有域名用归一化链接；没有域名退回「站点名 + 标题」。 */
function sourceKey(source: TraceExternalSource): string {
  if (parseSourceUrl(source.url)) return normalizeSourceUrl(source.url as string);
  const title = source.title?.trim();
  if (!title) return "";
  return `${source.publisher?.trim() ?? ""}|${title}`;
}
