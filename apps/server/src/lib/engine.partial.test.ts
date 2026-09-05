import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parseGraph } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { projects, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";

const tmpDirs: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilFinished(db: ReturnType<typeof createDatabase>, runId: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row).toBeTruthy();
  expect(row!.status).not.toBe("running");
}

afterEach(async () => {
  // sqlite 句柄可能在 Windows 上短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

describe("RunEngine 部分成功调度", () => {
  it("一个上游失败、另一个上游成功时，下游用可用输入继续执行而不是整条跳过", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-partial-"));
    tmpDirs.push(dataDir);
    const db = createDatabase(dataDir);
    const projectId = "prj_partial_test";
    const runId = "run_partial_test";

    const graph = parseGraph({
      schemaVersion: 1,
      nodes: [
        { id: "n_bad", type: "source.text", position: { x: 0, y: 0 }, data: { label: "坏文稿", text: "" } },
        { id: "n_good", type: "source.text", position: { x: 0, y: 180 }, data: { label: "好文稿", text: "这是成功那一路的正文内容。" } },
        { id: "n_out", type: "process.output", position: { x: 480, y: 0 }, data: { label: "输出", fileName: "partial.md" } },
        { id: "n_orphan", type: "process.output", position: { x: 480, y: 300 }, data: { label: "孤儿输出", fileName: "orphan.md" } },
      ],
      edges: [
        { id: "e_bad", source: "n_bad", target: "n_out", sourceHandle: "transcript", targetHandle: "noteDoc" },
        { id: "e_good", source: "n_good", target: "n_out", sourceHandle: "transcript", targetHandle: "noteDoc" },
        { id: "e_orphan", source: "n_bad", target: "n_orphan", sourceHandle: "transcript", targetHandle: "noteDoc" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    const now = Date.now();
    db.insert(projects)
      .values({ id: projectId, name: "部分成功测试", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
      .run();
    db.insert(runs)
      .values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) })
      .run();

    const engine = new RunEngine(db, dataDir);
    engine.start(runId, projectId, graph, "all");

    const deadline = Date.now() + 8000;
    let runRow = db.select().from(runs).where(eq(runs.id, runId)).get();
    while ((!runRow || runRow.status === "running") && Date.now() < deadline) {
      await sleep(25);
      runRow = db.select().from(runs).where(eq(runs.id, runId)).get();
    }
    expect(runRow).toBeTruthy();
    expect(runRow!.status).not.toBe("running");

    const rows = db.select().from(runNodeResults).where(eq(runNodeResults.runId, runId)).all();
    const byNode = new Map(rows.map((r) => [r.nodeId, r]));

    // 失败源自身标红
    expect(byNode.get("n_bad")?.status).toBe("error");

    // 成功源正常完成
    expect(byNode.get("n_good")?.status).toBe("done");

    // 关键：混合上游时下游用成功输入继续，输出文件真实落盘且内容来自成功那一路
    const out = byNode.get("n_out");
    expect(out?.status).toBe("done");
    expect(out?.error).toBeNull();
    expect(out?.outputPath).toBe(`outputs/${runId}/partial.md`);
    const content = await readFile(join(dataDir, out!.outputPath!), "utf8");
    expect(content).toContain("这是成功那一路的正文内容。");

    // 全部上游都失败（无可用输入）时仍跳过，且点名失败的上游
    const orphan = byNode.get("n_orphan");
    expect(orphan?.status).toBe("skipped");
    expect(orphan?.error).toContain("上游失败，跳过");
    expect(orphan?.error).toContain("坏文稿");

    // 运行整体仍标记失败并点名失败节点
    expect(runRow!.status).toBe("error");
    expect(runRow!.error).toContain("部分节点执行失败");
    expect(runRow!.error).toContain("坏文稿");
  });

  it("fromNode 只重跑目标节点及其下游，不重跑上游", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-fromnode-"));
    tmpDirs.push(dataDir);
    const db = createDatabase(dataDir);
    const projectId = "prj_fromnode_test";

    const graph = parseGraph({
      schemaVersion: 1,
      nodes: [
        { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: "上游内容保持不变。" } },
        { id: "n_merge", type: "process.merge", position: { x: 0, y: 180 }, data: { label: "合并", title: "测试笔记" } },
        { id: "n_out", type: "process.output", position: { x: 480, y: 0 }, data: { label: "输出", fileName: "fromnode.md" } },
      ],
      edges: [
        { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
        { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const now = Date.now();
    db.insert(projects)
      .values({ id: projectId, name: "fromNode 测试", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
      .run();

    const engine = new RunEngine(db, dataDir);
    const runAll = "run_fromnode_all";
    db.insert(runs)
      .values({ id: runAll, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) })
      .run();
    engine.start(runAll, projectId, graph, "all");
    await waitUntilFinished(db, runAll);

    const runFrom = "run_fromnode_from";
    db.insert(runs)
      .values({ id: runFrom, projectId, status: "running", scope: "fromNode", nodeId: "n_merge", createdAt: now + 1, graphJson: JSON.stringify(graph) })
      .run();
    engine.start(runFrom, projectId, graph, "fromNode", "n_merge");
    await waitUntilFinished(db, runFrom);

    const rows = db.select().from(runNodeResults).where(eq(runNodeResults.runId, runFrom)).all();
    const byNode = new Map(rows.map((r) => [r.nodeId, r]));
    // 上游 source.text 不在 fromNode 范围内：本次运行不应有它的行
    expect(byNode.has("n_src")).toBe(false);
    // 目标节点与下游都重跑成功，且下游拿到的是本次新结果
    expect(byNode.get("n_merge")?.status).toBe("done");
    expect(byNode.get("n_out")?.status).toBe("done");
    const runRow = db.select().from(runs).where(eq(runs.id, runFrom)).get();
    expect(runRow!.status).toBe("success");
    // finishRun 在存在 noteDoc 输出时用输出节点摘要，而不是"N 个节点完成"
    expect(runRow!.summary).toContain("fromnode.md");
  });
});
