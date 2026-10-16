import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 参考价目的匹配逻辑。**这份表的字段名与量级都取自真实表**（2026-10-16 抓：
 * 2.87MB / 4180 条，`input_cost_per_token` 是 per-token 的美元数）。
 *
 * 每个用例都重新 import 模块：表缓存在模块级变量里，不重置的话第二个用例会拿到第一个用例的表。
 */

/** 造一份条目数够多的假表（实现里有"少于 100 条就当拿错了"的完整性下限）。 */
function makeTable(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const filler: Record<string, unknown> = {};
  for (let i = 0; i < 120; i += 1) {
    filler[`filler-model-${i}`] = { input_cost_per_token: 1e-7, output_cost_per_token: 2e-7 };
  }
  return { sample_spec: { note: "不是模型" }, ...filler, ...extra };
}

async function loadWith(table: Record<string, unknown> | (() => Response)) {
  vi.resetModules();
  vi.stubGlobal("fetch", async () => (typeof table === "function" ? table() : new Response(JSON.stringify(table), { status: 200 })));
  return import("./price-lookup");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("参考价目：模型名匹配", () => {
  it("原样命中，并把 per-token 换算成每百万", async () => {
    const mod = await loadWith(
      makeTable({
        "deepseek-chat": {
          input_cost_per_token: 2.8e-7,
          output_cost_per_token: 4.2e-7,
          cache_read_input_token_cost: 2.8e-8,
          source: "https://api-docs.deepseek.com/quick_start/pricing",
        },
      }),
    );
    const hit = await mod.lookupReferencePrice("deepseek-chat", "deepseek");
    expect(hit?.matchedKey).toBe("deepseek-chat");
    // 2.8e-7 × 1e6 = 0.28，浮点尾巴要消掉（直接乘会得到 0.27999999999999997）
    expect(hit?.inputPerMillion).toBe(0.28);
    expect(hit?.outputPerMillion).toBe(0.42);
    expect(hit?.cachedInputPerMillion).toBe(0.028);
    expect(hit?.providerSource).toContain("api-docs.deepseek.com");
  });

  it("表里带 provider 前缀（deepseek/deepseek-chat）时，用裸模型名也能查到", async () => {
    const mod = await loadWith(
      makeTable({ "deepseek/deepseek-chat": { input_cost_per_token: 2.8e-7, output_cost_per_token: 4.2e-7 } }),
    );
    const hit = await mod.lookupReferencePrice("deepseek-chat", "deepseek");
    expect(hit?.matchedKey).toBe("deepseek/deepseek-chat");
    expect(hit?.inputPerMillion).toBe(0.28);
  });

  it("带日期后缀的模型名剥掉后缀再查（抄 ccusage 的 model_without_date_suffix）", async () => {
    const mod = await loadWith(makeTable({ "gpt-4o": { input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5 } }));
    expect((await mod.lookupReferencePrice("gpt-4o-2024-08-06", "openai"))?.matchedKey).toBe("gpt-4o");
    // Anthropic 风格的 8 位日期后缀也认
    expect((await mod.lookupReferencePrice("gpt-4o-20240806", "openai"))?.matchedKey).toBe("gpt-4o");
  });

  it("分隔符归一：`gpt-4.1` 能配上表里的 `gpt-4-1`", async () => {
    const mod = await loadWith(makeTable({ "gpt-4-1": { input_cost_per_token: 2e-6, output_cost_per_token: 8e-6 } }));
    expect((await mod.lookupReferencePrice("gpt-4.1", "openai"))?.matchedKey).toBe("gpt-4-1");
  });

  it("多条同叶子名时优先 provider 前缀对得上的那条", async () => {
    const both = { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
    const mod = await loadWith(makeTable({ "openai/gpt-4o": both, "azure/gpt-4o": both }));
    expect((await mod.lookupReferencePrice("gpt-4o", "openai"))?.matchedKey).toBe("openai/gpt-4o");
  });

  it("查不到就返回 undefined——不编一个默认价", async () => {
    const mod = await loadWith(makeTable());
    expect(await mod.lookupReferencePrice("某个私有部署的模型", "custom")).toBeUndefined();
    expect(await mod.lookupReferencePrice("", "custom")).toBeUndefined();
  });

  it("条目缺价（只有 max_tokens 之类）当查不到，不返回一个 0 元的价", async () => {
    const mod = await loadWith(makeTable({ "free-but-unpriced": { max_input_tokens: 1000 } }));
    expect(await mod.lookupReferencePrice("free-but-unpriced", "custom")).toBeUndefined();
  });

  it("拿到的内容不像完整表（少于 100 条）时直接报错，不用一份残缺的价目", async () => {
    const mod = await loadWith({ "gpt-4o": { input_cost_per_token: 2.5e-6 } });
    await expect(mod.lookupReferencePrice("gpt-4o", "openai")).rejects.toThrow(/不像完整的价目表/);
  });

  it("HTTP 失败时报出状态码（离线时界面要能说清为什么没填上）", async () => {
    const mod = await loadWith(() => new Response("rate limited", { status: 429 }));
    await expect(mod.priceTableInfo()).rejects.toThrow(/429/);
  });
});
