import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TagTaxonomy } from "@scribe-flow/shared";
import { createDatabase, type AppDatabase } from "../db/client";
import type { AiConfig } from "./ai";
import { parseNoteTags, upsertFrontMatterTags } from "./note-markdown";
import { planRetag, rememberNoteTags, runRetag } from "./tagging";

/**
 * 全库重打标的验收。
 *
 * 重点验三件"错了也不会报错"的事——它们正是这个功能存在的理由：
 * 1. **幂等**：什么都没改时第二次跑必须 0 次模型调用（否则"随时跑一遍"就是烧钱）；
 * 2. **只动词库内的标签**：人手写的标签不能被抹掉，词库删掉的标签必须被清掉；
 * 3. **分不清就跳过**：front matter 坏掉的文件原样留着，不能"顺手修复"。
 *
 * 增量那一条还额外断言了"增量时发给模型的可用标签只有新增项"——这是成本能降一个数量级的原因，
 * 只断言"调用次数少"会漏掉"prompt 其实还是整个词库"这种退化。
 */

const tmpDirs: string[] = [];
let server: Server;
let port = 0;
let chatCalls = 0;
let lastSystem = "";
/** 每次用例自己决定"这篇笔记该被判成什么标签"。 */
let respond: (note: string, available: string[]) => string[] = () => [];

