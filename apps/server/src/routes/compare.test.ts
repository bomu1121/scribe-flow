import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "../db/client";
import { appSettings } from "../db/schema";
import { createApp } from "../app";
import { compareCacheCount } from "./compare";

/**
 * /api/compare 的路由级验收：本地 mock OpenAI 兼容端点，只验证三件真会发生的事——
 * ① 正常返回结构化结论；② 同一对内容再请求命中缓存、不再调模型；③ 模型返回垃圾时不假装成功。
 *
 * 与 engine.recipe.test.ts 同一套路（同一个 mock server 写法），但这里不需要真跑引擎。
 */

let server: Server;
let baseUrl: string;
let chatCalls = 0;
/** 模型这一轮返回什么（默认一份合法判读 JSON）。 */
let replyContent = "";

function reply(res: ServerResponse, content: string): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}

const DEFAULT_ANALYSIS = {
  summary: "左边有数据表，右边只有观点",
  onlyLeft: [{ point: "附了数据表", detail: "182 个国家和地区" }],
  onlyRight: [],
  conflicts: [],
  shared: ["都讲了核心判断"],
  fit: { left: ["要引用数据时"], right: ["只想看结论时"] },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.url?.includes("/chat/completions")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    void (async () => {
      chatCalls += 1;
      await readJsonBody(req);
      reply(res, replyContent || JSON.stringify(DEFAULT_ANALYSIS));
    })();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock 端点没起来");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

let dataDir = "";
let db: AppDatabase;
let app: ReturnType<typeof createApp>;

async function setup(): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), "sf-compare-"));
  db = createDatabase(dataDir);
  // 只写 AI 端点与密钥：其余设置走默认值。
  db.insert(appSettings).values({ key: "ai.baseUrl", value: baseUrl, updatedAt: Date.now() }).run();
  db.insert(appSettings).values({ key: "ai.model", value: "mock-model", updatedAt: Date.now() }).run();
  db.insert(appSettings).values({ key: "ai.apiKey", value: "sk-test", updatedAt: Date.now() }).run();
  app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 8, docsDir: dataDir });
  chatCalls = 0;
  replyContent = "";
}

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

const post = (body: unknown) =>
  app.request("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const LEFT = { label: "AI 加工 A", text: "# 报告\n\n左侧内容：附了数据表。" };
const RIGHT = { label: "AI 加工 B", text: "# 报告\n\n右侧内容：只有观点。" };

describe("POST /api/compare", () => {
  it("正常返回结构化判读，并带上模型与截断事实", async () => {
    await setup();
    const res = await post({ left: LEFT, right: RIGHT });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cached).toBe(false);
    expect((body.analysis as { summary: string }).summary).toBe(DEFAULT_ANALYSIS.summary);
    const meta = body.meta as { model: string; truncated: { left: boolean; right: boolean; maxChars: number } };
    expect(meta.model).toBe("mock-model");
    expect(meta.truncated).toMatchObject({ left: false, right: false });
    expect(meta.truncated.maxChars).toBeGreaterThan(0);
    expect(chatCalls).toBe(1);
  });

  it("同一对内容再请求：命中缓存，不再调模型", async () => {
    await setup();
    await post({ left: LEFT, right: RIGHT });
    const again = await post({ left: LEFT, right: RIGHT });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { cached: boolean }).cached).toBe(true);
    expect(chatCalls).toBe(1);
    expect(compareCacheCount(db)).toBe(1);
  });

  it("内容变了就是新的判读（缓存按内容指纹，不按运行或节点）", async () => {
    await setup();
    await post({ left: LEFT, right: RIGHT });
    await post({ left: LEFT, right: { label: "AI 加工 B", text: "# 报告\n\n右侧内容换了一版。" } });
    expect(chatCalls).toBe(2);
    expect(compareCacheCount(db)).toBe(2);
  });

  it("refresh=true 忽略缓存重跑，并覆盖同一键的旧结论", async () => {
    await setup();
    await post({ left: LEFT, right: RIGHT });
    replyContent = JSON.stringify({ ...DEFAULT_ANALYSIS, summary: "重跑后的结论" });
    const res = await post({ left: LEFT, right: RIGHT, refresh: true });
    const body = (await res.json()) as { cached: boolean; analysis: { summary: string } };
    expect(body.cached).toBe(false);
    expect(body.analysis.summary).toBe("重跑后的结论");
    expect(chatCalls).toBe(2);
    // 同键覆盖，不新增行
    expect(compareCacheCount(db)).toBe(1);
  });

  it("模型返回垃圾时返回错误，不假装成功、也不写缓存", async () => {
    await setup();
    replyContent = "这两份内容差不多，我就不输出 JSON 了。";
    const res = await post({ left: LEFT, right: RIGHT });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("差异分析失败");
    expect(body.error).toContain("没找到 JSON");
    expect(compareCacheCount(db)).toBe(0);
  });

  it("两侧内容完全相同：直接拒绝，不花调用", async () => {
    await setup();
    const res = await post({ left: LEFT, right: LEFT });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("完全相同");
    expect(chatCalls).toBe(0);
  });

  it("没配 AI 密钥时给出可执行的提示", async () => {
    await setup();
    db.delete(appSettings).run();
    const res = await post({ left: LEFT, right: RIGHT });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("未配置 AI 模型密钥");
    expect(chatCalls).toBe(0);
  });

  it("请求体不合法时 400", async () => {
    await setup();
    expect((await post({ left: { label: "A" }, right: RIGHT })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("GET /ready 只报告有没有密钥，不调用模型", async () => {
    await setup();
    const ready = (await (await app.request("/api/compare/ready")).json()) as { ready: boolean };
    expect(ready.ready).toBe(true);
    db.delete(appSettings).run();
    const notReady = (await (await app.request("/api/compare/ready")).json()) as { ready: boolean };
    expect(notReady.ready).toBe(false);
    expect(chatCalls).toBe(0);
  });
});
