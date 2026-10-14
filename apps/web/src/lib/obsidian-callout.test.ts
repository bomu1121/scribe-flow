import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { obsidianCallout } from "./obsidian-callout";

/**
 * 单独开一个 Marked 实例，不碰全局那一个（markdown.ts 在模块加载时会挂同一份扩展；
 * 这里要测的是扩展本身，不希望受那边的注册顺序影响）。
 */
const md = new Marked({ gfm: true, breaks: true }, { extensions: [obsidianCallout] });
const render = (source: string) => md.parse(source) as string;

describe("Obsidian callout 还原", () => {
  it("速览：`> [!summary] 速览` 变成带标题的盒子，字面的 [!summary] 不再露出", () => {
    const html = render("> [!summary] 速览\n> - 第一条\n> - 第二条");
    expect(html).toContain('data-callout="summary"');
    expect(html).toContain('data-tone="info"');
    expect(html).toContain("速览");
    expect(html).not.toContain("[!summary]");
    expect(html).toContain("<li>第一条</li>");
  });

  it("速查：`-` 默认折叠、`+` 默认展开，框内的组名与条目都在", () => {
    const collapsed = render("> [!example]- 速查\n> **数字**\n>\n> - **美国社保税率**：百分之十二点四");
    expect(collapsed).toContain("<details");
    expect(collapsed).not.toMatch(/<details[^>]*\sopen/);
    expect(collapsed).toContain('data-tone="neutral"');
    expect(collapsed).toContain("<strong>数字</strong>");
    expect(collapsed).toContain("<strong>美国社保税率</strong>");

    const expanded = render("> [!example]+ 速查\n> - a");
    expect(expanded).toMatch(/<details[^>]*\sopen/);
  });

  it("框内空行写成单独一个 `>` 时不会把框截断", () => {
    const html = render("> [!example]- 速查\n> **数字**\n>\n> - 一\n>\n> **主张**\n>\n> - 二");
    expect(html).toContain("<strong>数字</strong>");
    expect(html).toContain("<strong>主张</strong>");
    // 两组都在同一个框里：框只出现一次
    expect(html.match(/<details/g)).toHaveLength(1);
  });

  it("没给标题时回落到类型名（Title Case，与 Obsidian 缺省标题一致）", () => {
    const html = render("> [!warning]\n> 内容");
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain(">Warning<");
  });

  it("普通引用块不受影响：扩展只认 `> [!`", () => {
    const html = render("> 普通引用\n> 第二行");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("data-callout");
  });
});
