import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUN_INTERRUPTED_ERROR, createDatabase, recoverInterruptedRuns, type AppDatabase } from "./client";
import { runNodeLogs, runNodeResults, runs } from "./schema";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup(): Promise<AppDatabase> {
  const root = await mkdtemp(join(tmpdir(), "sf-recover-"));
  dirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  return createDatabase(dataDir);
}

type RunStatusValue = "running" | "success" | "error" | "cancelled" | "interrupted";
type NodeStatusValue = "queued" | "running" | "done" | "error" | "cancelled" | "skipped";

/** 造一条运行与它的节点结果。形状照着「4 个观点提炼跑成 2 个就被服务重启掐断」的那次。 */
function seed(
  db: AppDatabase,
  options: {
    id: string;
    status: RunStatusValue;
    error?: string;
    summary?: string;
    nodes: Array<NodeStatusValue | { status: NodeStatusValue; label?: string; summary?: string }>;
  },
) {
  const now = Date.now();
  db.insert(runs)
    .values({ id: options.id, projectId: "p1", status: options.status, scope: "all", createdAt: now - 1000, error: options.error, summary: options.summary })
    .run();
  options.nodes.forEach((node, index) => {
    const shape = typeof node === "string" ? { status: node } : node;
    db.insert(runNodeResults)
      .values({
        id: `${options.id}:n${index}`,
        runId: options.id,
        nodeId: `n${index}`,
        nodeType: "process.prompt",
        nodeLabel: shape.label,
        status: shape.status,
        summary: shape.summary,
        elapsedMs: 0,
        updatedAt: now,
      })
      .run();
  });
}

function readRun(db: AppDatabase, id: string) {
  return db.select().from(runs).all().find((row) => row.id === id)!;
}

function readNodes(db: AppDatabase, runId: string) {
  return db.select().from(runNodeResults).all().filter((row) => row.runId === runId).map((row) => ({ nodeId: row.nodeId, status: row.status }));
}

describe("recoverInterruptedRuns", () => {
  it("残留 running 收尾为 interrupted（不是 cancelled）：没人点过停止", async () => {
    const db = await setup();
    seed(db, { id: "r_run", status: "running", nodes: ["done", "done", "running", "queued"] });

    recoverInterruptedRuns(db);

    const row = readRun(db, "r_run");
    expect(row.status).toBe("interrupted");
    expect(row.error).toBe(RUN_INTERRUPTED_ERROR);
    expect(row.finishedAt).not.toBeNull();
    expect(row.elapsedMs).toBeGreaterThanOrEqual(1000);
  });

  it("摘要写出已完成的节点数，中断的运行在列表里才看出它产出过东西", async () => {
    const db = await setup();
    seed(db, { id: "r_part", status: "running", nodes: ["done", "done", "running", "queued"] });
    seed(db, { id: "r_none", status: "running", nodes: ["running", "queued"] });

    recoverInterruptedRuns(db);

    expect(readRun(db, "r_part").summary).toBe("2 个节点已完成");
    expect(readRun(db, "r_none").summary).toBe("没有节点完成");
  });

  it("已完成/已失败的节点不动，只掐断半途的", async () => {
    const db = await setup();
    seed(db, { id: "r_mix", status: "running", nodes: ["done", "error", "running", "queued", "skipped"] });

    recoverInterruptedRuns(db);

    expect(readNodes(db, "r_mix")).toEqual([
      { nodeId: "n0", status: "done" },
      { nodeId: "n1", status: "error" },
      { nodeId: "n2", status: "cancelled" },
      { nodeId: "n3", status: "cancelled" },
      { nodeId: "n4", status: "skipped" },
    ]);
  });

  it("历史里被写成 cancelled 的中断运行改回 interrupted，并补上当时没写的摘要", async () => {
    const db = await setup();
    seed(db, { id: "r_legacy", status: "cancelled", error: RUN_INTERRUPTED_ERROR, nodes: ["done"] });

    recoverInterruptedRuns(db);

    const row = readRun(db, "r_legacy");
    expect(row.status).toBe("interrupted");
    expect(row.summary).toBe("1 个节点已完成");
    expect(row.error).toBe(RUN_INTERRUPTED_ERROR);
  });

  it("用户自己停的运行保持 cancelled，不会被改写成「已中断」", async () => {
    const db = await setup();
    seed(db, { id: "r_stop", status: "cancelled", error: "已手动强制结束", nodes: ["done", "cancelled"] });

    recoverInterruptedRuns(db);

    const row = readRun(db, "r_stop");
    expect(row.status).toBe("cancelled");
    expect(row.error).toBe("已手动强制结束");
    expect(row.summary).toBeNull();
  });

  it("跑完/失败的运行一律不动，反复调用也不改结果（幂等）", async () => {
    const db = await setup();
    seed(db, { id: "r_ok", status: "success", summary: "视频转笔记(单线).md · 6753 字", nodes: ["done"] });
    seed(db, { id: "r_bad", status: "error", error: "转写失败：请求超时", nodes: ["error"] });

    recoverInterruptedRuns(db);
    recoverInterruptedRuns(db);

    expect(readRun(db, "r_ok")).toMatchObject({ status: "success", summary: "视频转笔记(单线).md · 6753 字" });
    expect(readRun(db, "r_bad")).toMatchObject({ status: "error", error: "转写失败：请求超时" });
  });
});

