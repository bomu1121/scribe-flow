import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { parseGraph } from "@scribe-flow/shared";
import { createDatabase, type AppDatabase } from "../db/client";
import { projects, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";
import { readRelatedSectionNames } from "./related-notes";
import { updateSettings } from "./settings";
import { sleep } from "./sleep";

/**
 * Obsidian 笔记节点：保存目录里已有同名笔记时，是覆盖它还是退让成 `标题 (2).md`（**默认退让**）；
 * 一次运行收到多份输入时，是各写一篇还是合并成一篇（**默认各写一篇**）。
 *
 * 走真实引擎与真实磁盘：这两个开关的价值就在「最后落在文件系统上的那个名字与那几篇文件」，
 * 只调纯函数测不出引擎有没有真的用上它们。全程离线——不配 AI 密钥，标签判定与属性抽取两条模型路径都不会触发。
 * 两个开关的**默认值**都按「什么都不写」的工程图来验（缺省口径与卡片上的开关一致，见 graph.ts 的 ObsidianData）。
 */

const tmpDirs: string[] = [];
let server: Server;
let port = 0;
/** 到假 AI 的调用次数，以及最后一次**属性抽取**请求的 system 提示词。
    只记抽取那一次：打标请求紧跟在后面，若混在一起记，断言会读到打标的词库而不是抽取的字段名。 */
let chatCalls = 0;
let lastExtractSystem = "";
const TITLE = "第1期";
const BODY = "这是本次运行的正文。";
/** 笔记节点写进去的子目录：节点没填 folder 时用设置页的默认值。 */
const FOLDER = "00-Inbox";

beforeAll(async () => {
  // 假 AI：服务属性抽取与话题打标两条模型路径，不联网、不花钱。
  // 打标那条固定回空数组（这个文件验的是"相关笔记写没写"，标签不是重点）。
  server = createServer((req, res) => {
    if (!req.url?.includes("/chat/completions")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      chatCalls += 1;
      const system = (JSON.parse(body) as { messages?: Array<{ role: string; content: string }> }).messages?.find(
        (message) => message.role === "system",
      )?.content ?? "";
      if (system.includes("笔记结构化助手")) lastExtractSystem = system;
      const content = body.includes("可用标签") ? "[]" : '{"人物":["张三"]}';
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  // sqlite 句柄可能在 Windows 上短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface NoteRunResult {
  status: string | undefined;
  summary: string | null | undefined;
}

/** 跑一次「文本 → Obsidian 笔记」，返回笔记节点那一次的落库结果。 */
async function runNote(
  vaultPath: string,
  data: Record<string, unknown>,
  tag: string,
  obsidian: Record<string, unknown> = {},
): Promise<NoteRunResult> {
  const dataDir = await tempDir(`scribe-obsidian-${tag}-`);
  const db = createDatabase(dataDir);
  // 默认只留「写到本地库」这一条路：关联与属性抽取关掉，测试不碰网络也不依赖模型。
  updateSettings(db, { obsidian: { vaultPath, autoLinkEnabled: false, extractFields: [], ...obsidian } });
  // 密钥一律指向本文件的假 AI：只有真的走到模型那条路时才会发请求（走不到就没人调用它）。
  // 注意不能拿 `autoTagEnabled` 当条件——节点上的 `autoTag` 能覆盖它，密钥却只来自这里。
  updateSettings(db, { ai: { baseUrl: `http://127.0.0.1:${port}`, apiKey: "test-key", model: "test" } });
  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [
      { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: BODY } },
      { id: "n_note", type: "process.obsidian", position: { x: 320, y: 0 }, data: { label: "Obsidian 笔记", title: TITLE, ...data } },
    ],
    edges: [{ id: "e1", source: "n_src", target: "n_note", sourceHandle: "transcript", targetHandle: "in" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  // 前置断言：工程图校验不能把这些节点字段吃掉。少了它，下面的用例会静默退化成"跟随设置"，
  // 看起来是绿的实际什么都没验到。
  for (const key of ["overwrite", "autoTag", "extractFields", "sourceTag", "upTag"]) {
    if (data[key] === undefined) continue;
    const kept = (graph.nodes.find((node) => node.id === "n_note")?.data as Record<string, unknown> | undefined)?.[key];
    expect(kept, `parseGraph 丢掉了 ${key}`).toEqual(data[key]);
  }

  const projectId = `prj_${tag}`;
  const runId = `run_${tag}`;
  const now = Date.now();
  db.insert(projects)
    .values({ id: projectId, name: tag, description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  new RunEngine(db, dataDir).start(runId, projectId, graph, "all");

  await waitUntilFinished(db, runId, tag);
  const row = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_note"))).get();
  return { status: row?.status, summary: row?.summary };
}

/** 跑一次「多个文本 → Obsidian 笔记」：验的是与输入份数有关的开关（每个输入一篇）。 */
async function runNoteMulti(
  vaultPath: string,
  sources: { id: string; text: string }[],
  data: Record<string, unknown>,
  tag: string,
): Promise<NoteRunResult> {
  const dataDir = await tempDir(`scribe-obsidian-${tag}-`);
  const db = createDatabase(dataDir);
  updateSettings(db, { obsidian: { vaultPath, autoLinkEnabled: false, extractFields: [] } });
  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [
      ...sources.map((source, index) => ({
        id: source.id,
        type: "source.text",
        position: { x: 0, y: index * 120 },
        data: { label: `文稿${index + 1}`, text: source.text },
      })),
      { id: "n_note", type: "process.obsidian", position: { x: 320, y: 0 }, data: { label: "Obsidian 笔记", ...data } },
    ],
    edges: sources.map((source, index) => ({ id: `e${index + 1}`, source: source.id, target: "n_note", sourceHandle: "transcript", targetHandle: "in" })),
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  // 前置断言：这两个字段若在图校验里被吃掉，下面的用例会静默退化成产品默认（各写一篇、不覆盖），
  // 看着是绿的实际什么都没验。
  for (const key of ["splitByInput", "overwrite"]) {
    if (data[key] === undefined) continue;
    const kept = (graph.nodes.find((node) => node.id === "n_note")?.data as Record<string, unknown> | undefined)?.[key];
    expect(kept, `parseGraph 丢掉了 ${key}`).toEqual(data[key]);
  }

  const projectId = `prj_${tag}`;
  const runId = `run_${tag}`;
  const now = Date.now();
  db.insert(projects)
    .values({ id: projectId, name: tag, description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  new RunEngine(db, dataDir).start(runId, projectId, graph, "all");

  await waitUntilFinished(db, runId, tag);
  const row = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_note"))).get();
  return { status: row?.status, summary: row?.summary };
}

async function waitUntilFinished(db: AppDatabase, runId: string, tag: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row, `${tag}：运行没有落库`).toBeTruthy();
  expect(row!.status, `${tag}：运行没有在 ${timeoutMs}ms 内结束（${row!.status}）`).not.toBe("running");
}

/** 建一个只装着指定笔记的库，返回库路径与目标子目录。 */
async function makeVault(seed: Record<string, string> = {}): Promise<{ vault: string; dir: string }> {
  const vault = await tempDir("scribe-vault-");
  const dir = join(vault, FOLDER);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(seed)) await writeFile(join(dir, name), content, "utf8");
  return { vault, dir };
}

async function noteFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
}

describe("Obsidian 笔记：同名时覆盖还是退让（默认退让）", () => {
  it("默认（开关关着）：已有同名笔记时另写 (2)，那篇人手写的原样不动", async () => {
    const handWritten = "---\ntags:\n  - 我自己打的标签\n---\n\n人手写的正文，默认不该被动。\n";
    const { vault, dir } = await makeVault({ [`${TITLE}.md`]: handWritten });

    const result = await runNote(vault, {}, "keep-default");
    expect(result.status).toBe("done");
    // 摘要里报的就是实际落盘的那个名字，用户不用去猜写哪儿了。
    expect(result.summary).toContain(`${TITLE} (2).md`);

    expect(await noteFiles(dir)).toEqual([`${TITLE} (2).md`, `${TITLE}.md`]);
    // 一个字节都不该动。
    expect(await readFile(join(dir, `${TITLE}.md`), "utf8")).toBe(handWritten);
    expect(await readFile(join(dir, `${TITLE} (2).md`), "utf8")).toContain(BODY);
  });

  it("默认：重复运行接着排 (3)、(4)", async () => {
    const { vault, dir } = await makeVault();

    await runNote(vault, {}, "seq-1");
    await runNote(vault, {}, "seq-2");
    await runNote(vault, {}, "seq-3");

    expect(await noteFiles(dir)).toEqual([`${TITLE} (2).md`, `${TITLE} (3).md`, `${TITLE}.md`]);
  });

  it("打开覆盖：同名笔记整篇重写，人写的正文被替换、人写的标签留下", async () => {
    const handWritten = "---\ntags:\n  - 我自己打的标签\n---\n\n人手写的正文，这次运行会把它盖掉。\n";
    const { vault, dir } = await makeVault({ [`${TITLE}.md`]: handWritten });

    const first = await runNote(vault, { overwrite: true }, "overwrite-on");
    expect(first.status).toBe("done");

    // 只该有那一篇：覆盖模式下不生成 (2)。
    expect(await noteFiles(dir)).toEqual([`${TITLE}.md`]);
    const content = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(content).toContain("我自己打的标签");
    expect(content).toContain(BODY);
    expect(content).not.toContain("人手写的正文");
  });
});

describe("Obsidian 笔记：这一篇怎么抽由节点决定（设置页只提供默认）", () => {
  /** 设置页的默认：抽「人物」、AI 开着；假 AI 无论要什么都回 {"人物":["张三"]}。 */
  const settings = { autoTagEnabled: true, extractFields: ["人物"], autoLinkEnabled: false };

  it("节点上选了字段就以节点为准：发给模型的是节点那组，写出来的也只有那组", async () => {
    const { vault, dir } = await makeVault();
    chatCalls = 0;

    const run = await runNote(vault, { extractFields: ["事件"] }, "node-fields", settings);
    expect(run.status).toBe("done");

    // 请求侧：提示词里列的是节点选的「事件」，不再有设置页默认的「人物」
    expect(lastExtractSystem).toContain("事件");
    expect(lastExtractSystem).not.toContain("人物");
    // 落盘侧：假 AI 回的"人物"不在节点选的字段里，因此不该写进 front matter
    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(saved).not.toContain("人物");
    expect(chatCalls).toBeGreaterThan(0);
  });

  it("节点上留空＝跟随设置页的默认（人物被写进去）", async () => {
    const { vault, dir } = await makeVault();
    const run = await runNote(vault, {}, "node-follow", settings);
    expect(run.status).toBe("done");
    expect(lastExtractSystem).toContain("人物");
    expect(await readFile(join(dir, `${TITLE}.md`), "utf8")).toContain("  - 张三");
  });

  it("节点上关掉 AI（autoTag: false）：一次模型都不调，属性与话题标签都不写", async () => {
    const { vault, dir } = await makeVault();
    chatCalls = 0;

    const run = await runNote(vault, { autoTag: false }, "node-ai-off", settings);
    expect(run.status).toBe("done");

    // 这一条是"关掉"与"留空跟随"的分界：关掉必须连话题标签一起停，所以调用数是 0。
    expect(chatCalls).toBe(0);
    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(saved).not.toContain("人物");
  });

  it("节点上开着 AI（autoTag: true）：设置页默认关着也照抽", async () => {
    const { vault, dir } = await makeVault();
    chatCalls = 0;

    const run = await runNote(vault, { autoTag: true }, "node-ai-on", { ...settings, autoTagEnabled: false });
    expect(run.status).toBe("done");
    expect(chatCalls).toBeGreaterThan(0);
    expect(await readFile(join(dir, `${TITLE}.md`), "utf8")).toContain("  - 张三");
  });
});

describe("Obsidian 笔记：保存时写相关笔记", () => {
  it("按设置里的属性在库里找相关笔记写进文末；重跑是替换不是叠加", async () => {
    const existing = [
      "---",
      "标题: 张三访谈",
      "人物:",
      "  - 张三",
      "---",
      "",
      "# 张三访谈",
      "",
      "旧笔记正文。",
      "",
    ].join("\n");
    const { vault, dir } = await makeVault({ "张三访谈.md": existing });
    const settings = { autoTagEnabled: true, extractFields: ["人物"], autoLinkEnabled: true, autoLinkMax: 5 };

    // 覆盖这一项得显式打开：默认是「退让」（另写 (2)），而这条用例验的是覆盖模式下的重写语义。
    const first = await runNote(vault, { overwrite: true }, "link-first", settings);
    expect(first.status).toBe("done");
    expect(first.summary).toContain("关联 1 篇");

    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    // 抽出来的属性进了 front matter，链接跟着它找到那篇旧笔记。
    expect(saved).toContain("  - 张三");
    expect(readRelatedSectionNames(saved)).toEqual(["张三访谈"]);

    // 重跑同一个视频：文件名相同 → 整篇重写，段落仍该是替换而不是叠第二段。
    await runNote(vault, { overwrite: true }, "link-second", settings);
    const again = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(again.match(/## 相关笔记/g)).toHaveLength(1);
    expect(readRelatedSectionNames(again)).toEqual(["张三访谈"]);
    // 保存路径只写当前这一篇，旧笔记一个字节都不该动。
    expect(await readFile(join(dir, "张三访谈.md"), "utf8")).toBe(existing);
  });
});

describe("Obsidian 笔记：两个自动标签（来源 / UP 主）由元数据写，用户只决定写不写", () => {
  /**
   * 自动标签的三个性质，这个 describe 逐个钉住：
   * ① 取值来自元数据（来源 = 素材类型，UP 主 = 作者），**不花模型钱**；
   * ② AI 开关关着也照写——它不是"AI 判断出来的东西"；
   * ③ 设置页给默认，节点卡片可逐篇覆盖（与保存目录同一套约定）。
   */
  const ON = { sourceTagEnabled: true, upTagEnabled: true, autoTagEnabled: false };

  it("默认写出来：来源取自「来源」属性、UP 主取自作者，且一次模型都不调", async () => {
    const { vault, dir } = await makeVault();
    chatCalls = 0;

    const run = await runNote(vault, { author: "某个 UP 主" }, "auto-tag-on", { ...ON });
    expect(run.status).toBe("done");

    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(saved).toContain("来源/文本"); // 图里是 source.text，所以来源是「文本」
    expect(saved).toContain("UP主名称/某个-UP-主"); // 空格按 Obsidian 规则规范成 -
    expect(chatCalls).toBe(0);
  });

  it("设置页关掉：两个标签都不写（哪怕作者和来源都在）", async () => {
    const { vault, dir } = await makeVault();

    const run = await runNote(vault, { author: "某个 UP 主" }, "auto-tag-off", { sourceTagEnabled: false, upTagEnabled: false, autoTagEnabled: false });
    expect(run.status).toBe("done");

    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(saved).not.toContain("来源/文本");
    expect(saved).not.toContain("UP主名称/");
    // 但属性行还在（那是「来源/作者」字段，和标签是两件事）
    expect(saved).toContain("来源: 文本");
    expect(saved).toContain("作者: 某个 UP 主");
  });

  it("节点卡片可以逐篇覆盖设置页的开关（设置关着、这一篇要写）", async () => {
    const { vault, dir } = await makeVault();

    const run = await runNote(vault, { author: "某个 UP 主", sourceTag: true, upTag: true }, "auto-tag-node-on", { sourceTagEnabled: false, upTagEnabled: false });
    expect(run.status).toBe("done");

    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(saved).toContain("来源/文本");
    expect(saved).toContain("UP主名称/某个-UP-主");
  });
});

describe("Obsidian 笔记：每个输入一篇（splitByInput，默认开）", () => {
  /** 三份带各自 H1 的文稿：同一个素材挂几版提示词配方就是这个形状。 */
  const THREE = [
    { id: "n_a", text: "# 第一篇\n\n详尽版正文。" },
    { id: "n_b", text: "# 第二篇\n\n成文版正文。" },
    { id: "n_c", text: "# 第三篇\n\n速览版正文。" },
  ];

  it("默认（开关开着）：三份输入写成三篇，篇名取各篇正文的 H1（不沿用节点标题）", async () => {
    const { vault, dir } = await makeVault();

    // 顺带钉死篇名规则：几篇讲的是同一个素材，若沿用节点标题（TITLE）会三篇撞一个名字，
    // 只能靠 (2)(3) 区分，等于没有名字。所以多篇模式下 H1 优先于节点标题。
    const run = await runNoteMulti(vault, THREE, { title: TITLE }, "split-default");
    expect(run.status).toBe("done");
    expect(run.summary).toContain("已保存 3 篇");

    expect(await noteFiles(dir)).toEqual(["第一篇.md", "第二篇.md", "第三篇.md"].sort());
    // 各篇只装自己那份正文：合并模式下"读完一篇才发现另外几版也在里面"的问题在这里被钉死。
    expect(await readFile(join(dir, "第一篇.md"), "utf8")).toContain("详尽版正文。");
    expect(await readFile(join(dir, "第一篇.md"), "utf8")).not.toContain("成文版正文。");
    // 每篇都有自己完整的 front matter（标题按本篇取，不是素材标题）。
    const first = await readFile(join(dir, "第一篇.md"), "utf8");
    expect(first).toContain("标题: 第一篇");
  });

  it("关掉开关：多份输入合并成一篇，篇名沿用节点标题，三份正文都在这篇里", async () => {
    const { vault, dir } = await makeVault();

    const run = await runNoteMulti(vault, THREE, { splitByInput: false, title: TITLE }, "merge-off");
    expect(run.status).toBe("done");

    expect(await noteFiles(dir)).toEqual([`${TITLE}.md`]);
    const saved = await readFile(join(dir, `${TITLE}.md`), "utf8");
    for (const body of ["详尽版正文。", "成文版正文。", "速览版正文。"]) expect(saved).toContain(body);
  });

  it("开关开着、只有一份输入时不分流，行为与合并模式一致", async () => {
    const { vault, dir } = await makeVault();

    const run = await runNoteMulti(vault, [{ id: "n_a", text: BODY }], { splitByInput: true, title: TITLE }, "split-single");
    expect(run.status).toBe("done");

    expect(await noteFiles(dir)).toEqual([`${TITLE}.md`]);
    expect(run.summary).toContain(`已保存到 Obsidian：${FOLDER}/${TITLE}.md`);
  });

  it("同一批里两篇撞同一个 H1：按 (2) 排，正文不互相覆盖", async () => {
    const { vault, dir } = await makeVault();
    const same = [
      { id: "n_a", text: "# 同名\n\n甲的正文。" },
      { id: "n_b", text: "# 同名\n\n乙的正文。" },
    ];

    const run = await runNoteMulti(vault, same, {}, "split-same-title");
    expect(run.status).toBe("done");

    expect(await noteFiles(dir)).toEqual(["同名.md", "同名 (2).md"].sort());
    const bodies = [await readFile(join(dir, "同名.md"), "utf8"), await readFile(join(dir, "同名 (2).md"), "utf8")];
    expect(bodies.join("\n")).toContain("甲的正文。");
    expect(bodies.join("\n")).toContain("乙的正文。");
  });

  it("默认关覆盖：目录里已有的同名笔记一个字节不动，新写的接着排 (2)", async () => {
    const handWritten = "# 同名\n\n人写的正文。\n";
    const { vault, dir } = await makeVault({ "同名.md": handWritten });
    const same = [
      { id: "n_a", text: "# 同名\n\n甲的新正文。" },
      { id: "n_b", text: "# 同名\n\n乙的新正文。" },
    ];

    const run = await runNoteMulti(vault, same, {}, "split-keep-hand");
    expect(run.status).toBe("done");

    expect(await noteFiles(dir)).toEqual(["同名.md", "同名 (2).md", "同名 (3).md"].sort());
    expect(await readFile(join(dir, "同名.md"), "utf8")).toBe(handWritten);
    const fresh = [await readFile(join(dir, "同名 (2).md"), "utf8"), await readFile(join(dir, "同名 (3).md"), "utf8")].join("\n");
    expect(fresh).toContain("甲的新正文。");
    expect(fresh).toContain("乙的新正文。");
  });

  it("打开覆盖也不互相覆盖：覆盖只看库里已有的文件，同一批里撞名照样排 (2)", async () => {
    // 覆盖模式下不读目录，但**同一批内**的去重仍必须生效——否则第二篇会把刚写好的第一篇盖掉。
    const { vault, dir } = await makeVault({ "同名.md": "# 同名\n\n人写的旧笔记。\n" });
    const same = [
      { id: "n_a", text: "# 同名\n\n甲的正文。" },
      { id: "n_b", text: "# 同名\n\n乙的正文。" },
    ];

    const run = await runNoteMulti(vault, same, { overwrite: true }, "split-overwrite-on");
    expect(run.status).toBe("done");

    // 库里那篇被整篇重写（覆盖），第二篇另起 (2)。
    expect(await noteFiles(dir)).toEqual(["同名.md", "同名 (2).md"].sort());
    const bodies = [await readFile(join(dir, "同名.md"), "utf8"), await readFile(join(dir, "同名 (2).md"), "utf8")].join("\n");
    expect(bodies).toContain("甲的正文。");
    expect(bodies).toContain("乙的正文。");
  });
});
