import { describe, expect, it } from "vitest";
import {
  AUTO_TAG_GROUPS,
  SOURCE_TAXONOMY_GROUP,
  UP_TAXONOMY_GROUP,
  UP_TAG_PREFIX,
  addTagToTaxonomy,
  isAutoTag,
  isUpTag,
  managedTags,
  normalizeNoteTag,
  normalizeTagSegment,
  sanitizeTaxonomy,
  taxonomyHash,
  writableTags,
} from "./taxonomy";
import { DEFAULT_EXTRACT_FIELDS, EXTRACT_FIELD_PRESETS, MAX_EXTRACT_FIELDS, sanitizeExtractFields } from "./obsidian";

/**
 * 词库与标签名的纯函数。重点在三件"错了不会报错"的事：
 * 空格必须被规范掉（Obsidian 标签不能含空格）、两个自动分组（UP主名称 / 来源）不能被模型分配
 * 也不能被重打标当成"词库里删掉的条目"清理、词库指纹对"同样的词库"必须稳定（它决定重打标要不要重跑）。
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
  const taxonomy = { 领域: ["AI", "历史"], 状态: [], [UP_TAXONOMY_GROUP]: ["某某UP"], [SOURCE_TAXONOMY_GROUP]: ["B站"] };

  it("writableTags 不含两个自动分组；没有二级的一级自己可当标签", () => {
    const writable = writableTags(taxonomy);
    expect(writable).toEqual(["领域/AI", "领域/历史", "状态"]);
    for (const group of AUTO_TAG_GROUPS) {
      expect(writable.some((tag) => tag.startsWith(`${group}/`))).toBe(false);
    }
  });

  it("managedTags 含一级本身（用户可能只用一级打标），但**不含自动分组**——回补不许碰它们", () => {
    expect(managedTags(taxonomy)).toContain("领域");
    expect(managedTags(taxonomy)).toContain("领域/AI");
    // 这一条是防回归的：老指纹里记过 `来源/*` 是我们写的，若 managedTags 把它们算进来，
    // 一次全库回补就会把老笔记里的来源标签当"词库里删掉的条目"清掉。
    for (const group of AUTO_TAG_GROUPS) {
      expect(managedTags(taxonomy).some((tag) => tag === group || tag.startsWith(`${group}/`))).toBe(false);
    }
  });

  it("isAutoTag 认得出两个自动分组，认不出普通分组", () => {
    expect(isAutoTag(`${UP_TAXONOMY_GROUP}/某某UP`)).toBe(true);
    expect(isAutoTag(`${SOURCE_TAXONOMY_GROUP}/B站`)).toBe(true);
    expect(isAutoTag("领域/AI")).toBe(false);
  });

  it("新形状的 UP 主标签（`UP：某某`）也算自动标签；来源那支是裸值（`B站`），认不出来", () => {
    expect(isUpTag(`${UP_TAG_PREFIX}某某UP`)).toBe(true);
    expect(isAutoTag(`${UP_TAG_PREFIX}某某UP`)).toBe(true);
    // 裸来源值与人自己写的标签在文件里长得一样，故意不当成自动标签——宁可留一个，也不误删人的标签。
    expect(isAutoTag("B站")).toBe(false);
  });

  it("normalizeNoteTag 放行 UP 主标签，其余照旧逐段规范", () => {
    // 全角冒号不是"字母数字"，逐段规范化会把它换成 `-`；一次全库回补就把 `UP：某某` 改坏了。
    expect(normalizeNoteTag(`${UP_TAG_PREFIX}某某UP`)).toBe(`${UP_TAG_PREFIX}某某UP`);
    expect(normalizeNoteTag(` ${UP_TAG_PREFIX}某某UP `)).toBe(`${UP_TAG_PREFIX}某某UP`);
    expect(normalizeNoteTag(`${UP_TAXONOMY_GROUP}/某个 UP 主`)).toBe(`${UP_TAXONOMY_GROUP}/某个-UP-主`);
    expect(normalizeNoteTag("话题/平台 抽成")).toBe("话题/平台-抽成");
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
