import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parseGraph, type WorkflowGraph } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { appSettings, projects, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";

/**
 * M8-1 配方端到端：本地 mock OpenAI 兼容端点按 system 内容区分配方步骤并返回对应产物。
 * 引用回查能通过：scan 返回的 quote 必须逐字来自原文，因此 mock 直接从原文常量截取子串。
 */

const INPUT_TEXT =
  "本文先讲示例原文关键句甲，再讲示例原文关键句乙，最后给出结论数据 42，供观点提炼测试使用。";

let server: Server;
let baseUrl: string;
let chatCalls = 0;
/** v4 终稿步 mock 是否故意输出含 ### 的违规文本（版式硬门用例）。 */
let v4FinalizeViolates = false;
/** 知识巩固用例：出题/审题步是否额外产出一道引文不存在的题（触发降级丢弃）。 */
let drillExtraItem = false;

function reply(res: ServerResponse, content: string): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
      if (system.includes("只输出攻略要素拆解 JSON")) {
        reply(
          res,
          JSON.stringify({
            meta: { game: "示例游戏", series: "示例系列", episode: "第1期", guideType: ["角色培养"], audience: "新手" },
            oneLiner: "先培养雪御前。",
            entities: [{ name: "雪御前", category: "角色", priority: "必练", details: "群体输出", evidence: user.slice(0, 12) }],
            loadouts: [{ target: "雪御前", scene: "PVE", config: "隐念/狂骨 155" }],
            steps: [{ title: "第一步", detail: "先养输出" }],
            caveats: ["不要喂 R/SR 黑蛋"],
            terms: [{ term: "黑蛋", meaning: "稀有升级素材" }],
          }),
        );
      } else if (system.includes("起草一份 Markdown 阴阳师攻略笔记")) {
        reply(res, "# 阴阳师攻略笔记：示例游戏\n> 一句话结论：先养雪御前。\n## 核心建议 / 优先级\n雪御前 155。");
      } else if (system.includes("你是阴阳师攻略审校员")) {
        reply(res, JSON.stringify({ items: [{ claim: "雪御前 155", inOriginal: true, issue: "", suggestion: "" }] }));
      } else if (system.includes("你是阴阳师攻略终稿编辑")) {
        expect(system).toContain("攻略要素拆解"); // {{all}} 展开后含拆解/草稿/核对表标记
        reply(res, "```markdown\n最终阴阳师攻略笔记正文\n```");
      } else if (system.includes("只抽取“值得溯源的信息”")) {
        reply(
          res,
          JSON.stringify({
            items: [
              {
                id: "item-1",
                category: "fact",
                claim: "示例原文包含关键句甲。",
                confidence: "confirmed",
                evidence: [{ quote: "示例原文关键句甲", locator: "00:12" }],
              },
            ],
            uncertainties: [],
          }),
        );
      } else if (system.includes("你是溯源审校员")) {
        reply(res, JSON.stringify({ items: [{ id: "item-1", ok: true, issue: "", suggestion: "" }], uncertainties: [] }));
      } else if (system.includes("你是溯源报告终稿编辑")) {
        expect(system).toContain("抽取清单"); // {{all}} 展开后含「抽取清单、核对表」标记
        reply(
          res,
          JSON.stringify({
            schema: 1,
            title: "示例信息溯源",
            summary: "共提取 1 条信息。",
            items: [
              {
                id: "item-1",
                category: "fact",
                claim: "示例原文包含关键句甲。",
                confidence: "confirmed",
                evidence: [{ quote: "示例原文关键句甲", locator: "00:12" }],
              },
            ],
            uncertainties: [],
            warnings: [],
          }),
        );
      } else if (system.includes("拆解清单 JSON（含 oneLiner")) {
        // 观点提炼 v4 scan：带 oneLiner 根键，quotes 逐字取自原文。
        reply(
          res,
          JSON.stringify({ oneLiner: "示例原文给出观点结论 42。", blocks: [{ title: "观点一", quotes: [user.slice(0, 12)] }] }),
        );
      } else if (system.includes("按下面的「期刊式」母版起草")) {
        reply(
          res,
          "# 观点提炼：示例主题\n> **一句话读懂**：示例原文包含关键句甲。\n\n---\n\n## 核心观点\n\n**1. 示例观点**\n正文保留示例原文关键句甲。",
        );
      } else if (system.includes("你是文字校对与版式审计员")) {
        reply(
          res,
          JSON.stringify({ items: [{ quote: "正文保留示例原文关键句甲", inOriginal: true, issue: "", suggestion: "" }], layoutIssues: [] }),
        );
      } else if (system.includes("你是深度内容编辑兼终稿排版编辑")) {
        expect(system).toContain("回文核对"); // {{all}} 展开后含「拆解清单、草稿、回文核对表」标记
        reply(
          res,
          v4FinalizeViolates
            ? "# 观点提炼：示例主题\n### 违规小标题\n正文。"
            : "# 观点提炼：示例主题\n> **一句话读懂**：示例原文包含关键句甲。\n\n---\n\n## 核心观点\n\n**1. 示例观点**\n终稿正文包含示例原文关键句甲。",
        );
      } else if (system.includes("只输出拆解清单 JSON")) {
        reply(res, JSON.stringify({ blocks: [{ title: "观点一", quotes: [user.slice(0, 12)] }] }));
      } else if (system.includes("按固定格式起草")) {
        reply(res, "# 观点提炼：示例主题\n## 总体概要\n概述。\n## 核心观点\n草稿正文包含示例原文关键句甲。");
      } else if (system.includes("逐条核对草稿中的")) {
        reply(res, JSON.stringify({ items: [{ quote: "草稿正文包含示例原文关键句甲", inOriginal: true, note: "" }] }));
      } else if (system.includes("依据核对表修正草稿")) {
        expect(system).toContain("回文核对"); // {{all}} 展开后含「拆解清单、草稿、核对表」标记
        reply(res, "最终修正后的笔记正文，无代码围栏。");
      } else if (system.includes("值得被考察")) {
        // 知识巩固 scan：参数经 {{params}} 注入 system，引文逐字取自原文。
        expect(system).toContain("【出题要求】");
        reply(
          res,
          JSON.stringify({
            points: [
              {
                id: "p1",
                name: "关键结论数据",
                type: "fact",
                gist: "原文给出的结论数据是 42",
                worthTesting: "数字最容易被记错",
                sourceQuote: "示例原文关键句甲",
              },
            ],
          }),
        );
      } else if (system.includes("为每个知识点出题")) {
        expect(system).toContain("【出题要求】");
        expect(system).toContain("示例原文关键句甲"); // 原文经 {{input}} 注入 step 2
        reply(
          res,
          JSON.stringify({
            items: [
              {
                id: "q1",
                pointId: "p1",
                kind: "single",
                difficulty: "medium",
                stem: "原文给出的结论数据是多少？",
                options: ["42", "7", "100"],
                answer: ["42"],
                explanation: "原文末尾给出结论数据 42。",
                sourceQuote: "示例原文关键句甲",
              },
              ...(drillExtraItem
                ? [
                    {
                      id: "q2",
                      pointId: "p1",
                      kind: "single",
                      stem: "这篇文章主要用于什么测试？",
                      options: ["观点提炼测试", "语音识别测试", "排版测试"],
                      answer: ["观点提炼测试"],
                      explanation: "原文说明供观点提炼测试使用。",
                      sourceQuote: "这句引文在原文里根本不存在",
                    },
                  ]
                : []),
            ],
            extensions: [{ pointId: "p1", question: "再想一步：42 这个数字是怎么得出的？", hint: "回到原文找依据", angle: "举证方式" }],
          }),
        );
      } else if (system.includes("你是审题编辑")) {
        expect(system).toContain("示例原文关键句甲");
        reply(
          res,
          JSON.stringify({
            title: "示例练习",
            points: [
              {
                id: "p1",
                name: "关键结论数据",
                type: "fact",
                gist: "原文给出的结论数据是 42",
                worthTesting: "数字最容易被记错",
                sourceQuote: "示例原文关键句甲",
              },
            ],
            items: [
              {
                id: "q1",
                pointId: "p1",
                kind: "single",
                difficulty: "medium",
                stem: "原文给出的结论数据是多少？",
                options: ["42", "7", "100"],
                answer: ["42"],
                explanation: "原文末尾给出结论数据 42。",
                sourceQuote: "示例原文关键句甲",
              },
              ...(drillExtraItem
                ? [
                    {
                      id: "q2",
                      pointId: "p1",
                      kind: "single",
                      stem: "这篇文章主要用于什么测试？",
                      options: ["观点提炼测试", "语音识别测试", "排版测试"],
                      answer: ["观点提炼测试"],
                      explanation: "原文说明供观点提炼测试使用。",
                      sourceQuote: "这句引文在原文里根本不存在",
                    },
                  ]
                : []),
            ],
            extensions: [{ pointId: "p1", question: "再想一步：42 这个数字是怎么得出的？", hint: "回到原文找依据", angle: "举证方式" }],
          }),
        );
      } else {
        reply(res, "AI 内容");
      }
    })().catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server 启动失败");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const tmpDirs: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFinished(db: ReturnType<typeof createDatabase>, runId: string): Promise<void> {
  const deadline = Date.now() + 8000;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row).toBeTruthy();
  expect(row!.status).not.toBe("running");
}