function readLogs(db: AppDatabase, runId: string) {
  return db.select().from(runNodeLogs).all().filter((row) => row.runId === runId);
}

describe("收尾时写进运行日志的「中断现场」", () => {
  it("记下断在哪个节点、什么进度、已完成多少、以及去哪里看服务日志", async () => {
    const db = await setup();
    seed(db, {
      id: "r_scene",
      status: "running",
      nodes: ["done", "done", { status: "running", label: "信息溯源 · 上网查证", summary: "核查判断 30/34 96%" }, "queued"],
    });

    const briefs = recoverInterruptedRuns(db, { serviceLogPath: "D:\\data\\logs\\service.log", now: Date.now() });

    const logs = readLogs(db, "r_scene");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: "error", nodeId: "n2" });
    expect(logs[0].content).toContain("服务重启：运行已中断");
    expect(logs[0].content).toMatch(/中断时间 \d{4}\//);
    expect(logs[0].content).toContain("中断时正在运行「信息溯源 · 上网查证」：核查判断 30/34 96%");
    expect(logs[0].content).toContain("中断之前完成的 2 个节点的产物都还在");
    expect(logs[0].content).toContain("D:\\data\\logs\\service.log");
    expect(briefs).toEqual([
      {
        runId: "r_scene",
        projectId: "p1",
        nodeId: "n2",
        nodeLabel: "信息溯源 · 上网查证",
        progress: "核查判断 30/34 96%",
        cancelledNodes: 2,
      },
    ]);
  });

  it("带上该节点最后一条日志的时间：中间沉默了多久是排查要看的第一件事", async () => {
    const db = await setup();
    const now = Date.now();
    seed(db, { id: "r_quiet", status: "running", nodes: [{ status: "running", label: "转写" }] });
    db.insert(runNodeLogs)
      .values({ id: "log1", runId: "r_quiet", nodeId: "n0", kind: "info", content: "抓正文示例 成功", createdAt: now - 300_000 })
      .run();

    recoverInterruptedRuns(db, { now });

    const content = readLogs(db, "r_quiet").find((row) => row.kind === "error")?.content ?? "";
    expect(content).toContain("该节点最后一条日志写于");
  });

  it("没有任何节点结果的运行只收尾状态，不写指不到节点的日志", async () => {
    const db = await setup();
    seed(db, { id: "r_empty", status: "running", nodes: [] });

    const briefs = recoverInterruptedRuns(db);

    expect(readRun(db, "r_empty").status).toBe("interrupted");
    expect(readLogs(db, "r_empty")).toHaveLength(0);
    expect(briefs).toEqual([{ runId: "r_empty", projectId: "p1", cancelledNodes: 0 }]);
  });

  it("备份恢复用自己的说法，不把账记成服务重启", async () => {
    const db = await setup();
    seed(db, { id: "r_restore", status: "running", nodes: [{ status: "running", label: "AI 校对" }] });

    recoverInterruptedRuns(db, { reason: "从备份恢复" });

    const content = readLogs(db, "r_restore")[0]?.content ?? "";
    expect(content).toContain("从备份恢复：运行已中断");
    expect(content).not.toContain("服务重启");
  });
});
