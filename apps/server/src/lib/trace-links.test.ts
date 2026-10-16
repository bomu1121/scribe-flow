import { describe, expect, it } from "vitest";
import { isTraceNoteType, readTraceSectionNames, sameSourceUrl, stripTraceSection, upsertTraceSection } from "./trace-links";

const BODY = "## 第一节\n\n正文内容。\n";

describe("溯源链接区：写入与幂等", () => {
  it("没有区域时追加一段 callout，链接按 Obsidian 的 `[[名]]` 写", () => {
    const { content, changed } = upsertTraceSection(BODY, ["《中美社保对比》 · 信息溯源"]);
    expect(changed).toBe(true);
    expect(content).toContain("> [!note] 溯源");
    expect(content).toContain("> - [[《中美社保对比》 · 信息溯源]]");
    // callout 与正文之间要空行，否则会被并进上一段
    expect(content).toContain("正文内容。\n\n> [!note] 溯源");
  });

  it("重跑不会越堆越多：先摘掉旧的再写（幂等）", () => {
    const once = upsertTraceSection(BODY, ["A"]).content;
    const twice = upsertTraceSection(once, ["A"]).content;
    expect(twice).toBe(once);
    // 同一份内容写两次，标题行只出现一次
    expect(twice.split("> [!note] 溯源").length - 1).toBe(1);
  });

  it("传的是完整集合，且顺序稳定（输入顺序不同也必须得到同一份内容）", () => {
    // 守的是「集合相同而顺序不同 → changed 判成 true → 文件白写一遍」那类抖动。
    // 不锁具体排法（拼音序还是码位序都行），只锁「稳定」与「都在」。
    const both = upsertTraceSection(BODY, ["第二版溯源", "第一版溯源"]).content;
    const flipped = upsertTraceSection(BODY, ["第一版溯源", "第二版溯源"]).content;
    expect(flipped).toBe(both);
    expect([...readTraceSectionNames(both)].sort()).toEqual(["第一版溯源", "第二版溯源"].sort());
    expect(upsertTraceSection(both, ["第一版溯源", "第二版溯源"]).changed).toBe(false);
  });

  it("溯源笔记从库里消失时，链接跟着消失（自愈，与相关笔记同一套语义）", () => {
    const once = upsertTraceSection(BODY, ["第一版溯源", "第二版溯源"]).content;
    const after = upsertTraceSection(once, ["第一版溯源"]).content;
    expect(readTraceSectionNames(after)).toEqual(["第一版溯源"]);
  });

  it("用户自己在别处写的引用块不被当成我们的区域", () => {
    const withUserList = `${BODY}
> [!quote] 用户自己的清单
> - [[别的笔记]]
`;
    const { content } = upsertTraceSection(withUserList, ["我们的溯源"]);
    expect(readTraceSectionNames(content)).toEqual(["我们的溯源"]);
    expect(content).toContain("> - [[别的笔记]]");
  });

  it("重复链接只留一条", () => {
    const merged = upsertTraceSection(BODY, ["A", "A", "  A  "]).content;
    expect(readTraceSectionNames(merged)).toEqual(["A"]);
  });

  it("名字里带 `#`、`|`、`]` 这类字符的链接会被丢掉——写出语法坏掉的链接会把整段读成普通文本", () => {
    const merged = upsertTraceSection(BODY, ["正常名", "带#的#名", "带|的"]).content;
    expect(readTraceSectionNames(merged)).toEqual(["正常名"]);
  });

  it("空列表等价于删除这一段，且不留下多余空行", () => {
    const once = upsertTraceSection(BODY, ["A"]).content;
    const removed = upsertTraceSection(once, []);
    expect(removed.changed).toBe(true);
    expect(removed.content).not.toContain("[!note] 溯源");
    expect(removed.content.replace(/\s+$/, "")).toBe(BODY.replace(/\s+$/, ""));
  });

  it("没有变化时报 changed:false——不动库里的 mtime（回补动的是整个库，更要守这条）", () => {
    const once = upsertTraceSection(BODY, ["A"]);
    expect(upsertTraceSection(once.content, ["A"]).changed).toBe(false);
    expect(upsertTraceSection(BODY, []).changed).toBe(false);
  });

  it("换行风格跟着原文（CRLF 的库不写成混排）", () => {
    const crlf = "## 第一节\r\n\r\n正文。\r\n";
    const { content } = upsertTraceSection(crlf, ["A"]);
    expect(content).toContain("\r\n> [!note] 溯源");
    expect(/[^\r]\n/.test(content)).toBe(false);
  });

  it("摘除时只动我们自己那一段，用户写在别处的引用块不受影响", () => {
    const withUserQuote = `${BODY}\n> [!quote] 用户自己写的引用\n> 里面的内容\n`;
    const { content } = stripTraceSection(withUserQuote);
    expect(content).toContain("> [!quote] 用户自己写的引用");
    expect(content).toContain("里面的内容");
  });
});

describe("溯源链接区：配对判断", () => {
  it("类型字段写着「溯源笔记」才算溯源笔记", () => {
    expect(isTraceNoteType(["溯源笔记"])).toBe(true);
    expect(isTraceNoteType(["视频笔记"])).toBe(false);
    expect(isTraceNoteType([])).toBe(false);
    expect(isTraceNoteType(undefined)).toBe(false);
  });

  it("来源链接归一后相同才算同源（忽略协议/大小写/末尾斜杠/查询串）", () => {
    const a = "https://www.bilibili.com/video/BV1DTWw6UE1y";
    expect(sameSourceUrl(a, "http://bilibili.com/video/BV1DTWw6UE1y/")).toBe(true);
    expect(sameSourceUrl(a, "https://www.bilibili.com/video/BV1DTWw6UE1y?p=2")).toBe(true);
  });

  it("不同视频不判成同源——链错比少链一次糟得多", () => {
    expect(sameSourceUrl("https://www.bilibili.com/video/BV1DTWw6UE1y", "https://www.bilibili.com/video/BV19JhW6vExZ")).toBe(false);
  });

  it("缺链接的一律不算同源（不能因为两边都没有链接就配到一起）", () => {
    expect(sameSourceUrl("", "")).toBe(false);
    expect(sameSourceUrl(undefined, "https://example.com/a")).toBe(false);
  });
});
