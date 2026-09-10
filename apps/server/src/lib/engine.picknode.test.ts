import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { collectSegmentOptions, parseGraph } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { projects, runNodeInputs, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";

/**
 * 「素材挑选」节点（flow.pick）：接在上游模块之后，识别它给出的那一堆素材，
 * 只放行勾选的几段，其余不往下走。
 *
 * 用例用「多份文稿」搭链路，保证离线可跑（B 站来源会真发网络请求）。
 */

const tmpDirs: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

/** 三份文稿，等价于「上游模块处理了 3 个输入」。 */
function textSources() {
  return [
    { id: "n_1", type: "source.text" as const, position: { x: 0, y: 0 }, data: { label: "第一份", text: "一：第一份的内容。" } },
    { id: "n_2", type: "source.text" as const, position: { x: 0, y: 120 }, data: { label: "第二份", text: "二：第二份的内容。" } },
    { id: "n_3", type: "source.text" as const, position: { x: 0, y: 240 }, data: { label: "第三份", text: "三：第三份的内容。" } },
  ];
}

function pickNode(id: string, pick?: Record<string, string[]>, x = 320) {
  return {
    id,
    type: "flow.pick" as const,
    position: { x, y: 120 },
    data: { label: "素材挑选", ...(pick ? { pick } : {}) },
  };
}

function mergeNode(id: string, pick: Record<string, string[]> | undefined, x: number) {
  return {
    id,
    type: "process.merge" as const,
    position: { x, y: 120 },
    data: { label: "合并", title: "挑选测试", ...(pick ? { pick } : {}) },
  };
}

const outputNode = () => ({
  id: "n_out",
  type: "process.output" as const,
  position: { x: 1200, y: 120 },
  data: { label: "输出", fileName: "picked.md" },
});

const toPickEdges = [1, 2, 3].map((i) => ({
  id: `e${i}`,
  source: `n_${i}`,
  target: "n_pick",
  sourceHandle: "transcript",
  targetHandle: "in",
}));

async function runGraph(nodes: unknown[], edges: unknown[], tag: string) {
  const dataDir = await mkdtemp(join(tmpdir(), `scribe-${tag}-`));
  tmpDirs.push(dataDir);
  const db = createDatabase(dataDir);
  const projectId = `prj_${tag}`;
  const runId = `run_${tag}`;
  const graph = parseGraph({ schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } });
  const now = Date.now();
  db.insert(projects)
    .values({ id: projectId, name: tag, description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  new RunEngine(db, dataDir).start(runId, projectId, graph, "all");
  const deadline = Date.now() + 8000;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row).toBeTruthy();
  return { db, runId, dataDir };
}

describe("素材挑选节点：只放行勾选的几段", () => {
  it("三份素材全部放行时，下游照常拿到三份（默认不挑）", async () => {
    const { db, runId } = await runGraph(
      [...textSources(), pickNode("n_pick"), mergeNode("n_merge", undefined, 700), outputNode()],
      [
        ...toPickEdges,
        { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
        { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      "picknode-all",
    );

    const pickRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_pick"))).get();
    expect(pickRow?.status).toBe("done");
    expect(pickRow?.summary).toContain("放行 3/3 段");

    const mergeInputs = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    expect(mergeInputs.length).toBe(3);
    // 关键：身份没有被换成 n_pick 的位置键，而是沿用了原始素材的段标识
    expect(mergeInputs.map((r) => r.itemKey)).toEqual(["node:n_1", "node:n_2", "node:n_3"]);
  });

  it("勾选两份后，只有这两份流到下游（第三份不进下游节点）", async () => {
    const keep = ["node:n_1", "node:n_3"];
    const { db, runId, dataDir } = await runGraph(
      [...textSources(), pickNode("n_pick", { n_1: ["node:n_1"], n_3: ["node:n_3"], n_2: [] }), mergeNode("n_merge", undefined, 700), outputNode()],
      [
        ...toPickEdges,
        { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
        { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      "picknode-subset",
    );

    const pickRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_pick"))).get();
    expect(pickRow?.status).toBe("done");
    expect(pickRow?.summary).toContain("放行 2/3 段");

    const mergeInputs = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    const consumed = mergeInputs.filter((r) => !r.excluded);
    expect(consumed.map((r) => r.itemKey)).toEqual(keep);
    // 被排除的那份记录在挑选节点上，注明「共几段、用了几段」
    const excluded = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_pick"), eq(runNodeInputs.excluded, true)))
      .all();
    expect(excluded.map((r) => r.itemKey)).toEqual(["node:n_2"]);

    const out = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_out"))).get();
    const markdown = await readFile(join(dataDir, out!.outputPath!), "utf8");
    expect(markdown).toContain("一：第一份的内容。");
    expect(markdown).toContain("三：第三份的内容。");
    expect(markdown).not.toContain("二：第二份的内容。");

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    expect(logs.some((l) => l.nodeId === "n_pick" && l.content.includes("跳过 1 段"))).toBe(true);
  });

  it("挑选节点之后还能再挑一次：下游按挑选节点放行后的集合挑（身份不被换成位置键）", async () => {
    // 挑选节点放行第 1、2 段；下游合并节点再从这两段里挑第 1 段
    const { db, runId } = await runGraph(
      [
        ...textSources(),
        pickNode("n_pick", { n_1: ["node:n_1"], n_2: ["node:n_2"], n_3: [] }),
        mergeNode("n_merge", { n_pick: ["node:n_1"] }, 700),
        outputNode(),
      ],
      [
        ...toPickEdges,
        { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
        { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      "picknode-chain",
    );

    const mergeInputs = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    const consumed = mergeInputs.filter((r) => !r.excluded);
    // 若身份在挑选节点处被重新派生（pos:n_pick:0/1），这里会一段都选不中
    expect(consumed.map((r) => r.itemKey)).toEqual(["node:n_1"]);
    expect(mergeInputs.filter((r) => r.excluded).map((r) => r.itemKey)).toEqual(["node:n_2"]);
  });

  it("一段都没勾时拒绝执行，并指出是哪个节点的挑选", async () => {
    const { db, runId } = await runGraph(
      [...textSources(), pickNode("n_pick", { n_1: [], n_2: [], n_3: [] }), mergeNode("n_merge", undefined, 700), outputNode()],
      [
        ...toPickEdges,
        { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
        { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      "picknode-none",
    );

    const pickRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_pick"))).get();
    expect(pickRow?.status).toBe("error");
    expect(String(pickRow?.error)).toMatch(/素材挑选没有选中任何素材/);
    // 不产出空笔记
    const out = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_out"))).get();
    expect(out?.outputPath ?? null).toBeNull();
  });
});

describe("素材挑选节点：连接时就识别上游集合", () => {
  it("挑选节点的卡片能列出上游三份素材（界面据此渲染勾选列表）", () => {
    const graph = parseGraph({
      schemaVersion: 1,
      nodes: [...textSources(), pickNode("n_pick"), mergeNode("n_merge", undefined, 700), outputNode()],
      edges: [
        ...toPickEdges,
        { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
        { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const options = collectSegmentOptions(graph, "n_pick");
    expect(options.map((o) => o.key)).toEqual(["node:n_1", "node:n_2", "node:n_3"]);
    expect(options.map((o) => o.title)).toEqual(["第一份", "第二份", "第三份"]);
  });
});
