import { describe, expect, it } from "vitest";
import { cookieFromSuccessUrl, formatPublishDate } from "./bilibili";

describe("B 站登录 Cookie 兜底重建", () => {
  it("从跨域回调 URL 的 query 提取登录凭证", () => {
    const cookie = cookieFromSuccessUrl(
      "https://passport.biligame.com/crossDomain?DedeUserID=123&%E5%B1%95%E5%BC%80&SESSDATA=abc%2B%2B&bili_jct=xyz&sid=sid123",
    );
    expect(cookie).toContain("DedeUserID=123");
    expect(cookie).toContain("SESSDATA=abc++");
    expect(cookie).toContain("bili_jct=xyz");
    expect(cookie).toContain("sid=sid123");
  });

  it("无 URL 时返回空字符串", () => {
    expect(cookieFromSuccessUrl(undefined)).toBe("");
  });
});

describe("formatPublishDate：稿件发布时间 → 笔记里的「发布日期」", () => {
  it("按北京时间折算，不是 UTC 日期", () => {
    // 这几个值取自真实接口响应（`/x/web-interface/view` 的 pubdate），期望值＝ B 站页面上显示的那天。
    // 头两个刻意选在「UTC 日期与北京时间差一天」的位置上：用 toISOString() 直接切会得到 2026-08-13。
    expect(formatPublishDate(1786638600)).toBe("2026-08-14"); // 2026-08-14 00:30 CST
    expect(formatPublishDate(1577835803)).toBe("2020-01-01"); // 2020-01-01 07:43 CST（UTC 侧是 2019-12-31）
    expect(formatPublishDate(1577808000)).toBe("2020-01-01"); // 2020-01-01 00:00 CST 整
  });

  it("无效值返回空串（笔记那一行整个不写，而不是写一个假日期）", () => {
    expect(formatPublishDate(0)).toBe("");
    expect(formatPublishDate(-1)).toBe("");
    expect(formatPublishDate(Number.NaN)).toBe("");
    expect(formatPublishDate(Number.POSITIVE_INFINITY)).toBe("");
  });
});
