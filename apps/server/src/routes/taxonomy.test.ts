import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RetagJobView, RetagPlanView } from "@scribe-flow/shared";
import { createApp } from "../app";
import { createDatabase } from "../db/client";
import { sleep } from "../lib/sleep";

/**
 * 全库重打标的 HTTP 面：预估 → 发车 → 轮询。
 *
 * 这里刻意走真实 `createApp` + `app.request`，而不是直接调 `runRetag`——
 * 路由有没有挂进 app.ts、zod 有没有静默丢掉字段、job 状态机能不能收敛，
 * 只有从接口这一层才测得出来（仓库的 docs-gen 也会断言路由必须被挂载）。
 */

const cleanupDirs: string[] = [];
let server: Server;
let port = 0;

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}") as { messages?: Array<{ content?: string }> };
      const system = String(body.messages?.[0]?.content ?? "");
      const user = String(body.messages?.at(-1)?.content ?? "");
      const available = JSON.parse(system.slice(system.indexOf("可用标签：") + "可用标签：".length).trim()) as string[];
      const items = JSON.parse(user) as { id: number; 笔记: string }[];
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify(
                  items.map((item) => ({ id: item.id, tags: item.笔记.includes("智能体") ? available.slice(0, 1) : [] })),
                ),
              },
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220, prompt_cache_hit_tokens: 0 },
        }),
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-taxonomy-api-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(
    join(vault, "a.md"),
    "---\n标题: 智能体开发\n---\n\n# 智能体开发\n\n讲智能体开发与编排。\n",
    "utf8",
  );
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  await app.request("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ai: { provider: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, model: "test-model", apiKey: "test-key" },
      obsidian: { vaultPath: vault, tagTaxonomy: { 领域: ["AI", "历史"] }, allowNewTags: false },
    }),
  });
  return { app, vault };
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/taxonomy", () => {
  it("预估不调模型，跑完能拿到报告，且第二次预估显示无需处理", async () => {
    const { app, vault } = await setup();

    const plan = (await (await post(app, "/api/taxonomy/plan", {})).json()) as RetagPlanView;
    expect(plan.totalNotes).toBe(1);
    expect(plan.fullCount).toBe(1);
    expect(plan.estimatedCalls).toBe(1);

    const started = await post(app, "/api/taxonomy/run", {});
    expect(started.status).toBe(202);
    const { jobId } = (await started.json()) as { jobId: string };

    let job: RetagJobView | null = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(50);
      job = (await (await app.request(`/api/taxonomy/jobs/${jobId}`)).json()) as RetagJobView;
      if (job.status !== "running") break;
    }
    expect(job?.status).toBe("done");
    expect(job?.report?.written).toBe(1);
    expect(job?.report?.calls).toBe(1);
    expect(job?.report?.usage.promptTokens).toBe(200);
    expect(await readFile(join(vault, "a.md"), "utf8")).toContain("领域/AI");

    // 幂等：什么都没改，第二轮预估应当全是"无需处理"。
    const planAgain = (await (await post(app, "/api/taxonomy/plan", {})).json()) as RetagPlanView;
    expect(planAgain.fullCount).toBe(0);
    expect(planAgain.incrementalCount).toBe(0);
    expect(planAgain.unchanged).toBe(1);
    expect(planAgain.estimatedCalls).toBe(0);
  });

  it("没配库路径时明确拒绝，而不是当成空库跑一遍", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-taxonomy-nopath-"));
    cleanupDirs.push(root);
    const dataDir = join(root, "data");
    await mkdir(dataDir, { recursive: true });
    const app = createApp(createDatabase(dataDir), {
      dataDir,
      uploadsDir: join(dataDir, "uploads"),
      maxUploadMb: 10,
      docsDir: join(root, "docs"),
    });
    const res = await post(app, "/api/taxonomy/plan", {});
    expect(res.status).toBe(400);
  });

  it("库路径不存在时报错，而不是报「全库 0 篇」", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-taxonomy-badpath-"));
    cleanupDirs.push(root);
    const dataDir = join(root, "data");
    await mkdir(dataDir, { recursive: true });
    const app = createApp(createDatabase(dataDir), {
      dataDir,
      uploadsDir: join(dataDir, "uploads"),
      maxUploadMb: 10,
      docsDir: join(root, "docs"),
    });
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsidian: { vaultPath: join(root, "并不存在的库"), tagTaxonomy: { 领域: ["AI"] } } }),
    });
    const res = await post(app, "/api/taxonomy/plan", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("库路径不存在");
  });

  it("缺 AI 密钥时不发车", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-taxonomy-nokey-"));
    cleanupDirs.push(root);
    const dataDir = join(root, "data");
    await mkdir(dataDir, { recursive: true });
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    const app = createApp(createDatabase(dataDir), {
      dataDir,
      uploadsDir: join(dataDir, "uploads"),
      maxUploadMb: 10,
      docsDir: join(root, "docs"),
    });
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsidian: { vaultPath: vault, tagTaxonomy: { 领域: ["AI"] } } }),
    });
    const res = await post(app, "/api/taxonomy/run", {});
    expect(res.status).toBe(400);
  });
});
