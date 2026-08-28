import { describe, expect, it } from "vitest";
import { cookieFromSuccessUrl } from "./bilibili";

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
