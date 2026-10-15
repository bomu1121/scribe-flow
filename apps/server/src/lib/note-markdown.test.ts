import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NOTE_OWN_FIELDS, collectFrontMatterFieldNames, collectTagUsage, frontMatterKeys } from "./note-markdown";

/**
 * 两块"扫库统计"：`collectFrontMatterFieldNames`（属性名建议）与 `collectTagUsage`（标签用量，
 * 决定某个标签该不该删）。它们错了都不会报错，只会让人看到一份错的数字——所以口径要钉住。
 *
 * 「库里用过的属性名」是设置页建议列表的数据源。它错了不会报错，只会让人看到一份错的候选
 * ——所以这里把三件容易悄悄错的事钉住：
 * 1. **键的判定按 YAML 语义**：缩进的行、列表项、注释都不是键；`键:值` 没有空格在 YAML 里
 *    根本不是映射（是普通字符串），不能当键收进来。
 * 2. **统计口径是"多少篇用过"，不是出现次数**：同一篇里重复写同一个键只算一次。
 * 3. **我们自己写的固定字段要排掉**：把「标题 / tags」推荐成可抽属性是纯噪音。
 *
 * cap 那条也在这里：到上限必须如实回报 `capped`，否则界面会把"只看了前 500 篇"说成"全库就这些"。
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sf-note-fields-"));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

describe("frontMatterKeys：按 YAML 语义认键", () => {
  it("认顶格的 `键: 值`，值里带冒号的也认（取第一个冒号前的那截）", () => {
    const content = ["---", "标题: 一次对话", "原始链接: https://example.com/a?b=1", "tags:", "---", "", "正文"].join("\n");
    expect(frontMatterKeys(content)).toEqual(["标题", "原始链接", "tags"]);
  });

  it("缩进的行、列表项、注释都不是键", () => {
    const content = [
      "---",
      "# 这是注释",
      "人物:",
      "  - 张三",
      "- 李四",
      "\t制表符缩进: x",
      "事件:",
      "- 某个顶格写的列表项",
      "---",
    ].join("\n");
    expect(frontMatterKeys(content)).toEqual(["人物", "事件"]);
  });

  it("`键:值` 中间没有空格：YAML 里那是普通字符串，不算映射", () => {
    const content = ["---", "原创:2024", "备注: 有空格", "---"].join("\n");
    expect(frontMatterKeys(content)).toEqual(["备注"]);
  });

  it("CRLF 换行照样认（Windows 上写的笔记）", () => {
    expect(frontMatterKeys("---\r\n人物: 张三\r\n---\r\n正文")).toEqual(["人物"]);
  });

  it("没有 front matter 就返回空", () => {
    expect(frontMatterKeys("# 只有正文\n\n人物: 这不是 front matter")).toEqual([]);
    expect(frontMatterKeys("---\n没收尾的 front matter\n人物: 张三")).toEqual([]);
  });
});

describe("collectTagUsage：标签被多少篇用过", () => {
  it("front matter 的 tags 与正文的行内 #标签都算，同一篇里重复只算一次", async () => {
    const root = await makeVault({
      "a.md": ["---", "tags:", "  - 来源/B站", "  - 话题/平台抽成", "---", "", "正文里又提到 #话题/平台抽成 一次。"].join("\n"),
      "b.md": ["---", "tags:", "  - 来源/B站", "---", "", "再来一个 #领域/历史。"].join("\n"),
      "c.md": "没有标签的笔记",
    });
    const { items, scanned, capped } = await collectTagUsage(root);
    expect(capped).toBe(false);
    expect(scanned).toBe(3);
    expect(items).toEqual([
      { tag: "来源/B站", count: 2 },
      { tag: "话题/平台抽成", count: 1 },
      { tag: "领域/历史", count: 1 },
    ]);
  });

  it("代码块里的 # 不算标签（与打标共用同一份解析）", async () => {
    const root = await makeVault({ "a.md": "正文。\n\n```\n# 这是标题不是标签\n```\n\n#真的标签\n" });
    const { items } = await collectTagUsage(root);
    expect(items).toEqual([{ tag: "真的标签", count: 1 }]);
  });

  it("到上限就停并如实说是下限", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) files[`n${i}.md`] = `#标签${i}\n`;
    const root = await makeVault(files);
    const { items, scanned, capped } = await collectTagUsage(root, { cap: 3 });
    expect(capped).toBe(true);
    expect(scanned).toBe(3);
    expect(items).toHaveLength(3);
  });

  it("空库不抛错", async () => {
    const missing = await collectTagUsage(join(tmpdir(), "sf-no-vault-" + Date.now()));
    expect(missing).toEqual({ items: [], scanned: 0, capped: false });
  });
});

describe("collectFrontMatterFieldNames：统计口径与上限", () => {
  it("按「多少篇用过」计数，同一篇里重复写只算一次", async () => {
    const root = await makeVault({
      "a.md": "---\n人物:\n  - 张三\n人物: 重复也不会算两次\n时期: 唐朝\n---\n正文",
      "b.md": "---\n人物: 李四\n地点: 长安\n---\n正文",
      "c.md": "---\n地点: 洛阳\n---\n正文",
    });
    const { items, scanned, capped } = await collectFrontMatterFieldNames(root);
    expect(capped).toBe(false);
    expect(scanned).toBe(3);
    /* 篇数相同时按中文拼音序（地点 < 人物），这样列表顺序是稳定的、不会每次打开都跳 */
    expect(items).toEqual([
      { name: "地点", count: 2 },
      { name: "人物", count: 2 },
      { name: "时期", count: 1 },
    ]);
  });

  it("排掉我们自己写进 front matter 的固定字段", async () => {
    const root = await makeVault({
      "a.md": "---\n标题: 标题不该进候选\ntags:\n  - 话题/AI\n发布日期: 2026-08-14\n创建日期: 2026-10-13\n人物: 张三\n---\n正文",
    });
    const { items } = await collectFrontMatterFieldNames(root);
    expect(items).toEqual([{ name: "人物", count: 1 }]);
    /* 名单是 engine 里拼 front matter 的那几行，这里钉住它当前的内容 */
    expect(NOTE_OWN_FIELDS).toContain("标题");
    expect(NOTE_OWN_FIELDS).toContain("tags");
    // 「发布日期」也是我们写的（B 站稿件的 pubdate），不该被当成用户可选的抽取字段推荐回去
    expect(NOTE_OWN_FIELDS).toContain("发布日期");
  });

  it("到上限就停，并如实说是下限", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) files[`n${i}.md`] = `---\n属性${i}: x\n---\n正文`;
    const root = await makeVault(files);
    const { items, scanned, capped } = await collectFrontMatterFieldNames(root, { cap: 3 });
    expect(capped).toBe(true);
    expect(scanned).toBe(3);
    expect(items).toHaveLength(3);
  });

  it("模板目录与隐藏目录不算（与走查一致）", async () => {
    const root = await makeVault({
      "正常.md": "---\n人物: 张三\n---\n正文",
      "90-Templates/模板.md": "---\n不该出现: x\n---\n正文",
      ".obsidian/缓存.md": "---\n也不该出现: x\n---\n正文",
    });
    const { items } = await collectFrontMatterFieldNames(root);
    expect(items).toEqual([{ name: "人物", count: 1 }]);
  });

  it("库路径不存在或没有笔记时返回空，不抛错", async () => {
    const missing = await collectFrontMatterFieldNames(join(tmpdir(), "sf-not-exist-" + Date.now()));
    expect(missing).toEqual({ items: [], scanned: 0, capped: false });
    const empty = await makeVault({ "空.md": "" });
    expect((await collectFrontMatterFieldNames(empty)).items).toEqual([]);
  });
});
