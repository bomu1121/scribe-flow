import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findRelatedNoteNames,
  pickFields,
  planRelatedBackfill,
  prepareRelatedNotes,
  readRelatedSectionNames,
  runRelatedBackfill,
  scanVaultNotes,
  stripRelatedSection,
  upsertRelatedSection,
  type RelatedNoteSource,
} from "./related-notes";

/**
 * 「相关笔记」的判定与回补。
 *
 * 三件"错了也不会报错"的事是这个功能的风险所在，重点验它们：
 * 1. **段落幂等**：回补是原地改文件，判不出自己上次写的那一段就会一段叠一段；
 * 2. **不认领用户的段**：用户自己在正文中间写的 `## 相关笔记` 不能被当成我们的删掉；
 * 3. **只动词相关笔记段**：front matter 与正文一个字节都不该被顺手重排。
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function tempVault(seed: Record<string, string>): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "scribe-related-"));
  tmpDirs.push(vault);
  const dir = join(vault, "00-Inbox");
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(seed)) await writeFile(join(dir, name), content, "utf8");
  return vault;
}

/** 库里一篇笔记的最小形状：写进 front matter 的属性 + 一点正文。 */
function noteFile(title: string, fields: Record<string, string[]> = {}, body = "正文。"): string {
  return [
    "---",
    `标题: ${title}`,
    "类型: 视频笔记",
    ...Object.entries(fields).flatMap(([field, values]) => [`${field}:`, ...values.map((value) => `  - ${value}`)]),
    "tags:",
    "  - 领域/历史",
    "---",
    "",
    `# ${title}`,
    "",
    body,
    "",
  ].join("\n");
}

function source(key: string, name: string, fields: Record<string, string[]> = {}, content = ""): RelatedNoteSource {
  return { key, name, fields, content };
}

