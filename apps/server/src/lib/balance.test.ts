import { afterEach, describe, expect, it, vi } from "vitest";
import { detectBalanceProvider, fetchBalance } from "./balance";

/** 各家的响应形状取自官方文档（出见 lib/balance.ts 顶部），只缩了数字。 */
function stubJson(payload: unknown, status = 200) {
  let seenUrl = "";
  let seenAuth = "";
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    seenUrl = String(url);
    seenAuth = init?.headers?.Authorization ?? "";
    return new Response(JSON.stringify(payload), { status });
  });
  return () => ({ url: seenUrl, auth: seenAuth });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("余额对账", () => {
  it("按接口地址认渠道；认不出的渠道返回 undefined（由调用方给出说明）", () => {
    expect(detectBalanceProvider("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(detectBalanceProvider("https://api.moonshot.cn/v1")).toBe("moonshot");
    expect(detectBalanceProvider("https://openrouter.ai/api/v1")).toBe("openrouter");
    // 这几家官方没有余额接口（OpenAI/Anthropic 只有要 Admin Key 的组织级账单接口），如实说不支持。
    expect(detectBalanceProvider("https://api.openai.com/v1")).toBeUndefined();
    expect(detectBalanceProvider("https://open.bigmodel.cn/api/paas/v4")).toBeUndefined();
    expect(detectBalanceProvider("https://我的自建中转.example.com/v1")).toBeUndefined();
  });

  it("DeepSeek：打 /user/balance，带 Bearer，余额原样带出来", async () => {
    const seen = stubJson({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00" }] });
    const result = await fetchBalance("deepseek", "https://api.deepseek.com/v1", "sk-test");
    expect(seen().url).toBe("https://api.deepseek.com/v1/user/balance");
    expect(seen().auth).toBe("Bearer sk-test");
    expect(result.entries).toEqual([{ label: "账户余额", amount: "110.00", currency: "CNY" }]);
    expect(result.providerLabel).toBe("DeepSeek");
  });

  it("Moonshot：三档余额分开列", async () => {
    stubJson({ code: 0, data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 }, status: true });
    const result = await fetchBalance("moonshot", "https://api.moonshot.cn/v1", "sk-test");
    expect(result.entries.map((entry) => entry.label)).toEqual(["可用余额", "代金券余额", "现金余额"]);
    expect(result.entries[0].amount).toBe("49.58894");
  });

  it("OpenRouter：算剩余 credits，但**不加货币符号**（官方没写明 credits↔USD 的换算）", async () => {
    stubJson({ data: { total_credits: 100.5, total_usage: 25.75 } });
    const result = await fetchBalance("openrouter", "https://openrouter.ai/api/v1", "sk-or-test");
    expect(result.entries).toEqual([
      { label: "已购买 credits", amount: "100.5", currency: "credits" },
      { label: "已使用 credits", amount: "25.75", currency: "credits" },
      { label: "剩余", amount: "74.75", currency: "credits" },
    ]);
  });

  it("OpenRouter 的 baseUrl 只填到域名时也能拼对路径", async () => {
    const seen = stubJson({ data: { total_credits: 1, total_usage: 0 } });
    await fetchBalance("openrouter", "https://openrouter.ai", "sk-or-test");
    expect(seen().url).toBe("https://openrouter.ai/api/v1/credits");
  });

  it("接口报错时把上游文案带出来（OpenRouter 的 403 自己就在解释原因）", async () => {
    stubJson({ error: { code: 403, message: "Only management keys can perform this operation" } }, 403);
    await expect(fetchBalance("openrouter", "https://openrouter.ai/api/v1", "sk-普通key")).rejects.toThrow(
      /403.*Only management keys/,
    );
  });

  it("没有密钥就直接拒绝，不发请求", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(fetchBalance("deepseek", "https://api.deepseek.com/v1", "")).rejects.toThrow(/未配置密钥/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("响应里没有可用的余额字段时报错，而不是显示一个空卡片", async () => {
    stubJson({ is_available: true, balance_infos: [] });
    await expect(fetchBalance("deepseek", "https://api.deepseek.com/v1", "sk-test")).rejects.toThrow(/没有返回可用的余额字段/);
  });
});
