/**
 * 「余额对账」：查一次账户余额，与本地累计估算并排显示，回答「我们估的准不准」。
 *
 * ## 它能回答什么、不能回答什么
 *
 * **能**：这个月账上少了多少 vs 本地估了多少，差多少。这是估算准确度唯一的**外部证据**。
 * **不能**：分摊到某一次运行——余额是**账户级**的粒度，没有按请求/按时间点的分解。
 * 所以它只做对账，不做摊销（这一点写进了界面文案，避免被当成"每次运行的账单"）。
 *
 * ## 哪几家有
 *
 * 逐条查证过（出见 `docs/research/api-usage-cost-research.md` §3.3）：
 * - **DeepSeek** `GET /user/balance`，API Key 即可；
 * - **Moonshot** `GET /v1/users/me/balance`，API Key 即可；
 * - **OpenRouter** `GET /api/v1/credits`，**必须 management key**（普通 key 会 403）；
 * - **OpenAI / Anthropic** 只有组织级账单接口，要 **Admin Key**（普通 key 不行），本工具不碰；
 * - **智谱**官方明确**没有**余额接口（官方 FAQ 只讲网页上的「财务总览」），社区逆向的内部接口不碰。
 */

export type BalanceProvider = "deepseek" | "moonshot" | "openrouter";

export interface BalanceEntry {
  label: string;
  /** 原样来自厂商的字符串（不同家给的是字符串而不是数字，别自作主张转精度）。 */
  amount: string;
  currency: string;
}

export interface BalanceResult {
  provider: BalanceProvider;
  providerLabel: string;
  entries: BalanceEntry[];
  fetchedAt: number;
}

const PROVIDER_LABELS: Record<BalanceProvider, string> = {
  deepseek: "DeepSeek",
  moonshot: "Moonshot / Kimi",
  openrouter: "OpenRouter",
};

/** 按接口地址认渠道。认不出来就返回 undefined，由调用方给出「这个渠道不支持余额查询」的说明。 */
export function detectBalanceProvider(baseUrl: string): BalanceProvider | undefined {
  const host = baseUrl.trim().toLowerCase();
  if (host.includes("deepseek.com")) return "deepseek";
  if (host.includes("moonshot.cn") || host.includes("moonshot.ai") || host.includes("kimi.com")) return "moonshot";
  if (host.includes("openrouter.ai")) return "openrouter";
  return undefined;
}

const TIMEOUT_MS = 12_000;

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // OpenRouter 的 403 文案本身就在解释原因（"Only management keys can perform this operation"），
    // 原样带出去比我们转述有用。
    throw new Error(`余额接口返回 ${res.status}${text ? `：${text.slice(0, 200)}` : ""}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("余额接口没有返回 JSON");
  }
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * 查余额。`apiKey` 是设置页里那一把——**服务端用它发出去、不回传给前端**（与其它密钥一致）。
 * 渠道不支持时抛错，由路由转成界面上的说明。
 */
export async function fetchBalance(provider: BalanceProvider, baseUrl: string, apiKey: string): Promise<BalanceResult> {
  if (!apiKey) throw new Error("未配置密钥，无法查询余额");
  const root = baseUrl.trim().replace(/\/+$/, "");
  const fetchedAt = Date.now();

  if (provider === "deepseek") {
    const body = await getJson(`${root}/user/balance`, { Authorization: `Bearer ${apiKey}` });
    const infos = Array.isArray(body.balance_infos) ? (body.balance_infos as Record<string, unknown>[]) : [];
    const entries = infos
      .map((info) => ({
        label: str(info.currency) === "CNY" ? "账户余额" : `账户余额（${str(info.currency)}）`,
        amount: str(info.total_balance),
        currency: str(info.currency),
      }))
      .filter((entry) => entry.amount !== "");
    if (entries.length === 0) throw new Error("余额接口没有返回可用的余额字段");
    return { provider, providerLabel: PROVIDER_LABELS[provider], entries, fetchedAt };
  }

  if (provider === "moonshot") {
    const body = await getJson(`${root}/users/me/balance`, { Authorization: `Bearer ${apiKey}` });
    const data = (body.data ?? {}) as Record<string, unknown>;
    const entries: BalanceEntry[] = [
      { label: "可用余额", amount: str(data.available_balance), currency: "CNY" },
      { label: "代金券余额", amount: str(data.voucher_balance), currency: "CNY" },
      { label: "现金余额", amount: str(data.cash_balance), currency: "CNY" },
    ].filter((entry) => entry.amount !== "");
    if (entries.length === 0) throw new Error("余额接口没有返回可用的余额字段");
    return { provider, providerLabel: PROVIDER_LABELS[provider], entries, fetchedAt };
  }

  // OpenRouter 的 credits 接口在 /api/v1 下，而设置页里填的 baseUrl 通常已经带了 /api/v1。
  const creditsRoot = root.endsWith("/api/v1") ? root : `${root.replace(/\/api\/v1$/, "")}/api/v1`;
  const body = await getJson(`${creditsRoot}/credits`, { Authorization: `Bearer ${apiKey}` });
  const data = (body.data ?? {}) as Record<string, unknown>;
  const total = Number(data.total_credits);
  const used = Number(data.total_usage);
  const entries: BalanceEntry[] = [];
  if (Number.isFinite(total)) entries.push({ label: "已购买 credits", amount: String(total), currency: "credits" });
  if (Number.isFinite(used)) entries.push({ label: "已使用 credits", amount: String(used), currency: "credits" });
  if (Number.isFinite(total) && Number.isFinite(used)) {
    // 官方文档没写明 credits↔USD 的换算，所以这里只做减法，不加货币符号。
    entries.push({ label: "剩余", amount: String(Math.round((total - used) * 1e6) / 1e6), currency: "credits" });
  }
  if (entries.length === 0) throw new Error("余额接口没有返回可用的余额字段");
  return { provider, providerLabel: PROVIDER_LABELS[provider], entries, fetchedAt };
}
