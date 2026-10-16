import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parseGraph, type WorkflowGraph } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { appSettings, projects, runNodeResults, runs } from "../db/schema";
import { createRun } from "../routes/runs";
import { RunEngine } from "./engine";
import { sleep } from "./sleep";

/**
 * 用量记账端到端：**从 mock 端点报的 usage 出发，一路走到落库、汇总与单价快照**。
 *
 * 这一组用例专门盯住"账目"这件事本身，所以刻意用能心算的数字。
 * 断言里写的就是心算结果，不是把被测公式再抄一遍（那样两边一起错也测不出来）。
 */

/** mock 端点下一次 chat 调用要返回什么。`usage` 原样进响应——用它来喂不同家的字段写法。 */
interface Reply {
  content: string;
  usage: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let chatCalls = 0;
/** 按顺序取用；用完之后一直用最后一条。用它可以安排"第一次空正文、第二次正常"这类重试脚本。 */
let script: Reply[] = [];

function reply(res: ServerResponse, payload: Reply): void {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: payload.content } }],
      usage: payload.usage,
    }),
  );
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
      const index = chatCalls;
      chatCalls += 1;
      await readJsonBody(req);
      const next = script[Math.min(index, script.length - 1)] ?? { content: "好", usage: {} };
      reply(res, next);
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

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

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

/**
 * 一条最小 AI 链路：文稿 → AI 加工（自定义提示词，走单步调用）。
 * 运行行用真实的 `createRun` 建——**单价快照就是那里写的**，绕过它就测不到快照。
 */
