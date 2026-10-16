import { describe, expect, it } from "vitest";
import {
  addApiUsage,
  emptyApiUsage,
  estimateAudioCost,
  estimateChatCost,
  formatMoney,
  formatSeconds,
  formatTokenCount,
  hasApiUsage,
  hasTokenPrice,
  sumApiUsages,
  type ApiUsage,
  type TokenPrice,
} from "./usage";

/**
 * 心算基准：输入 1,000,000（其中缓存命中 400,000）× 2 元/百万
 * + 缓存命中 400,000 × 0.5 元/百万 + 输出 250,000 × 8 元/百万
 * = 1.2 + 0.2 + 2 = 3.4 元。
 */
const SAMPLE: ApiUsage = {
  calls: 3,
  promptTokens: 1_000_000,
  completionTokens: 250_000,
  cachedTokens: 400_000,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  audioSeconds: 0,
};

const PRICE: TokenPrice = { inputPerMillion: 2, outputPerMillion: 8, cachedInputPerMillion: 0.5, currency: "CNY" };

describe("用量累加", () => {
  it("空用量是全 0，且 hasApiUsage 判它没有", () => {
    expect(emptyApiUsage()).toEqual({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      audioSeconds: 0,
    });
    expect(hasApiUsage(emptyApiUsage())).toBe(false);
    expect(hasApiUsage(undefined)).toBe(false);
  });

  it("部分字段的累加按 0 补齐（调用点常常只知道发生了一次调用）", () => {
    const total = addApiUsage(emptyApiUsage(), { calls: 2 });
    expect(total.calls).toBe(2);
    expect(total.promptTokens).toBe(0);
    expect(addApiUsage(total, { promptTokens: 10, audioSeconds: 1.5 })).toEqual({
      calls: 2,
      promptTokens: 10,
      completionTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      audioSeconds: 1.5,
    });
  });

  it("有任意一项非 0 就算有用量（只有调用次数的联网检索也算）", () => {
    expect(hasApiUsage(addApiUsage(emptyApiUsage(), { calls: 1 }))).toBe(true);
    expect(hasApiUsage(addApiUsage(emptyApiUsage(), { audioSeconds: 0.5 }))).toBe(true);
    // 缓存命中/写入是 promptTokens 的明细、推理是 completionTokens 的明细，所以不单判它们。
    expect(hasApiUsage(addApiUsage(emptyApiUsage(), { completionTokens: 3 }))).toBe(true);
  });

  it("求和：空数组是全 0，多项相加逐字段累加", () => {
    expect(sumApiUsages([])).toEqual(emptyApiUsage());
    const summed = sumApiUsages([SAMPLE, { ...emptyApiUsage(), calls: 1, promptTokens: 5, audioSeconds: 30 }]);
    expect(summed.calls).toBe(4);
    expect(summed.promptTokens).toBe(1_000_005);
    expect(summed.completionTokens).toBe(250_000);
    expect(summed.audioSeconds).toBe(30);
  });

  it("billedCost 单独处理：不累加时它是 undefined（厂商没报），不是 0", () => {
    // 都没报 → 结果里不该出现这个字段，否则界面会把"没报"显示成"报了 0"。
    expect("billedCost" in sumApiUsages([SAMPLE, SAMPLE])).toBe(false);

    const reported = { ...SAMPLE, billedCost: 0.5 };
    expect(sumApiUsages([reported, reported]).billedCost).toBeCloseTo(1, 10);
    // 一半报了一半没报：报的那部分照样累计（缺的那次不知道，不冒充 0）。
    expect(sumApiUsages([reported, SAMPLE]).billedCost).toBeCloseTo(0.5, 10);
    // 厂商报了 0（免费额度）也算有效值，要留住。
    const zero = { ...SAMPLE, billedCost: 0 };
    expect(sumApiUsages([zero]).billedCost).toBe(0);
    expect(hasApiUsage(zero)).toBe(true);
  });
});