async function setup(dataDir: string, runId: string, promptBlockId: string, promptOverride?: string) {
  const db = createDatabase(dataDir);
  const now = Date.now();
  const projectId = "prj_recipe";
  for (const [key, value] of [
    ["ai.provider", "custom"],
    ["ai.baseUrl", baseUrl.replace(/\/+$/, "")],
    ["ai.model", "mock-model"],
    ["ai.apiKey", "mock-key"],
  ] as const) {
    db.insert(appSettings).values({ key, value, updatedAt: now }).run();
  }
  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [
      { id: "n_text", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: INPUT_TEXT } },
      {
        id: "n_prompt",
        type: "process.prompt",
        position: { x: 400, y: 0 },
        data: { label: "AI 加工", promptBlockId, ...(promptOverride ? { promptOverride } : {}) },
      },
    ],
    edges: [{ id: "e1", source: "n_text", target: "n_prompt", sourceHandle: "transcript", targetHandle: "transcript" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  db.insert(projects)
    .values({ id: projectId, name: "配方测试", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  const engine = new RunEngine(db, dataDir);
  return { db, engine, graph };
}

function runWith(engine: RunEngine, runId: string, graph: WorkflowGraph): void {
  engine.start(runId, "prj_recipe", graph, "all");
}

/** 知识巩固节点用例的工程搭台：文稿 → process.drill [→ 合并 → 输出]。 */
async function setupDrill(
  dataDir: string,
  runId: string,
  options: { withOutput?: boolean; drillData?: Record<string, unknown> } = {},
) {
  const db = createDatabase(dataDir);
  const now = Date.now();
  const projectId = "prj_recipe";
  for (const [key, value] of [
    ["ai.provider", "custom"],
    ["ai.baseUrl", baseUrl.replace(/\/+$/, "")],
    ["ai.model", "mock-model"],
    ["ai.apiKey", "mock-key"],
  ] as const) {
    db.insert(appSettings).values({ key, value, updatedAt: now }).run();
  }
  const nodes: unknown[] = [
    { id: "n_text", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: INPUT_TEXT } },
    {
      id: "n_drill",
      type: "process.drill",
      position: { x: 400, y: 0 },
      data: { label: "知识巩固", ...(options.drillData ?? {}) },
    },
  ];
  const edges: unknown[] = [{ id: "e1", source: "n_text", target: "n_drill", sourceHandle: "transcript", targetHandle: "in" }];
  if (options.withOutput) {
    nodes.push({ id: "n_merge", type: "process.merge", position: { x: 800, y: 0 }, data: { label: "合并", title: "练一练" } });
    nodes.push({ id: "n_out", type: "process.output", position: { x: 1200, y: 0 }, data: { label: "输出", fileName: "练一练.md" } });
    edges.push({ id: "e2", source: "n_drill", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" });
    edges.push({ id: "e3", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" });
  }
  const graph = parseGraph({ schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } });
  db.insert(projects)
    .values({ id: projectId, name: "配方测试", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  const engine = new RunEngine(db, dataDir);
  return { db, engine, graph };
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

describe("RunEngine 配方执行（M8-1）", () => {
  it("观点提炼 v3：4 次调用、断言门通过、步骤日志齐全、输出为最后一步产物", async () => {
    chatCalls = 0;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-recipe-"));
    tmpDirs.push(dataDir);
    const runId = "run_recipe_ok";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.insight.v3");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_prompt")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toContain("配方 4 步");
    expect(nodeRow?.summary).toContain("4 次调用");
    expect(nodeRow?.outputKind).toBe("noteBlock");
    expect(nodeRow?.outputText).toContain("最终修正后的笔记正文");
    expect(chatCalls).toBe(4);

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).orderBy(runNodeLogs.createdAt).all();
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_prompt");
    expect(aiRequests.map((row) => row.step)).toEqual(["scan", "draft", "audit", "finalize"]);
    const aiResponses = logs.filter((row) => row.kind === "ai-response" && row.nodeId === "n_prompt");
    expect(aiResponses.map((row) => row.step)).toEqual(["scan", "draft", "audit", "finalize"]);
    expect(aiRequests[0]?.content).toContain("[scan]");
    expect(logs.some((row) => row.kind === "input" && row.content.includes("示例原文关键句甲"))).toBe(true);
  });

  it("观点提炼 v4：4 次调用、oneLiner/引用回查与排版硬门全过、输出为终稿", async () => {
    chatCalls = 0;
    v4FinalizeViolates = false;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-insight-v4-"));
    tmpDirs.push(dataDir);
    const runId = "run_insight_v4_ok";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.insight.v4");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_prompt")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toContain("配方 4 步");
    expect(nodeRow?.summary).toContain("4 次调用");
    expect(nodeRow?.outputKind).toBe("noteBlock");
    expect(nodeRow?.outputText).toContain("终稿正文包含示例原文关键句甲");
    expect(nodeRow?.outputText).not.toContain("###");
    expect(chatCalls).toBe(4);

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_prompt");
    expect(aiRequests.map((row) => row.step)).toEqual(["scan", "draft", "audit", "finalize"]);
    expect(aiRequests[0]?.content).toContain("[scan]");
  });

  it("观点提炼 v4：finalize 输出含 ### 触发版式硬门，节点报步骤级断言错误", async () => {
    chatCalls = 0;
    v4FinalizeViolates = true;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-insight-v4-bad-"));
    tmpDirs.push(dataDir);
    const runId = "run_insight_v4_bad";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.insight.v4");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_prompt")).get();
    expect(nodeRow?.status).toBe("error");
    expect(nodeRow?.error).toContain("修正成稿");
    expect(nodeRow?.error).toContain("断言未通过");
    expect(chatCalls).toBe(4);
    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const aiResponses = logs.filter((row) => row.kind === "ai-response" && row.nodeId === "n_prompt");
    expect(aiResponses.map((row) => row.step)).toEqual(["scan", "draft", "audit", "finalize"]);
  });

  it("阴阳师攻略加工 v2：4 次调用、scan 根键/audit 根键断言通过、输出为最后一步产物", async () => {
    chatCalls = 0;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-gameguide-"));
    tmpDirs.push(dataDir);
    const runId = "run_gameguide_ok";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.gameguide.v2");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_prompt")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toContain("配方 4 步");
    expect(nodeRow?.summary).toContain("4 次调用");
    expect(nodeRow?.outputKind).toBe("noteBlock");
    expect(nodeRow?.outputText).toContain("最终阴阳师攻略笔记正文");
    expect(chatCalls).toBe(4);

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_prompt");
    expect(aiRequests.map((row) => row.step)).toEqual(["scan", "draft", "audit", "finalize"]);
  });

  it("信息溯源 v2：3 次调用、scan/finalize 引用回查通过、输出结构化 JSON", async () => {
    chatCalls = 0;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-trace-"));
    tmpDirs.push(dataDir);
    const runId = "run_trace_ok";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.trace.v2");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_prompt")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toContain("配方 3 步");
    expect(nodeRow?.summary).toContain("3 次调用");
    expect(nodeRow?.outputKind).toBe("noteBlock");
    expect(nodeRow?.outputText).toContain('"schema":1');
    expect(nodeRow?.outputText).toContain("示例原文关键句甲");
    expect(chatCalls).toBe(3);

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_prompt");
    expect(aiRequests.map((row) => row.step)).toEqual(["scan", "audit", "finalize"]);
  });

  it("无配方块（观点提炼 v2）：仍走单次调用，日志无 step（零回归）", async () => {
    chatCalls = 0;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-recipe-v2-"));
    tmpDirs.push(dataDir);
    const runId = "run_recipe_v2";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.insight");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_prompt");
    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]?.step).toBeNull();
    expect(aiRequests[0]?.content).toContain("你是一位深度内容编辑"); // system 来自 v2 块本身
    expect(chatCalls).toBe(1);
  });

  it("配方块 + 自定义提示词覆盖：忽略配方按单步执行并记录说明", async () => {
    chatCalls = 0;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-recipe-ov-"));
    tmpDirs.push(dataDir);
    const runId = "run_recipe_override";
    const { db, engine, graph } = await setup(dataDir, runId, "builtin.insight.v3", "你是自定义编辑，输出一句话总结。");

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    expect(chatCalls).toBe(1);
    expect(logs.some((row) => row.kind === "info" && row.content.includes("自定义提示词覆盖配方"))).toBe(true);
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_prompt");
    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]?.content).toContain("自定义编辑");
    expect(aiRequests[0]?.step).toBeNull();
  });
});