async function setup(
  dataDir: string,
  settings: Record<string, string>,
  aiData: Record<string, unknown> = {},
): Promise<{ db: ReturnType<typeof createDatabase>; engine: RunEngine; graph: WorkflowGraph; runId: string }> {
  const db = createDatabase(dataDir);
  const now = Date.now();
  const projectId = "prj_usage";
  for (const [key, value] of Object.entries({
    "ai.provider": "custom",
    "ai.baseUrl": baseUrl.replace(/\/+$/, ""),
    "ai.model": "mock-model",
    "ai.apiKey": "mock-key",
    ...settings,
  })) {
    db.insert(appSettings).values({ key, value, updatedAt: now }).run();
  }
  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [
      { id: "n_text", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: "这是一段用于用量记账测试的原文，够长，能进 AI 节点。" } },
      { id: "n_ai", type: "process.prompt", position: { x: 400, y: 0 }, data: { label: "AI 加工", promptOverride: "把下面这段原样回一句好。", ...aiData } },
    ],
    edges: [{ id: "e1", source: "n_text", target: "n_ai", sourceHandle: "transcript", targetHandle: "transcript" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  db.insert(projects)
    .values({ id: projectId, name: "用量测试", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  const { id } = createRun(db, projectId, "all");
  return { db, engine: new RunEngine(db, dataDir), graph, runId: id };
}

/** 心算用的常量：输入 1,000,000（其中命中缓存 400,000）、输出 250,000、缓存命中价 0.5。 */
const OPENAI_SHAPE = {
  prompt_tokens: 1_000_000,
  completion_tokens: 250_000,
  total_tokens: 1_250_000,
  prompt_tokens_details: { cached_tokens: 400_000, cache_write_tokens: 30_000 },
  completion_tokens_details: { reasoning_tokens: 60_000 },
};

describe("外部 API 用量记账", () => {
  it("厂商报的 usage 落进 run_node_results，并经 detail() 汇总成估算金额", async () => {
    chatCalls = 0;
    // 心算（缓存价 0.5）：缓存命中与缓存写入都是 prompt_tokens 的明细，先从全价里扣出来再各自计：
    //   计费输入 (1,000,000−400,000−30,000)×2 = 1.14 元
    //   + 缓存命中 400,000×0.5 = 0.2 元
    //   + 缓存写入 30,000×2 = 0.06 元（写入按输入价，所以这一扣一加相互抵消）
    //   + 输出 250,000×8 = 2 元（推理 60,000 是输出的明细，不另算）
    //   = 3.40 元
    script = [{ content: "好", usage: OPENAI_SHAPE }];
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-"));
    tmpDirs.push(dataDir);
    const { db, engine, graph, runId } = await setup(dataDir, {
      "ai.inputPricePerMillion": "2",
      "ai.outputPricePerMillion": "8",
      "ai.cachedInputPricePerMillion": "0.5",
    });

    engine.start(runId, "prj_usage", graph, "all");
    await waitFinished(db, runId);

    const row = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_ai")).get();
    expect(row!.status).toBe("done");
    expect(row!.usageCalls).toBe(1);
    expect(row!.promptTokens).toBe(1_000_000);
    expect(row!.completionTokens).toBe(250_000);
    expect(row!.cachedTokens).toBe(400_000);
    expect(row!.cacheWriteTokens).toBe(30_000);
    expect(row!.reasoningTokens).toBe(60_000);
    expect(row!.audioSeconds).toBe(0);
    // 厂商没报金额 → 必须是 null，不能落成 0（那会变成"厂商报了 0"）。
    expect(row!.billedCost).toBeNull();

    // 纯本地节点（文稿）不该记出一笔账：全 0 的用量在界面上不该占一行。
    expect(db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_text")).get()!.usageCalls).toBe(0);

    const detail = engine.detail(runId);
    expect(detail.nodes.find((node) => node.nodeId === "n_ai")!.usage).toEqual({
      calls: 1,
      promptTokens: 1_000_000,
      completionTokens: 250_000,
      cachedTokens: 400_000,
      cacheWriteTokens: 30_000,
      reasoningTokens: 60_000,
      audioSeconds: 0,
    });
    expect(detail.nodes.find((node) => node.nodeId === "n_text")!.usage).toBeUndefined();

    expect(detail.usageSummary?.usage.calls).toBe(1);
    expect(detail.usageSummary?.estimatedCost).toBeCloseTo(3.4, 10);
    expect(detail.usageSummary?.currency).toBe("CNY");
    expect(detail.usageSummary?.priceSource).toBe("run");
    expect(detail.usageSummary?.prices).toEqual({ inputPerMillion: 2, outputPerMillion: 8, cachedInputPerMillion: 0.5, audioPerMinute: 0 });
  });

  it("缓存命中 token 认四种厂商写法（只认一种会给其余家显示错的 0）", async () => {
    const cases: { name: string; usage: Record<string, unknown> }[] = [
      // OpenAI / 智谱 / 火山 / 阿里 / OpenRouter 的写法。
      { name: "prompt_tokens_details.cached_tokens", usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } },
      // DeepSeek / SiliconFlow 的顶层写法。
      { name: "prompt_cache_hit_tokens", usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 40 } },
      // Moonshot 的顶层写法（它两处都给，这里只给顶层）。
      { name: "cached_tokens", usage: { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 40 } },
    ];
    for (const item of cases) {
      chatCalls = 0;
      script = [{ content: "好", usage: item.usage }];
      const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-shape-"));
      tmpDirs.push(dataDir);
      const { db, engine, graph, runId } = await setup(dataDir, {});
      engine.start(runId, "prj_usage", graph, "all");
      await waitFinished(db, runId);
      const row = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_ai")).get();
      expect(row!.cachedTokens, item.name).toBe(40);
    }
  });

  it("厂商直接报的金额原样带出来，不参与估算（那是对方收的，不是我们算的）", async () => {
    chatCalls = 0;
    script = [{ content: "好", usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.95 } }];
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-billed-"));
    tmpDirs.push(dataDir);
    // 故意也填上单价：两者都要在，界面才分得清哪个是账单、哪个是估算。
    const { db, engine, graph, runId } = await setup(dataDir, {
      "ai.inputPricePerMillion": "2",
      "ai.outputPricePerMillion": "8",
    });
    engine.start(runId, "prj_usage", graph, "all");
    await waitFinished(db, runId);

    expect(db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_ai")).get()!.billedCost).toBeCloseTo(0.95, 10);
    const detail = engine.detail(runId);
    expect(detail.usageSummary?.usage.billedCost).toBeCloseTo(0.95, 10);
    // 估算照旧独立算：(100×2 + 10×8)/1e6 = 0.00028
    expect(detail.usageSummary?.estimatedCost).toBeCloseTo(0.00028, 10);
  });

  it("单价快照：跑完之后改设置页的价，这次运行的金额不动", async () => {
    chatCalls = 0;
    script = [{ content: "好", usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }];
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-snapshot-"));
    tmpDirs.push(dataDir);
    const { db, engine, graph, runId } = await setup(dataDir, { "ai.inputPricePerMillion": "2" });
    engine.start(runId, "prj_usage", graph, "all");
    await waitFinished(db, runId);

    // 1,000,000 × 2 元/百万 = 2 元
    expect(engine.detail(runId).usageSummary?.estimatedCost).toBeCloseTo(2, 10);

    // 把设置页的价提高 5 倍，历史那单账不该跟着变。
    db.update(appSettings).set({ value: "10" }).where(eq(appSettings.key, "ai.inputPricePerMillion")).run();
    const after = engine.detail(runId).usageSummary;
    expect(after?.estimatedCost).toBeCloseTo(2, 10);
    expect(after?.priceSource).toBe("run");

    // 新跑一次才用新价：1,000,000 × 10 = 10 元。
    chatCalls = 0;
    const second = createRun(db, "prj_usage", "all");
    engine.start(second.id, "prj_usage", graph, "all");
    await waitFinished(db, second.id);
    expect(engine.detail(second.id).usageSummary?.estimatedCost).toBeCloseTo(10, 10);
  });

  it("没有快照的旧运行退回当前单价，并把这件事报给界面（priceSource=current）", async () => {
    chatCalls = 0;
    script = [{ content: "好", usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }];
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-oldrun-"));
    tmpDirs.push(dataDir);
    const { db, engine, graph, runId } = await setup(dataDir, { "ai.inputPricePerMillion": "2" });
    // 模拟升级前的旧运行：把快照清空（那五列在旧库里就是 NULL）。
    db.update(runs).set({ priceInputPerMillion: null, priceOutputPerMillion: null, priceCachedInputPerMillion: null, priceAudioPerMinute: null, priceCurrency: null }).where(eq(runs.id, runId)).run();

    engine.start(runId, "prj_usage", graph, "all");
    await waitFinished(db, runId);

    const summary = engine.detail(runId).usageSummary;
    expect(summary?.estimatedCost).toBeCloseTo(2, 10);
    // 同一个界面上的两个数，"当时的价"和"今天的价"不能长得一样——这一位就是给界面看的。
    expect(summary?.priceSource).toBe("current");
  });

  it("没填单价时照样记 token，但一个字都不提钱", async () => {
    chatCalls = 0;
    script = [{ content: "好", usage: { prompt_tokens: 30_000, completion_tokens: 1_000 } }];
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-noprice-"));
    tmpDirs.push(dataDir);
    const { db, engine, graph, runId } = await setup(dataDir, {});
    engine.start(runId, "prj_usage", graph, "all");
    await waitFinished(db, runId);

    const detail = engine.detail(runId);
    expect(detail.usageSummary?.usage.promptTokens).toBe(30_000);
    // undefined 而不是 0：界面据此才知道"该只显示 token"，而不是显示一个「0 元」骗人。
    expect(detail.usageSummary?.estimatedCost).toBeUndefined();
  });

  it("重试的每一次都记一笔账：第一次空正文，第二次成功", async () => {
    chatCalls = 0;
    script = [
      { content: "", usage: { prompt_tokens: 100, completion_tokens: 0 } },
      { content: "好", usage: { prompt_tokens: 100, completion_tokens: 40 } },
    ];
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-usage-retry-"));
    tmpDirs.push(dataDir);
    // 退避按节点配成 100ms（引擎里有下限，见 resolveRetryPolicy）——按默认的 3 秒跑，这个用例要等 3 秒。
    const { db, engine, graph, runId } = await setup(dataDir, {}, { retry: { maxRetries: 1, backoffMs: 100 } });

    engine.start(runId, "prj_usage", graph, "all");
    await waitFinished(db, runId);

    const row = db.select().from(runNodeResults).where(eq(runNodeResults.nodeId, "n_ai")).get();
    expect(row!.status).toBe("done");
    expect(chatCalls).toBe(2);
    // 第一次虽然返回空正文、节点最终也没用它，但那 100 token 是真花了的。
    expect(row!.usageCalls).toBe(2);
    expect(row!.promptTokens).toBe(200);
    expect(row!.completionTokens).toBe(40);
  });
});