describe("费用估算（估算，不是账单）", () => {
  it("输入按全价、缓存命中按缓存价、输出按输出价分开算", () => {
    // (1,000,000 − 400,000) × 2 + 400,000 × 0.5 + 250,000 × 8 = 1.2 + 0.2 + 2 = 3.4 元
    expect(estimateChatCost(SAMPLE, PRICE)).toBeCloseTo(3.4, 10);
  });

  it("缓存价没填就退回输入价（偏高而非偏低，这个方向是安全的）", () => {
    const noCachePrice: TokenPrice = { ...PRICE, cachedInputPerMillion: 0 };
    // 1,000,000 × 2 + 250,000 × 8 = 2 + 2 = 4 元
    expect(estimateChatCost(SAMPLE, noCachePrice)).toBeCloseTo(4, 10);
    expect(estimateChatCost(SAMPLE, noCachePrice)).toBeGreaterThan(estimateChatCost(SAMPLE, PRICE));
  });

  it("缓存写入从输入价里扣出来算，不扣就是同一批 token 算两遍", () => {
    // prompt_tokens 已经含了 cache_write（明细字段），所以全价输入只剩 800,000。
    const usage: ApiUsage = { ...emptyApiUsage(), promptTokens: 1_000_000, cacheWriteTokens: 200_000 };
    // (1,000,000 − 200,000) × 2 + 200,000 × 2 = 2 元（写入按输入价，于是等价于全部按输入价）
    expect(estimateChatCost(usage, PRICE)).toBeCloseTo(2, 10);
  });

  it("推理 token 不另算：它是 completion_tokens 的明细，加一遍就是算两遍", () => {
    const withReasoning: ApiUsage = { ...emptyApiUsage(), completionTokens: 250_000, reasoningTokens: 100_000 };
    const without: ApiUsage = { ...emptyApiUsage(), completionTokens: 250_000 };
    expect(estimateChatCost(withReasoning, PRICE)).toBe(estimateChatCost(without, PRICE));
    // 它已经在输出价里付过一次了：250,000 × 8 / 1e6 = 2 元
    expect(estimateChatCost(withReasoning, PRICE)).toBeCloseTo(2, 10);
  });

  it("缓存命中比输入还多时（脏数据）不会算成负数", () => {
    const broken: ApiUsage = { ...emptyApiUsage(), promptTokens: 100, cachedTokens: 999 };
    expect(estimateChatCost(broken, PRICE)).toBeGreaterThanOrEqual(0);
    const both: ApiUsage = { ...emptyApiUsage(), promptTokens: 100, cachedTokens: 80, cacheWriteTokens: 80 };
    expect(estimateChatCost(both, PRICE)).toBeGreaterThanOrEqual(0);
  });

  it("单价为 0 时折出来是 0，由调用方决定「不显示金额」而不是显示 0 元", () => {
    const zero: TokenPrice = { inputPerMillion: 0, outputPerMillion: 0, cachedInputPerMillion: 0, currency: "CNY" };
    expect(estimateChatCost(SAMPLE, zero)).toBe(0);
    expect(hasTokenPrice(zero)).toBe(false);
    expect(hasTokenPrice(PRICE)).toBe(true);
  });

  it("音频按分钟折算：90 秒 × 0.06 元/分 = 0.09 元", () => {
    const audio: ApiUsage = { ...emptyApiUsage(), audioSeconds: 90 };
    expect(estimateAudioCost(audio, 0.06)).toBeCloseTo(0.09, 10);
  });
});

describe("显示格式", () => {
  it("token 数按 k / M 缩写，低于 1000 原样显示", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(12345)).toBe("12.3k");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });

  it("金额小于一分时给下限写法，不写成 0（那会让人以为没花钱）", () => {
    expect(formatMoney(0)).toBe("0 元");
    expect(formatMoney(0.0004)).toBe("<0.01 元");
    expect(formatMoney(0.014)).toBe("0.01 元");
    expect(formatMoney(4)).toBe("4.00 元");
  });

  it("美元走符号在前，跟人民币的写法不一样", () => {
    expect(formatMoney(0, "USD")).toBe("$0");
    expect(formatMoney(0.001, "USD")).toBe("<$0.01");
    expect(formatMoney(4, "USD")).toBe("$4.00");
  });

  it("秒数按分秒拆，整分不带零头；跨过 60 的进位也归到分钟", () => {
    expect(formatSeconds(8)).toBe("8秒");
    expect(formatSeconds(59.4)).toBe("59秒");
    // 59.6 秒四舍五入到 60，应当写成「1分」而不是「60秒」——后者读起来像另一种单位。
    expect(formatSeconds(59.6)).toBe("1分");
    expect(formatSeconds(95)).toBe("1分35秒");
    expect(formatSeconds(120)).toBe("2分");
  });
});
