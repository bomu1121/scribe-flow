import type { AiProvider } from "@scribe-flow/shared";

/**
 * 「参考价目」：从一份公开的机器可读价目表里查出某个模型的单价，供设置页**一键填入**输入框。
 *
 * ## 为什么是「填入」而不是「自动算账」
 *
 * 调研了四份公开价目源（LiteLLM 的 JSON、OpenRouter 的 `/api/v1/models`、models.dev 的 `api.json`、
 * Helicone 的成本包）。它们的价**都不等于用户实际付的价**：
 * - OpenRouter 是**转售价**（它的 `deepseek/deepseek-chat` 报 $0.257/百万，而 DeepSeek 官方当时是
 *   off-peak $0.15 / peak $0.3 —— 拿转售价去算官方 API 的账是错的）；
 * - DeepSeek 官方价**分峰谷**两档，表里只会有一个值；
 * - 智谱、Moonshot 分缓存 TTL 档，OpenAI 分 batch / priority / flex 档。
 *
 * 所以价目表的正确用法是「帮你把输入框填上，你自己确认」，之后账目仍是**用户确认过的价**算出来的。
 * 这里选 LiteLLM 那份是因为先例最多（aider 每 24h 拉一次、ccusage 构建期 pin rev 嵌入、tokencost 同源），
 * 且每条自带 `source` 字段指回官方定价页——能把溯源链一路带到界面上。
 *
 * 出处与逐项对比见 `docs/research/api-usage-cost-research.md` §3.5 / §5.3。
 */

/** LiteLLM 的价目表（社区维护，每条带 source 指回官方定价页）。 */
const PRICE_TABLE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const FETCH_TIMEOUT_MS = 20_000;
/** 进程内缓存 6 小时：这是一份 2.8MB / 4000+ 条的表，没必要每点一次就重拉。 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface PriceEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  /** 部分条目用这个别名写缓存价（Helicone/LiteLLM 两种写法都出现过）。 */
  input_cost_per_token_cache_hit?: number;
  source?: string;
}

interface PriceTable {
  entries: Map<string, PriceEntry>;
  /** 去掉 provider 前缀的最后一段 → 完整 key 列表（用来兼容 `deepseek-chat` vs `deepseek/deepseek-chat`）。 */
  aliases: Map<string, string[]>;
  fetchedAt: number;
}

let cache: PriceTable | undefined;

export interface ReferencePrice {
  /** 命中的价目表 key，原样回给界面——让用户能看见"它按哪一条填的"。 */
  matchedKey: string;
  /** 每百万 token 的**美元**价（LiteLLM 表里是 per-token，这里换算成每百万，与设置页口径一致）。 */
  inputPerMillion: number;
  outputPerMillion: number;
  /** 缓存命中输入价；表里没有这一项时为 0（界面按"留空＝按输入价算"处理）。 */
  cachedInputPerMillion: number;
  /** 价目表里这一条自带的官方定价页链接（LiteLLM 的 `source` 字段）；没有则为空。 */
  providerSource?: string;
  /** 拉了哪份表、什么时候拉的——界面上要写出来，这是第三方数据。 */
  tableUrl: string;
  fetchedAt: number;
}

/** 把 per-token 的价换算成每百万，并消掉浮点尾巴（0.0000005 × 1e6 = 0.49999999999999994）。 */
function perMillion(perToken: number | undefined): number {
  if (typeof perToken !== "number" || !Number.isFinite(perToken)) return 0;
  return Math.round(perToken * 1_000_000 * 1e6) / 1e6;
}

function buildTable(raw: Record<string, unknown>, fetchedAt: number): PriceTable {
  const entries = new Map<string, PriceEntry>();
  const aliases = new Map<string, string[]>();
  for (const [key, value] of Object.entries(raw)) {
    // `sample_spec` 是 LiteLLM 用来自描述字段含义的条目，不是模型。
    if (key === "sample_spec" || !value || typeof value !== "object") continue;
    entries.set(key, value as PriceEntry);
    const leaf = key.split("/").pop() ?? key;
    aliases.set(leaf, [...(aliases.get(leaf) ?? []), key]);
  }
  return { entries, aliases, fetchedAt };
}