describe("知识巩固节点（process.drill）", () => {
  it("三步配方跑通：参数经 {{params}} 注入、产物编译为 drillSet、摘要可读", async () => {
    chatCalls = 0;
    drillExtraItem = false;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-drill-"));
    tmpDirs.push(dataDir);
    const runId = "run_drill_ok";
    const { db, engine, graph } = await setupDrill(dataDir, runId);

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_drill")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toBe("1 个考察点 · 1 题 · 1 条延伸");
    expect(nodeRow?.outputKind).toBe("noteBlock");

    const product = JSON.parse(nodeRow?.outputText ?? "{}") as {
      kind?: string;
      points?: unknown[];
      items?: { options?: string[]; answer?: string[] }[];
      extensions?: unknown[];
    };
    expect(product.kind).toBe("drillSet");
    expect(product.points).toHaveLength(1);
    expect(product.items).toHaveLength(1);
    expect(product.items?.[0]?.options).toEqual(["42", "7", "100"]);
    expect(product.items?.[0]?.answer).toEqual(["42"]);
    expect(product.extensions).toHaveLength(1);
    expect(chatCalls).toBe(3);

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const aiRequests = logs.filter((row) => row.kind === "ai-request" && row.nodeId === "n_drill");
    expect(aiRequests.map((row) => row.step)).toEqual(["scan", "author", "audit"]);
    // 节点参数注入配方 system（与原文分离，避免污染引用回查的比对源）
    expect(aiRequests[0]?.content).toContain("考察点数量：不超过 6 个");
    expect(aiRequests[0]?.content).toContain("题型：单选、判断、填空");
    expect(aiRequests[2]?.content).toContain("逐条审查并修正");
  });

  it("引文未命中的题目降级丢弃并在摘要报数，不整节点失败", async () => {
    chatCalls = 0;
    drillExtraItem = true;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-drill-drop-"));
    tmpDirs.push(dataDir);
    const runId = "run_drill_drop";
    const { db, engine, graph } = await setupDrill(dataDir, runId);

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    // 断言门 maxMiss=2 容忍 1 条坏引文；精确丢弃由解析层完成
    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_drill")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toBe("1 个考察点 · 1 题 · 1 条延伸 · 丢弃 1（引文未命中原文）");

    const product = JSON.parse(nodeRow?.outputText ?? "{}") as { items?: { id?: string }[] };
    expect(product.items).toHaveLength(1);
    expect(product.items?.[0]?.id).toBe("q1");

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    expect(logs.some((row) => row.kind === "info" && row.content.includes("丢弃明细"))).toBe(true);
    expect(chatCalls).toBe(3);
  });

  it("接到合并与输出节点：写出的是可读 Markdown 题目集，不是原始 JSON", async () => {
    chatCalls = 0;
    drillExtraItem = false;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-drill-out-"));
    tmpDirs.push(dataDir);
    const runId = "run_drill_out";
    const { db, engine, graph } = await setupDrill(dataDir, runId, { withOutput: true });

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    expect(db.select().from(runs).where(eq(runs.id, runId)).get()?.status).toBe("success");
    const text = await readFile(join(dataDir, "outputs", runId, "练一练.md"), "utf8");
    expect(text).toContain("# 练一练");
    expect(text).toContain("## 考察点");
    expect(text).toContain("## 练习题");
    expect(text).toContain("**答案**：42");
    expect(text).toContain("## 再想一步");
    expect(text).not.toContain('"drillSet"');
    expect(text).not.toContain('"points"');
  });

  it("withExtensions=false 时确定性剔除延伸问题（不依赖模型自觉）", async () => {
    chatCalls = 0;
    drillExtraItem = false;
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-drill-noext-"));
    tmpDirs.push(dataDir);
    const runId = "run_drill_noext";
    const { db, engine, graph } = await setupDrill(dataDir, runId, { drillData: { withExtensions: false } });

    runWith(engine, runId, graph);
    await waitFinished(db, runId);

    const nodeRow = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_drill")).get();
    expect(nodeRow?.status).toBe("done");
    expect(nodeRow?.summary).toBe("1 个考察点 · 1 题 · 0 条延伸");
    const product = JSON.parse(nodeRow?.outputText ?? "{}") as { extensions?: unknown[] };
    expect(product.extensions).toEqual([]);
  });
});
