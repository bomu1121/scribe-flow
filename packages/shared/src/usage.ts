/**
 * 外部 API 的用量记账与费用折算。
 *
 * **哪些是实测、哪些是估算，这里的边界必须分清**：
 * - `promptTokens` / `completionTokens` / `cachedTokens` / `cacheWriteTokens` / `reasoningTokens`
 *   来自厂商响应的 `usage` 字段，是**实测**；厂商不返回的字段记 0，不猜。
 * - `audioSeconds` 优先用厂商报的（如 MiMo 的 `usage.seconds`），它不报时才由我们量 WAV 头兜底，也是**实测**。
 * - `billedCost` 是厂商在响应里**直接报的金额**（目前只有 OpenRouter 这类网关），同样**实测**——
 *   它不是我们算的，是对方收的。没有这一项时才退化成按单价折算。
 * - 折算出来的金额一律是**估算**：单价由用户在设置页自己填，厂商调价、走中转站加价、模型被路由到
 *   别的实际模型，都会让它和账单对不上。界面上凡是出现估算金额的地方都要写明口径。
 *
 * **为什么字段名要认这么多写法**（`usage` 归一化的依据，逐条查证过，出处见
 * `docs/research/api-usage-cost-research.md` §2.3）：
 * 缓存命中 token 在不同家位于不同位置——OpenAI / 智谱 / 火山 / 阿里 / OpenRouter 放在
 * `prompt_tokens_details.cached_tokens`，DeepSeek 放在顶层的 `prompt_cache_hit_tokens`，
 * Moonshot 两处都给。只认一种的结果是**其余家一律显示 0**，那不是"显示不出来"，
 * 是"显示了错的数"。同样地，推理 token 在 `completion_tokens_details.reasoning_tokens`，
 * 它按输出价计费，漏了就是少算。
 */

/** 一次外部 API 调用，或一个节点/一次运行累计的一批调用的用量。 */
export interface ApiUsage {
  /**
   * 调用次数。**重试失败的调用也各算一次**——钱是照花的。
   * 联网检索这类不吃 token 的调用也记进这里，所以它可能大于模型调用次数。
   */
  calls: number;
  /** 提示词 token。语音识别走 chat/completions 时，音频 token 也由厂商报在这里。 */
  promptTokens: number;
  completionTokens: number;
  /** 命中上下文缓存的提示词 token（`prompt_tokens_details.cached_tokens` 等三处写法归一）。 */
  cachedTokens: number;
  /** 显式缓存**写入**的 token（OpenAI / Moonshot / OpenRouter 报）；其它家为 0。 */
  cacheWriteTokens: number;
  /** 推理 token，**按输出价计费**（OpenAI / DeepSeek / SiliconFlow 报）；不报的为 0。 */
  reasoningTokens: number;
  /** 音频秒数：优先厂商报的（MiMo 的 `usage.seconds`），否则由我们量 WAV 头。 */
  audioSeconds: number;
  /**
   * 厂商在响应里**直接报的金额**。**有值就说明这是对方收的钱，不是我们算的**，
   * 界面必须把它和估算分开显示（见 `docs/research/api-usage-cost-research.md` §4.5）。
   * 目前只有 OpenRouter 这类网关会报；没有就是 undefined，与「报了 0」不是一回事。
   *
   * 币种不随字段回来（OpenRouter 的口径是 credits，官方没写明 credits↔USD 的换算），
   * 所以界面只说「厂商报的金额」，不擅自加货币符号。
   */
  billedCost?: number;
}

export function emptyApiUsage(): ApiUsage {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    audioSeconds: 0,
  };
}

