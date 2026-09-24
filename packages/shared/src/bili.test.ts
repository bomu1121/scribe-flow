import { describe, expect, it } from "vitest";
import { extractBiliUrl, extractShareTitle, pageFromUrl } from "./bili";

describe("extractBiliUrl", () => {
  it("取出整段分享文案里的 B 站短链", () => {
    const text = "【硬核科普：芯片是怎么造出来的】 https://b23.tv/aBcDeFg";
    expect(extractBiliUrl(text)).toBe("https://b23.tv/aBcDeFg");
  });

  it("直接粘贴链接原样返回，忽略中文标点后的尾巴", () => {
    expect(extractBiliUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=2。")).toBe(
      "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    );
  });

  it("没有 scheme 的地址补上 https", () => {
    expect(extractBiliUrl("b23.tv/aBcDeFg 这个不错")).toBe("https://b23.tv/aBcDeFg");
  });

  it("只有 BV / av 号也能用", () => {
    expect(extractBiliUrl("看看 BV1xx411c7mD")).toBe("BV1xx411c7mD");
    expect(extractBiliUrl("av170001")).toBe("av170001");
  });

  it("文本里夹着别的链接时优先取 B 站的", () => {
    const text = "https://example.com/x 和 https://www.bilibili.com/video/BV1xx411c7mD";
    expect(extractBiliUrl(text)).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
  });

  it("非 B 站链接与空文本都返回 null", () => {
    expect(extractBiliUrl("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(extractBiliUrl("   ")).toBeNull();
    expect(extractBiliUrl("随手记的一句笔记")).toBeNull();
  });

  it("形似的域名不算 B 站链接（notbilibili.com）", () => {
    expect(extractBiliUrl("https://notbilibili.com/video/1")).toBeNull();
  });
});

describe("extractShareTitle", () => {
  it("取分享文案里的书名号标题", () => {
    expect(extractShareTitle("【标题在这里】 https://b23.tv/aBcDeFg")).toBe("标题在这里");
  });

  it("没有标题时返回空串", () => {
    expect(extractShareTitle("https://b23.tv/aBcDeFg")).toBe("");
  });
});

describe("pageFromUrl", () => {
  it("读出分 P 号", () => {
    expect(pageFromUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=3")).toBe(3);
    expect(pageFromUrl("https://www.bilibili.com/video/BV1xx411c7mD&p=12")).toBe(12);
  });

  it("没有分 P 号或不是正整数时按第 1 P", () => {
    expect(pageFromUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toBe(1);
    expect(pageFromUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=0")).toBe(1);
  });
});