async function loadTable(force = false): Promise<PriceTable> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const res = await fetch(PRICE_TABLE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`参考价目拉取失败（HTTP ${res.status}）`);
  const raw = (await res.json()) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Object.keys(raw).length < 100) {
    // 完整性下限：这份表有 4000+ 条，返回几十条说明拿到的不是它（代理拦截、GitHub 限流页等）。
    throw new Error("参考价目的内容不像完整的价目表，已放弃使用");
  }
  cache = buildTable(raw, Date.now());
  return cache;
}

/** 归一化模型名：`.` 与 `@` 都按 `-` 比，全小写。抄 ccusage 的 `normalized_pricing_key`。 */
function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().replace(/[.@]/g, "-");
}

/** 剥掉日期后缀（OpenAI 的 `-YYYY-MM-DD` 与 Anthropic 的 `-YYYYMMDD`）。抄 ccusage 的 `model_without_date_suffix`。 */
function stripDateSuffix(name: string): string {
  return name.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
}

/** 一次查找的全部候选写法，按「越像原样」排前面。 */
function candidateNames(model: string): string[] {
  const base = normalizeModelName(model);
  const withoutDate = stripDateSuffix(base);
  const leaf = base.split("/").pop() ?? base;
  const leafWithoutDate = stripDateSuffix(leaf);
  return [...new Set([base, withoutDate, leaf, leafWithoutDate])].filter(Boolean);
}

/** 同一个叶子名对应多条时，优先 provider 前缀与用户配置对得上的那条，否则取第一条。 */
function pickAlias(candidates: string[], provider: AiProvider): string | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const preferred = provider === "deepseek" ? "deepseek" : provider === "openai" ? "openai" : "";
  if (preferred) {
    const hit = candidates.find((key) => key.startsWith(`${preferred}/`));
    if (hit) return hit;
  }
  return candidates[0];
}

/**
 * 查一个模型的参考价。查不到返回 undefined（**不编一个默认价**——调研的七家项目里没有一家这么做）。
 *
 * 匹配顺序抄 ccusage（`rust/crates/ccusage-core/src/pricing.rs`）：
 * 原样 → 剥 provider 前缀 → 剥日期后缀 → 分隔符归一。**不做模糊 contains**：
 * ccusage 那边为此专门维护了一份 `exact_only` 白名单防止把带档位的模型算成基础模型价，
 * 我们这点用量不值得引那套复杂度，宁可查不到让用户自己填。
 */
export async function lookupReferencePrice(model: string, provider: AiProvider): Promise<ReferencePrice | undefined> {
  if (!model.trim()) return undefined;
  const table = await loadTable();
  for (const name of candidateNames(model)) {
    const direct = table.entries.get(name);
    const matchedKey = direct ? name : pickAlias(table.aliases.get(name) ?? [], provider);
    const entry = matchedKey ? table.entries.get(matchedKey) : undefined;
    if (!entry || !matchedKey) continue;
    const input = perMillion(entry.input_cost_per_token);
    const output = perMillion(entry.output_cost_per_token);
    if (input <= 0 && output <= 0) continue;
    return {
      matchedKey,
      inputPerMillion: input,
      outputPerMillion: output,
      cachedInputPerMillion: perMillion(entry.cache_read_input_token_cost ?? entry.input_cost_per_token_cache_hit),
      providerSource: entry.source,
      tableUrl: PRICE_TABLE_URL,
      fetchedAt: table.fetchedAt,
    };
  }
  return undefined;
}

/** 供界面显示"这份参考价是哪来的"。参数 `force` 用于"重新拉取"。 */
export async function priceTableInfo(force = false): Promise<{ tableUrl: string; fetchedAt: number; modelCount: number }> {
  const table = await loadTable(force);
  return { tableUrl: PRICE_TABLE_URL, fetchedAt: table.fetchedAt, modelCount: table.entries.size };
}
