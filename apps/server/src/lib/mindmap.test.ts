import { describe, expect, it } from "vitest";
import { countMindMapNodes, mindMapToMarkdown, parseMindMapJson } from "./mindmap";

describe("mindmap helper", () => {
  it("解析有效 JSON 树并清洗节点文本", () => {
    const raw = JSON.stringify({
      title: "Transformer 讲解",
      nodes: [
        { text: "背景", children: [{ text: "- 提出动机", children: [] }] },
        { text: "核心概念", children: [{ text: "注意力机制" }] },
      ],
    });
    const tree = parseMindMapJson(raw, { maxDepth: 4 });
    expect(tree.title).toBe("Transformer 讲解");
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes[0]?.children?.[0]?.text).toBe("提出动机");
  });

  it("序列化为 Markmap Markdown", () => {
    const md = mindMapToMarkdown(
      {
        title: "测试导图",
        nodes: [{ text: "分支一", children: [{ text: "子要点" }] }],
      },
      { theme: "paper" },
    );
    expect(md).toContain("---");
    expect(md).toContain("markmap:");
    expect(md).toContain("# 测试导图");
    expect(md).toContain("## 分支一");
    expect(md).toContain("- 子要点");
  });

  it("嵌套子节点不会被拆成单字行", () => {
    const tree = parseMindMapJson(
      JSON.stringify({
        title: "嵌套",
        nodes: [{ text: "分支", children: [{ text: "父点", children: [{ text: "子点" }, { text: "另一个子点" }] }] }],
      }),
      {},
    );
    const md = mindMapToMarkdown(tree, {});
    expect(md).toContain("- 父点");
    expect(md).toContain("  - 子点");
    expect(md).toContain("  - 另一个子点");
    expect(md.split("\n").filter((line) => line.length === 1 && /[\u4e00-\u9fa5]/.test(line))).toHaveLength(0);
  });

  it("非法 JSON 抛中文错误", () => {
    expect(() => parseMindMapJson("不是 JSON", {})).toThrow(/不是有效 JSON/);
  });

  it("统计节点总数", () => {
    const tree = parseMindMapJson(
      JSON.stringify({
        nodes: [
          {
            text: "a",
            children: [{ text: "b", children: [{ text: "c" }] }, { text: "d" }],
          },
        ],
      }),
      {},
    );
    expect(countMindMapNodes(tree.nodes)).toBe(4);
  });
});
