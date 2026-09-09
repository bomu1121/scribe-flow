import type { TraceExternalCheck, TraceExternalSource, TraceReport } from "@scribe-flow/shared";
import { parseTraceReport } from "@scribe-flow/shared";
import type { AiConfig } from "./ai";
import { chatCompletion } from "./ai";
import { parseJsonLoose } from "./recipe";
import type { SearchConfig } from "./settings";

interface CheckPlan {
  id: string;
  query: string;
}

interface ExternalCheckResult {
  id: string;
  status: TraceExternalCheck["status"];
  summary?: string;
  sources?: TraceExternalSource[];
  note?: string;
}

/** Tavily Search API：返回精简后的网页结果。 */
export async function tavilySearch(config: SearchConfig, query: string): Promise<TraceExternalSource[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: config.apiKey,
      query,
      max_results: config.maxResults,
      search_depth: "basic",
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily 检索失败（${res.status}）：${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (body.results ?? []).slice(0, config.maxResults).map((item) => ({
    title: item.title?.trim() || undefined,
    url: item.url?.trim() || undefined,
    snippet: item.content?.trim().slice(0, 500) || undefined,
  }));
}

function buildPlanPrompt(): string {
  return [
    "你是外部溯源规划员。用户消息是一份结构化溯源报告 JSON。",
    "你的任务：找出哪些条目需要联网核查外部出处。",
    "需要核查的典型情况：",
    "- attribution.kind === \"external\"；",
    "- claim/evidence 中明确提到某篇论文、研究、书籍、新闻、人物、机构、报告、统计数据；",
    "- 作者声称某个外部对象“提出/发现/说过/发布”了某个内容。",
    "不需要核查的情况：",
    "- 作者自己的观点、经验、推测（attribution.kind === \"self\"）；",
    "- 只是描述视频内容本身，没有指向任何可查证的外部对象。",
    "只输出 JSON，格式：",
    '{"checks":[{"id":"item-1","query":"适合 Tavily 搜索的精确查询词，尽量包含外部对象名+核心主张"}]}',
    "要求：",
    "1. checks 里只放确实需要外部核查的条目；",
    "2. query 要能直接用于搜索引擎，不要包含“是否”“真的吗”这类主观问法；",
    "3. 只输出 JSON，不要解释，不要 Markdown 围栏。",
  ].join("\n");
}

function buildComparePrompt(): string {
  return [
    "你是外部事实核查员。用户消息包含两部分：",
    "1. 原始溯源报告 JSON；",
    "2. 每个需要核查条目的联网搜索结果 JSON。",
    "请根据搜索结果判断：视频/文稿中提到的外部归因是否真实存在、是否被外部资料支持。",
    "只输出 JSON 对象，格式：",
    '{"checks":[{"id":"item-1","status":"verified","summary":"外部资料是否支持/反对/无法确认，以及关键依据","sources":[{"title":"标题","url":"链接","snippet":"摘要"}],"note":"补充说明"}]}',
    "status 枚举：",
    "- verified：外部资料能找到对应出处且支持视频中的说法；",
    "- contradicted：外部资料与该说法矛盾，或找不到该外部对象提出此内容的证据；",
    "- not_found：能检索到相关对象但没有找到它提出此内容的直接证据；",
    "- ambiguous：不同来源说法不一致或存在争议；",
    "- not_applicable：该条不需要外部核查。",
    "要求：",
    "1. 不要把搜索结果里没有的内容脑补成结论；",
    "2. 如果搜索结果与视频说法冲突，summary 要明确指出冲突点；",
    "3. sources 只放真实来自搜索结果的条目；",
    "4. 只输出 JSON，不要解释，不要 Markdown 围栏。",
  ].join("\n");
}

/**
 * 对一份溯源报告执行外部联网核查。
 * - 未配置 Tavily Key 时原样返回，不阻断普通溯源。
 * - 执行失败会抛出错误，由调用方决定是否让整个节点失败或降级。
 */
export async function enrichTraceReportWithExternalChecks(
  reportText: string,
  inputText: string,
  aiConfig: AiConfig,
  searchConfig: SearchConfig,
  signal?: AbortSignal,
): Promise<string> {
  const report = parseTraceReport(reportText);
  if (!report) return reportText;
  if (!searchConfig.apiKey) {
    const marked: TraceReport = {
      ...report,
      items: report.items.map((item) =>
        item.attribution?.kind === "external" && !item.external
          ? { ...item, external: { status: "unchecked", note: "未配置 Tavily 外部检索，无法联网核查" } }
          : item,
      ),
    };
    return JSON.stringify(marked);
  }

  // 1. 规划需要外部核查的条目
  const planRaw = await chatCompletion(aiConfig, buildPlanPrompt(), JSON.stringify(report), signal);
  const planParsed = parseJsonLoose(planRaw) as { checks?: { id?: string; query?: string }[] };
  const checks: CheckPlan[] = Array.isArray(planParsed?.checks)
    ? planParsed.checks
        .filter((item): item is { id: string; query: string } => Boolean(item.id && item.query?.trim()))
        .map((item) => ({ id: item.id, query: item.query.trim() }))
    : [];
  if (checks.length === 0) return reportText;

  // 2. 逐条联网检索
  const searchResults: Record<string, TraceExternalSource[]> = {};
  const searchErrors: string[] = [];
  for (const check of checks) {
    try {
      searchResults[check.id] = await tavilySearch(searchConfig, check.query);
    } catch (err) {
      searchResults[check.id] = [];
      searchErrors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (checks.length > 0 && searchErrors.length === checks.length) {
    throw new Error(`Tavily 检索失败：${searchErrors[0]}`);
  }

  // 3. 交给 AI 对照搜索结果做核查判断
  const compareInput = JSON.stringify({
    report,
    searchResults,
    originalTranscriptExcerpt: inputText.slice(0, 4000),
  });
  const compareRaw = await chatCompletion(aiConfig, buildComparePrompt(), compareInput, signal);
  const compareParsed = parseJsonLoose(compareRaw) as { checks?: ExternalCheckResult[] };
  const results = Array.isArray(compareParsed?.checks) ? compareParsed.checks : [];

  // 4. 合并回报告
  const enriched: TraceReport = {
    ...report,
    items: report.items.map((item) => {
      const matched = results.find((result) => result.id === item.id);
      if (!matched) return item;
      const external: TraceExternalCheck = {
        status: matched.status ?? "unchecked",
        query: checks.find((check) => check.id === item.id)?.query,
        summary: matched.summary?.trim(),
        sources: matched.sources ?? [],
        note: matched.note?.trim(),
      };
      return { ...item, external };
    }),
  };
  return JSON.stringify(enriched);
}
