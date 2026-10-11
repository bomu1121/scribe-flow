import { describe, expect, it } from "vitest";
import {
  UP_TAXONOMY_GROUP,
  addTagToTaxonomy,
  managedTags,
  normalizeTagSegment,
  sanitizeTaxonomy,
  taxonomyHash,
  topicManagedTags,
  writableTags,
} from "./taxonomy";
import { DEFAULT_EXTRACT_FIELDS, EXTRACT_FIELD_PRESETS, MAX_EXTRACT_FIELDS, sanitizeExtractFields } from "./obsidian";

/**
 * 词库与标签名的纯函数。重点在三件"错了不会报错"的事：
 * 空格必须被规范掉（Obsidian 标签不能含空格）、UP 主那一支不能被模型分配、
 * 词库指纹对"同样的词库"必须稳定（它决定重打标要不要重跑）。
 */

describe("normalizeTagSegment", () => {
  it("把空格与非法字符换成 -，并折叠多余的分隔符", () => {
    expect(normalizeTagSegment("某个 UP 主")).toBe("某个-UP-主");
    expect(normalizeTagSegment("  AI  相关  ")).toBe("AI-相关");
    expect(normalizeTagSegment("#领域")).toBe("领域");
    expect(normalizeTagSegment("a:b/c*d")).toBe("a-b-c-d");
  });

  it("丢掉全数字片段：Obsidian 不把 #123 当标签", () => {
    expect(normalizeTagSegment("123")).toBe("");
    expect(normalizeTagSegment("2026")).toBe("");
    expect(normalizeTagSegment("v2026")).toBe("v2026");
  });

  it("空串与纯符号得到空串", () => {
    expect(normalizeTagSegment("")).toBe("");
    expect(normalizeTagSegment("   ")).toBe("");
    expect(normalizeTagSegment("---")).toBe("");
  });
});

describe("词库派生", () => {
  const taxonomy = { 领域: ["AI", "历史"], 状态: [], [UP_TAXONOMY_GROUP]: ["某某UP"] };

  it("writableTags 不含 UP 主那一支；没有二级的一级自己可当标签", () => {
    const writable = writableTags(taxonomy);
    expect(writable).toEqual(["领域/AI", "领域/历史", "状态"]);
    expect(writable.some((tag) => tag.startsWith(UP_TAXONOMY_GROUP))).toBe(false);
  });

  it("managedTags 含一级本身（用户可能只用一级打标）", () => {
    expect(managedTags(taxonomy)).toContain("领域");
    expect(managedTags(taxonomy)).toContain("领域/AI");
  });

  it("topicManagedTags 去掉 UP 主那一支", () => {
    expect(topicManagedTags(taxonomy).some((tag) => tag.startsWith(UP_TAXONOMY_GROUP))).toBe(false);
    expect(topicManagedTags(taxonomy)).toContain("状态");
  });

  it("taxonomyHash 与键序、大小写无关，与内容有关", () => {
    const a = { 领域: ["AI", "历史"] };
    expect(taxonomyHash(a)).toBe(taxonomyHash({ 领域: ["历史", "AI"] }));
    expect(taxonomyHash(a)).not.toBe(taxonomyHash({ 领域: ["AI"] }));
    expect(taxonomyHash(a)).not.toBe(taxonomyHash({ 领域: ["AI", "历史"], 状态: [] }));
  });
});

describe("sanitizeTaxonomy", () => {
  it("收敛坏数据：非数组的二级、重复项、非法名", () => {
    const clean = sanitizeTaxonomy({
      领域: ["AI", "ai", "AI", "  ", "123", "平台 经济"],
      坏的: "不是数组",
    });
    expect(clean.领域).toEqual(["AI", "平台-经济"]);
    expect(clean.坏的).toEqual([]);
  });

  it("非对象输入得到空词库", () => {
    expect(sanitizeTaxonomy(null)).toEqual({});
    expect(sanitizeTaxonomy([])).toEqual({});
    expect(sanitizeTaxonomy("x")).toEqual({});
  });
});

describe("addTagToTaxonomy", () => {
  it("加新二级返回新对象；已存在（忽略大小写）时原样返回同一个引用", () => {
    const before = { 领域: ["AI"] };
    const after = addTagToTaxonomy(before, "领域", "平台经济");
    expect(after).not.toBe(before);
    expect(after.领域).toEqual(["AI", "平台经济"]);
    expect(addTagToTaxonomy(before, "领域", "ai")).toBe(before);
  });

  it("非法名字不改词库", () => {
    const before = { 领域: ["AI"] };
    expect(addTagToTaxonomy(before, "领域", "123")).toBe(before);
    expect(addTagToTaxonomy(before, "", "x")).toBe(before);
  });
});

describe("抽取字段名的收敛", () => {
  it("字段名会当 YAML 键用，所以要挡掉冒号/井号/换行", () => {
    expect(sanitizeExtractFields(["人物", "a:b", "c#d", "e\nf", "  机构  "])).toEqual(["人物", "ab", "cd", "ef", "机构"]);
  });

  it("去重、限长、限个数，非数组给空", () => {
    expect(sanitizeExtractFields(["人物", "人物"])).toEqual(["人物"]);
    expect(sanitizeExtractFields(["x".repeat(40)])[0].length).toBe(12);
    expect(sanitizeExtractFields(Array.from({ length: 20 }, (_, i) => `f${i}`)).length).toBe(MAX_EXTRACT_FIELDS);
    expect(sanitizeExtractFields("人物")).toEqual([]);
    expect(sanitizeExtractFields([null, "", "  "])).toEqual([]);
  });

  it("空数组是合法值（＝不抽），不能被当成坏数据丢掉", () => {
    expect(sanitizeExtractFields([])).toEqual([]);
  });

  it("预设覆盖历史那套，且有一份是空的", () => {
    expect(EXTRACT_FIELD_PRESETS.find((preset) => preset.id === "history")?.fields).toEqual(DEFAULT_EXTRACT_FIELDS);
    expect(EXTRACT_FIELD_PRESETS.some((preset) => preset.fields.length === 0)).toBe(true);
  });
});
