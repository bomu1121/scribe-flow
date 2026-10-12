import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import { parseGraph, type RunEvent, type WorkflowGraph } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { appSettings, projects, runs } from "../db/schema";
import { RunEngine } from "./engine";
import { sleep } from "./sleep";

/**
 * 强制结束的收尾契约：forceStop 立即写库并发 run.done，随后 runLoop 退出的
 * finishRun 不得再收尾一次（run.done 会重复、强制结束的文案会被覆盖）。
 * 用一个「收到请求但不回应」的假 AI 端点把节点挂住在运行中，制造可强停的窗口。
 */
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

function hangServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(() => {
    // 刻意不回应：请求挂住，直到 fetch 的 AbortSignal 因强停而中断
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server 启动失败");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function textToPromptGraph(): WorkflowGraph {
  return parseGraph({
    schemaVersion: 1,
    nodes: [
      { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: "一段正文。" } },
      { id: "n_prompt", type: "process.prompt", position: { x: 220, y: 0 }, data: { label: "AI 加工" } },
    ],
    edges: [{ id: "e0", source: "n_src", target: "n_prompt", sourceHandle: "transcript", targetHandle: "transcript" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

describe("强制结束只收尾一次", () => {
  it("run.done 恰好一次，库里的强制结束文案不被覆盖", async () => {
    const ai = await hangServer();
    try {
      const root = await mkdtemp(join(tmpdir(), "sf-forcestop-"));
      tmpDirs.push(root);
      const dataDir = join(root, "data");
      await mkdir(dataDir, { recursive: true });
      const db = createDatabase(dataDir);
      const graph = textToPromptGraph();
      const projectId = "prj_forcestop";
      const now = Date.now();
      db.insert(projects).values({ id: projectId, name: "强停测试", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now }).run();
      for (const [key, value] of [
        ["ai.provider", "custom"],
        ["ai.baseUrl", ai.baseUrl],
        ["ai.model", "mock-model"],
        ["ai.apiKey", "mock-key"],
      ] as const) {
        db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } }).run();
      }

      const runId = "run_forcestop";
      db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
      const engine = new RunEngine(db, dataDir);
      const events: RunEvent[] = [];
      engine.start(runId, projectId, graph, "all");
      engine.subscribe(runId, (event) => events.push(event));

      // 等到 AI 节点真的挂在请求上再强停
      await sleep(150);
      expect(engine.forceStop(runId)).toBe(true);

      const deadline = Date.now() + 8000;
      let row = db.select().from(runs).where(eq(runs.id, runId)).get();
      while (Date.now() < deadline) {
        row = db.select().from(runs).where(eq(runs.id, runId)).get();
        if (row && row.status !== "running") break;
        await sleep(25);
      }
      // 给 runLoop 的退出路径留出「若未防住就会再发一次 run.done」的时间
      await sleep(250);

      expect(row?.status).toBe("cancelled");
      expect(row?.error).toContain("已手动强制结束");
      const doneEvents = events.filter((event) => event.type === "run.done");
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0]?.status).toBe("cancelled");
    } finally {
      await ai.close();
    }
  });
});