describe("相关笔记：段落读写", () => {
  const base = noteFile("甲");

  it("写出来的形状与保存路径一致，且再写一次不再改动（幂等）", () => {
    const applied = upsertRelatedSection(base, ["乙", "丙"]);
    expect(applied.changed).toBe(true);
    expect(applied.content).toBe(`${base}\n## 相关笔记\n- [[乙]]\n- [[丙]]\n`);

    const again = upsertRelatedSection(applied.content, ["乙", "丙"]);
    expect(again.changed).toBe(false);
    expect(again.content).toBe(applied.content);
  });

  it("换一组链接是替换旧段，不是再叠一段", () => {
    const applied = upsertRelatedSection(upsertRelatedSection(base, ["乙", "丙"]).content, ["丁"]);
    expect(readRelatedSectionNames(applied.content)).toEqual(["丁"]);
    expect(applied.content.match(/## 相关笔记/g)).toHaveLength(1);
  });

  it("没有相关笔记时把这一段删干净，其余字节一个不动", () => {
    const applied = upsertRelatedSection(upsertRelatedSection(base, ["乙"]).content, []);
    expect(applied.changed).toBe(true);
    expect(applied.content).toBe(base);
  });

  it("用户自己在正文中间写的「相关笔记」不被认领，原样留着", () => {
    const custom = `${noteFile("甲")}\n## 相关笔记\n\n我自己按别的标准连的：[[另一篇]]\n\n后面还有正文。\n`;
    expect(stripRelatedSection(custom).stripped).toBe(false);
    expect(readRelatedSectionNames(custom)).toEqual([]);

    const applied = upsertRelatedSection(custom, ["乙"]);
    expect(applied.content).toContain("我自己按别的标准连的：[[另一篇]]");
    expect(applied.content).toContain("后面还有正文。");
    // 我们写的那一段永远在末尾，所以读回来的永远是自己那段。
    expect(readRelatedSectionNames(applied.content)).toEqual(["乙"]);
  });

  it("CRLF 的笔记认得出来，也不会被整篇改成 LF", () => {
    const crlf = "---\r\n标题: 甲\r\n---\r\n\r\n# 甲\r\n\r\n正文。\r\n";
    const applied = upsertRelatedSection(crlf, ["乙"]);
    expect(applied.content).toBe(`${crlf}\r\n## 相关笔记\r\n- [[乙]]\r\n`);
    expect(stripRelatedSection(applied.content).content).toBe(crlf);
  });

  it("别名链接读得回来；名字里带 [[ ]] | 的整条丢掉，不写出坏链接", () => {
    expect(readRelatedSectionNames("## 相关笔记\n- [[甲|别名]]\n- [[乙]]\n")).toEqual(["甲", "乙"]);

    const applied = upsertRelatedSection(noteFile("甲"), ["坏|名字", "好名字"]);
    expect(applied.content).toContain("- [[好名字]]");
    expect(applied.content).not.toContain("坏");
  });

  it("front matter 的属性按列表与行内两种写法都读得出来", () => {
    expect(pickFields("---\n人物:\n  - 张三\n  - 李四\n---\n", ["人物"])).toEqual({ 人物: ["张三", "李四"] });
    expect(pickFields("---\n人物: 张三, 李四\n---\n", ["人物"])).toEqual({ 人物: ["张三", "李四"] });
    expect(pickFields(noteFile("甲"), ["人物", "公司"])).toEqual({ 人物: [], 公司: [] });
  });
});

describe("相关笔记：判定", () => {
  const title = "甲";

  it("同字段同值算强相关；只在正文里出现过一次不算", () => {
    const prepared = prepareRelatedNotes([
      source("b", "乙", { 人物: ["张三"] }),
      source("c", "丙", { 人物: ["李四"] }, "这里只提了一次张三。"),
    ]);
    expect(findRelatedNoteNames({ fields: { 人物: ["张三"] }, title }, prepared, 5)).toEqual(["乙"]);
  });

  it("只是文件名里包含当前标题不算（阈值 3 挡掉这种弱信号）", () => {
    const prepared = prepareRelatedNotes([source("b", "甲某", {})]);
    expect(findRelatedNoteNames({ fields: {}, title }, prepared, 5)).toEqual([]);
  });

  it("任意配置字段的命中都是强信号——不是只有「人物/事件」才算", () => {
    const prepared = prepareRelatedNotes([source("b", "乙", { 公司: ["某公司"] })]);
    expect(findRelatedNoteNames({ fields: { 公司: ["某公司"] }, title }, prepared, 5)).toEqual(["乙"]);
  });

  it("比较不看大小写", () => {
    const prepared = prepareRelatedNotes([source("b", "乙", { 概念: ["RAG"] })]);
    expect(findRelatedNoteNames({ fields: { 概念: ["rag"] }, title }, prepared, 5)).toEqual(["乙"]);
  });

  it("最多只给 max 条，命中多的排前面", () => {
    const prepared = prepareRelatedNotes([
      source("b", "乙", { 人物: ["张三"] }),
      source("c", "丙", { 人物: ["张三"], 事件: ["某事"] }),
    ]);
    const names = findRelatedNoteNames({ fields: { 人物: ["张三"], 事件: ["某事"] }, title }, prepared, 1);
    expect(names).toEqual(["丙"]);
  });

  it("同分时按名字定序——否则顺序取决于目录读出来的次序，每台机器连出的链接都不一样", () => {
    const fields = { 人物: ["张三"] };
    // 两份内容相同、只是候选顺序不同的列表，结果必须一致。
    const forward = prepareRelatedNotes([source("b", "乙", fields), source("c", "丙", fields)]);
    const backward = prepareRelatedNotes([source("c", "丙", fields), source("b", "乙", fields)]);
    expect(findRelatedNoteNames({ fields, title }, forward, 5)).toEqual(findRelatedNoteNames({ fields, title }, backward, 5));
  });
});

describe("相关笔记：全库回补（真实磁盘）", () => {
  it("按属性把同题材的笔记连起来，重跑不再改动", async () => {
    const vault = await tempVault({
      "甲.md": noteFile("甲", { 人物: ["张三"] }),
      "乙.md": noteFile("乙", { 人物: ["张三"] }),
      "丙.md": noteFile("丙", { 人物: ["张三"] }),
      "丁.md": noteFile("丁", { 人物: ["王五"] }),
    });

    const plan = await planRelatedBackfill(vault, ["人物"], 5);
    expect(plan.totalNotes).toBe(4);
    // 丁 的「王五」库内没人撞上 → 它没有相关笔记，这一轮不用动。
    expect(plan.willUpdate).toBe(3);
    expect(plan.noFields).toBe(0);
    // 三篇互连（各 2 条），丁 0 条。
    expect(plan.plannedLinks).toBe(6);

    const report = await runRelatedBackfill(vault, ["人物"], 5);
    expect(report.written).toBe(3);
    expect(report.unchanged).toBe(1);
    expect(report.failed).toEqual([]);

    const dir = join(vault, "00-Inbox");
    const jia = await readFile(join(dir, "甲.md"), "utf8");
    expect([...readRelatedSectionNames(jia)].sort()).toEqual(["丙", "乙"].sort());
    expect(jia).toContain("正文。");
    expect(jia).toContain("  - 领域/历史");

    // 第二遍：一模一样的东西不该回写（否则每次点都是全库 mtime 抖动）。
    const second = await runRelatedBackfill(vault, ["人物"], 5);
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(4);
    expect((await planRelatedBackfill(vault, ["人物"], 5)).willUpdate).toBe(0);
    expect((await readFile(join(dir, "甲.md"), "utf8")).match(/## 相关笔记/g)).toHaveLength(1);
  });

  it("改了属性口径之后，旧的链接按新口径重算", async () => {
    const vault = await tempVault({
      "甲.md": noteFile("甲", { 人物: ["张三"] }),
      "乙.md": noteFile("乙", { 人物: ["张三"] }),
      "丙.md": noteFile("丙", { 人物: ["李四"] }),
    });
    await runRelatedBackfill(vault, ["人物"], 5);
    expect(readRelatedSectionNames(await readFile(join(vault, "00-Inbox", "甲.md"), "utf8"))).toEqual(["乙"]);

    // 换成按「事件」比：三篇都没写事件，链接应当被清掉——而不是留着一段过时的。
    // 甲与乙上一轮各有一段，丙本来就没有 → 只该动两篇。
    const swapped = await runRelatedBackfill(vault, ["事件"], 5);
    expect(swapped.written).toBe(2);
    const jia = await readFile(join(vault, "00-Inbox", "甲.md"), "utf8");
    expect(readRelatedSectionNames(jia)).toEqual([]);
    expect(jia).not.toContain("相关笔记");
  });

  it("没有属性的笔记补不出链接，单独计数（不算失败）", async () => {
    const vault = await tempVault({
      "甲.md": noteFile("甲", {}),
      "乙.md": noteFile("乙", { 人物: ["张三"] }),
    });
    const plan = await planRelatedBackfill(vault, ["人物"], 5);
    expect(plan.noFields).toBe(1);
    const report = await runRelatedBackfill(vault, ["人物"], 5);
    expect(report.failed).toEqual([]);
    expect(await readFile(join(vault, "00-Inbox", "甲.md"), "utf8")).not.toContain("相关笔记");
  });

  it("扫描时把自己写的那段摘掉，避免链接自己把自己越连越牢", async () => {
    const vault = await tempVault({ "甲.md": noteFile("甲", { 人物: ["张三"] }, "正文。\n\n## 相关笔记\n- [[某个只在链接里出现的名字]]\n") });
    const notes = await scanVaultNotes(vault, ["人物"]);
    expect(notes[0]?.content).not.toContain("某个只在链接里出现的名字");
  });
});