/** 累加。`part` 允许只给一部分字段——调用点常常只知道"发生了一次调用"。 */
export function addApiUsage(total: ApiUsage, part: Partial<ApiUsage>): ApiUsage {
  const next: ApiUsage = {
    calls: total.calls + (part.calls ?? 0),
    promptTokens: total.promptTokens + (part.promptTokens ?? 0),
    completionTokens: total.completionTokens + (part.completionTokens ?? 0),
    cachedTokens: total.cachedTokens + (part.cachedTokens ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (part.cacheWriteTokens ?? 0),
    reasoningTokens: total.reasoningTokens + (part.reasoningTokens ?? 0),
    audioSeconds: total.audioSeconds + (part.audioSeconds ?? 0),
  };
  // billedCost 单独处理：undefined 是「厂商没报」，0 是「厂商报了 0」，两者不能相加成一个数。
  if (total.billedCost !== undefined || part.billedCost !== undefined) {
    next.billedCost = (total.billedCost ?? 0) + (part.billedCost ?? 0);
  }
  return next;
}

export function sumApiUsages(list: readonly ApiUsage[]): ApiUsage {
  return list.reduce<ApiUsage>((total, usage) => addApiUsage(total, usage), emptyApiUsage());
}

/** 有没有记到东西。全 0 的用量（比如纯本地节点）不该在界面上占一行。 */
export function hasApiUsage(usage: ApiUsage | undefined): usage is ApiUsage {
  if (!usage) return false;
  // 只判"独立的"那几项：缓存命中/写入是 promptTokens 的明细、推理是 completionTokens 的明细，
  // 它们非 0 时对应的大项必然也非 0，多判一遍是死逻辑。
  return (
    usage.calls > 0 ||
    usage.promptTokens > 0 ||
    usage.completionTokens > 0 ||
    usage.audioSeconds > 0 ||
    usage.billedCost !== undefined
  );
}

/** 计费口径的币种。单价按用户自己账单的币种填，估算金额跟着它走。 */
export type PriceCurrency = "CNY" | "USD";

export const PRICE_CURRENCY_SYMBOLS: Record<PriceCurrency, string> = { CNY: "元", USD: "$" };

/**
 * 用户在设置页填的模型单价。**单位一律是「每百万 token」**——各家官网的报价页都是这个口径
 * （智谱「元/百万 Tokens」、OpenAI「$10.00 / 1M tokens」、LiteLLM 表是 per-token 但要 ×1e6），
 * 用户是拿着那个页面来填的。这也是 LibreChat / Lobe Chat / Dify / Cline 共同的选择。
 *
 * 0 表示没填，界面只显示 token、不折算金额。
 */
export interface TokenPrice {
  /** 每百万输入 token 的单价。 */
  inputPerMillion: number;
  /** 每百万输出 token 的单价（推理 token 也按它算）。 */
  outputPerMillion: number;
  /**
   * 每百万**缓存命中**输入 token 的单价。**0 表示按输入价算**（即不打折）。
   *
   * 为什么单列而不是内置一个折扣倍率：缓存命中价各家不同——DeepSeek 约 0.1×、智谱官方写「通常为标准价格的 50%」、
   * 阿里 DashScope 隐式缓存 20% / 显式 10%，而「写入 ×1.25、读取 ×0.1」那套只在 Anthropic 成立。
   * 内置任何一个都是替用户编一个价。留空时按输入价算是**偏高而非偏低**，这个方向是安全的。
   */
  cachedInputPerMillion: number;
  /** 币种；只影响金额的显示与口径说明，不参与计算。 */
  currency: PriceCurrency;
}

/** 任一单价填了就算「有价」。三个都为 0 时界面不折算金额。 */
export function hasTokenPrice(price: TokenPrice): boolean {
  return price.inputPerMillion > 0 || price.outputPerMillion > 0;
}

/**
 * 按单价估算模型调用费用。**估算，不是账单**：
 *
 * ```
 * 计费输入 = promptTokens − cachedTokens − cacheWriteTokens
 * 费用 = 计费输入 × 输入价 + 缓存命中 × 缓存价 + 缓存写入 × 输入价 + 输出 × 输出价
 * ```
 *
 * 两条容易算错的地方：
 * - **缓存命中与缓存写入都是 `promptTokens` 的一部分**（OpenAI 系的口径：`prompt_tokens_details` 是明细，
 *   `prompt_tokens` 是总和），所以要从全价里**扣掉**再分别按各自的价算。不扣就会把它们算两遍——
 *   这正是 LiteLLM 的 `regular_prompt_tokens = max(prompt_tokens - cached_tokens - cache_creation_tokens, 0)`
 *   在做的事，照抄它。
 * - **推理 token 不另算**：它是 `completionTokens` 的明细（OpenAI 与 DeepSeek 都这么报），
 *   已经含在输出里、已经按输出价算过了；再加一遍就是算两遍。它只用于界面上的拆分展示。
 *
 * 缓存写入价这里按输入价算：多数家在写入时就是按输入价收，少数收得略高，取保守的那个。
 */
export function estimateChatCost(usage: ApiUsage, price: TokenPrice): number {
  const cachedPrice = price.cachedInputPerMillion > 0 ? price.cachedInputPerMillion : price.inputPerMillion;
  const billableInput = Math.max(0, usage.promptTokens - usage.cachedTokens - usage.cacheWriteTokens);
  return (
    (billableInput * price.inputPerMillion +
      usage.cachedTokens * cachedPrice +
      usage.cacheWriteTokens * price.inputPerMillion +
      usage.completionTokens * price.outputPerMillion) /
    1_000_000
  );
}

/** 语音识别按分钟计价时的估算。**估算**，理由同上。 */
export function estimateAudioCost(usage: ApiUsage, pricePerMinute: number): number {
  return (usage.audioSeconds / 60) * pricePerMinute;
}

/** token 数的紧凑显示：1234 → `1.2k`，1234567 → `1.2M`。 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/**
 * 金额显示。小额不装精确：0.0004 元写成 `0.0004 元` 只是噪声，
 * 但完全舍成 0 又会让人以为没花钱，所以给一个下限写法。
 */
export function formatMoney(amount: number, currency: PriceCurrency = "CNY"): string {
  const symbol = PRICE_CURRENCY_SYMBOLS[currency];
  const body = currency === "USD" ? `${symbol}${amount.toFixed(2)}` : `${amount.toFixed(2)} ${symbol}`;
  if (amount <= 0) return currency === "USD" ? "$0" : "0 元";
  if (amount < 0.01) return currency === "USD" ? "<$0.01" : "<0.01 元";
  return body;
}

/** 秒数的紧凑显示：95 → `1分35秒`，8 → `8秒`。 */
export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}秒`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${minutes}分` : `${minutes}分${rest}秒`;
}