function reply(res: import("node:http").ServerResponse, content: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132, prompt_cache_hit_tokens: 0 },
    }),
  );
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.url?.includes("/chat/completions")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    void (async () => {
      chatCalls += 1;
      const body = await readJsonBody(req);
      const messages = (body.messages as Array<{ role: string; content: string }>) ?? [];
      const system = String(messages[0]?.content ?? "");
      const user = String(messages.at(-1)?.content ?? "");
      lastSystem = system;
      const available = JSON.parse(system.slice(system.indexOf("可用标签：") + "可用标签：".length).trim()) as string[];
      const items = JSON.parse(user) as { id: number; 笔记: string }[];
      reply(res, JSON.stringify(items.map((item) => ({ id: item.id, tags: respond(item.笔记, available) }))));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

beforeEach(() => {
  chatCalls = 0;
  lastSystem = "";
  respond = () => [];
});

let db: AppDatabase;

async function makeVault(notes: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scribe-tagging-"));
  tmpDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  db = createDatabase(dataDir);
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  for (const [name, content] of Object.entries(notes)) {
    await writeFile(join(vault, name), content, "utf8");
  }
  return vault;
}

function aiConfig(): AiConfig {
  return { provider: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, model: "test-model", apiKey: "test-key" };
}

const availableOf = (system: string): string[] =>
  JSON.parse(system.slice(system.indexOf("可用标签：") + "可用标签：".length).trim()) as string[];

const note = (title: string, body: string, extra = ""): string => `---\n标题: ${title}\n${extra}---\n\n# ${title}\n\n${body}\n`;

describe("note-markdown：只碰 tags，其余字节原样保留", () => {
  it("补 tags 时不动其它字段", () => {
    const content = "---\n标题: 甲\n来源: B站\n人物:\n  - 张三\n---\n\n正文\n";
    const applied = upsertFrontMatterTags(content, ["领域/AI"]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.content).toContain("标题: 甲");
    expect(applied.content).toContain("来源: B站");
    expect(applied.content).toContain("  - 张三");
    expect(parseNoteTags(applied.content).frontmatter).toEqual(["领域/AI"]);
    expect(applied.content.endsWith("正文\n")).toBe(true);
  });

  it("没有 front matter 时补一段", () => {
    const applied = upsertFrontMatterTags("# 标题\n\n正文\n", ["领域/AI"]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.content.startsWith("---\n")).toBe(true);
    expect(applied.content).toContain("正文");
  });

  it("内容没变时不给 changed，避免无意义的回写", () => {
    const content = "---\ntags:\n  - 领域/AI\n---\n\n正文\n";
    const applied = upsertFrontMatterTags(content, ["领域/AI"]);
    expect(applied.ok && applied.changed).toBe(false);
  });

  it("会当布尔的标签名必须加引号（#no 否则被 YAML 读成 false）", () => {
    const applied = upsertFrontMatterTags("正文\n", ["no", "yes", "领域/AI"]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.content).toContain('- "no"');
    expect(parseNoteTags(applied.content).frontmatter).toEqual(["no", "yes", "领域/AI"]);
  });

  it("CRLF 文件也读得出标签，且不会污染正文", () => {
    const content = "---\r\ntags:\r\n  - 领域/AI\r\n---\r\n\r\n正文\r\n";
    expect(parseNoteTags(content).frontmatter).toEqual(["领域/AI"]);
    const applied = upsertFrontMatterTags(content, ["领域/AI", "领域/历史"]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(parseNoteTags(applied.content).frontmatter).toEqual(["领域/AI", "领域/历史"]);
    expect(applied.content).toContain("正文");
  });

  it("front matter 缺收尾时拒绝写入", () => {
    const broken = "---\n标题: 甲\n\n正文\n";
    const applied = upsertFrontMatterTags(broken, ["领域/AI"]);
    expect(applied.ok).toBe(false);
  });
});

describe("全库重打标", () => {
  it("首次全量判定，第二次同样的词库必须 0 次调用", async () => {
    const vault = await makeVault({
      "ai.md": note("智能体开发入门", "讲智能体开发与 AI 编排。"),
      "hist.md": note("明清财政", "讲明清时期的财政制度。"),
    });
    const taxonomy: TagTaxonomy = { 领域: ["AI", "历史"] };
    respond = (text) => (text.includes("智能体") ? ["领域/AI"] : text.includes("明清") ? ["领域/历史"] : []);

    const first = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(first.written).toBe(2);
    expect(first.calls).toBe(1); // 两篇一批
    // 用量按厂商响应的 usage 记：token 分输入/输出两笔（总 token 由它们相加，不再单独存一个字段）。
    expect(first.usage.promptTokens).toBe(120);
    expect(first.usage.completionTokens).toBe(12);
    expect(parseNoteTags(await readFile(join(vault, "ai.md"), "utf8")).frontmatter).toEqual(["领域/AI"]);

    chatCalls = 0;
    const second = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(chatCalls).toBe(0);
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(2);
  });

  it("词库长出一个新标签时，只判它、且只把新标签放进 prompt", async () => {
    const vault = await makeVault({
      "plat.md": note("平台抽成", "讲平台经济与商家利润。"),
      "hist.md": note("明清财政", "讲明清时期的财政制度。"),
    });
    const base: TagTaxonomy = { 领域: ["AI", "历史"] };
    respond = () => [];
    await runRetag(db, aiConfig(), vault, base, { allowNewTags: false });

    // 新增"平台经济"：只有 plat.md 的正文里字面出现这四个字（预筛按字面走，这是明说的取舍）。
    const grown: TagTaxonomy = { 领域: ["AI", "历史", "平台经济"] };
    respond = (text, available) => (available.includes("领域/平台经济") && text.includes("平台") ? ["领域/平台经济"] : []);
    chatCalls = 0;
    const report = await runRetag(db, aiConfig(), vault, grown, { allowNewTags: false });

    expect(chatCalls).toBe(1);
    expect(report.written).toBe(1);
    // 关键断言：增量那次 prompt 里的可用标签**只有新增项**，不是整个词库。
    expect(availableOf(lastSystem)).toEqual(["领域/平台经济"]);
    expect(parseNoteTags(await readFile(join(vault, "plat.md"), "utf8")).frontmatter).toContain("领域/平台经济");
    expect(parseNoteTags(await readFile(join(vault, "hist.md"), "utf8")).frontmatter).toEqual([]);
  });

  it("词库里从没用过的条目不会每轮都被当成新标签", async () => {
    const vault = await makeVault({ "a.md": note("甲", "只讲智能体开发。") });
    // 词库里带着一个永远匹配不上的条目：它不该让每轮都产生增量判定。
    const taxonomy: TagTaxonomy = { 领域: ["AI"], 冷门: ["从未出现过的话题"] };
    respond = () => ["领域/AI"];
    const first = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(first.calls).toBe(1);

    chatCalls = 0;
    const second = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(chatCalls).toBe(0);
    expect(second.written).toBe(0);
  });

  it("自动分组不归回补管：笔记里已有的 UP 主 / 来源标签既不清掉、也不重新推导", async () => {
    const vault = await makeVault({
      "old.md": `---
标题: 老笔记
来源: B站
作者: 某人
tags:
  - UP主名称/某UP
  - 来源/B站
  - UP：某人
---

# 老笔记

讲智能体开发。
`,
    });
    const taxonomy: TagTaxonomy = { 领域: ["AI"] };
    respond = (_text, available) => available.filter((tag) => tag === "领域/AI");

    // 清单里不该出现"需要清理"的笔记：自动分组不参与清理（老指纹里可能记过它们，见下面那条，
    // 那是老版本把 `来源` 当词库条目的时代留下的）。
    const plan = await planRetag(db, vault, taxonomy);
    expect(plan.cleanupNotes).toEqual([]);

    const report = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(report.written).toBe(1);
    const tags = parseNoteTags(await readFile(join(vault, "old.md"), "utf8")).frontmatter;
    expect(tags).toContain("领域/AI"); // 话题标签照判
    expect(tags).toContain("UP主名称/某UP"); // 自动标签原样留着（旧写法、新写法都留）
    expect(tags).toContain("来源/B站");
    // 新写法必须**逐字**留着：逐段规范化会把全角冒号换成 `-`，一次回补就把标签改坏了。
    expect(tags).toContain("UP：某人");
  });

  it("笔记缺 UP 主 / 来源标签时，回补不会顺手补上（那是入库时按元数据写的事）", async () => {
    const vault = await makeVault({
      "old.md": `---
标题: 老笔记
来源: B站
作者: 某个 UP 主
---

# 老笔记

讲智能体开发。
`,
      "hand.md": `---
tags:
  - 读书笔记
---

手工写的笔记，没有来源与作者。
`,
    });
    const taxonomy: TagTaxonomy = { 领域: ["AI"] };
    respond = (_text, available) => available.filter((tag) => tag === "领域/AI");

    const first = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(first.calls).toBe(1); // 两篇都是新笔记，一批判完
    const oldTags = parseNoteTags(await readFile(join(vault, "old.md"), "utf8")).frontmatter;
    expect(oldTags).toContain("领域/AI");
    // 来源/作者两行都在，但**不会**被推导成标签——回补只管用户维护的话题词库
    expect(oldTags.some((tag) => tag.startsWith("UP主名称/"))).toBe(false);
    expect(oldTags.some((tag) => tag.startsWith("来源/"))).toBe(false);

    // 再跑一次仍是 0 次调用（不补标签，指纹就不该反复过期）
    chatCalls = 0;
    const second = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(chatCalls).toBe(0);
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(2);
  });

  it("人写的标签原样保留；词库删掉的标签被清掉（且不花模型钱）", async () => {
    const vault = await makeVault({ "a.md": note("甲", "讲 AI 编排。", "tags:\n  - 读书笔记\n") });
    const taxonomy: TagTaxonomy = { 领域: ["AI"] };
    respond = (_text, available) => available.filter((tag) => tag === "领域/AI");

    const first = await runRetag(db, aiConfig(), vault, taxonomy, { allowNewTags: false });
    expect(first.written).toBe(1);
    const after = parseNoteTags(await readFile(join(vault, "a.md"), "utf8")).frontmatter;
    expect(after).toContain("领域/AI");
    expect(after).toContain("读书笔记"); // 人手写的没被动

    // 从词库移除"领域/AI"后重跑：它是我们的标签，必须清；人的标签仍留着。
    chatCalls = 0;
    const pruned = await runRetag(db, aiConfig(), vault, { 领域: [] }, { allowNewTags: false });
    expect(chatCalls).toBe(0); // 纯本地清理
    expect(pruned.written).toBe(1);
    const cleaned = parseNoteTags(await readFile(join(vault, "a.md"), "utf8")).frontmatter;
    expect(cleaned).toEqual(["读书笔记"]);
  });

  it("front matter 坏掉的文件跳过而不是被覆盖", async () => {
    const broken = "---\n标题: 坏的\n\n正文还在\n";
    const vault = await makeVault({ "broken.md": broken });
    respond = () => ["领域/AI"];

    const plan = await planRetag(db, vault, { 领域: ["AI"] });
    expect(plan.fullNotes).toEqual([]);
    expect(plan.unparsable.map((item) => item.relPath)).toEqual(["broken.md"]);
    expect(plan.estimatedCalls).toBe(0);

    const report = await runRetag(db, aiConfig(), vault, { 领域: ["AI"] }, { allowNewTags: false });
    expect(report.written).toBe(0);
    expect(report.failed.some((item) => item.relPath === "broken.md")).toBe(true);
    expect(await readFile(join(vault, "broken.md"), "utf8")).toBe(broken);
  });

  it("不允许新增时丢掉词库外的标签；允许时收下并回报词库变化", async () => {
    respond = () => ["领域/平台经济"];
    // 两个库各跑一次"首次判定"：这样模型一定会被叫到，才能验 allowNewTags 这一层。
    const closedVault = await makeVault({ "a.md": note("甲", "讲平台抽成。") });
    const closed = await runRetag(db, aiConfig(), closedVault, { 领域: ["AI"] }, { allowNewTags: false });
    expect(closed.learnedTags).toEqual([]);
    expect(closed.taxonomyChanged).toBe(false);
    expect(parseNoteTags(await readFile(join(closedVault, "a.md"), "utf8")).frontmatter).toEqual([]);

    const openVault = await makeVault({ "a.md": note("甲", "讲平台抽成。") });
    const opened = await runRetag(db, aiConfig(), openVault, { 领域: ["AI"] }, { allowNewTags: true });
    expect(opened.learnedTags).toEqual(["领域/平台经济"]);
    expect(opened.taxonomyChanged).toBe(true);
    expect(opened.taxonomy.领域).toContain("平台经济");
    expect(parseNoteTags(await readFile(join(openVault, "a.md"), "utf8")).frontmatter).toEqual(["领域/平台经济"]);
  });

  it("词库新增一级分组时不会凭空造叶子", async () => {
    const vault = await makeVault({ "a.md": note("甲", "讲平台抽成。") });
    respond = () => ["自造分组/某个词"];
    const report = await runRetag(db, aiConfig(), vault, { 领域: ["AI"] }, { allowNewTags: true });
    // 一级结构由人定：模型提出的自造一级被丢掉，词库不变。
    expect(report.learnedTags).toEqual([]);
    expect(Object.keys(report.taxonomy)).toEqual(["领域"]);
  });
});
