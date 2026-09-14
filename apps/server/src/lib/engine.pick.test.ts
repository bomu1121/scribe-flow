import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { collectSegmentOptions, fileSegmentKey, parseGraph, segmentKey, stalePickKeys } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { projects, runNodeInputs, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";

/**
 * 素材挑选（段级分流）：多个素材汇入同一节点时，只加工其中几个，未选中的连同下游一并跳过。
 *
 * 用例刻意只用「文本来源」搭链路：B 站来源会真的发起网络请求，测试必须离线可跑。
 * B 站/本地文件的下载前跳过由 isSourceOutputNeeded 的单元用例覆盖。
 */

const tmpDirs: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

/** 三份文稿，等价于「一张多选来源卡承载三个素材」。 */
function textSources() {
  return [
    { id: "n_a", type: "source.text" as const, position: { x: 0, y: 0 }, data: { label: "甲文稿", text: "甲：第一条的内容。" } },
    { id: "n_b", type: "source.text" as const, position: { x: 0, y: 120 }, data: { label: "乙文稿", text: "乙：第二条的内容。" } },
    { id: "n_c", type: "source.text" as const, position: { x: 0, y: 240 }, data: { label: "丙文稿", text: "丙：第三条的内容。" } },
  ];
}

const sourceIds = ["n_a", "n_b", "n_c"];

function mergeNode(pick?: Record<string, string[]>) {
  return {
    id: "n_merge",
    type: "process.merge" as const,
    position: { x: 480, y: 0 },
    data: { label: "合并", title: "挑选测试", ...(pick ? { pick } : {}) },
  };
}

function outputNode() {
  return { id: "n_out", type: "process.output" as const, position: { x: 780, y: 0 }, data: { label: "输出", fileName: "picked.md" } };
}

const edges = [
  ...sourceIds.map((id, i) => ({ id: `e${i}`, source: id, target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" })),
  { id: "e_out", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
];

async function runGraph(pick: Record<string, string[]> | undefined, tag: string) {
  const dataDir = await mkdtemp(join(tmpdir(), `scribe-${tag}-`));
  tmpDirs.push(dataDir);
  const db = createDatabase(dataDir);
  const projectId = `prj_${tag}`;
  const runId = `run_${tag}`;
  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [...textSources(), mergeNode(pick), outputNode()],
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const now = Date.now();
  db.insert(projects)
    .values({ id: projectId, name: tag, description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  const engine = new RunEngine(db, dataDir);
  engine.start(runId, projectId, graph, "all");
  const deadline = Date.now() + 8000;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row).toBeTruthy();
  return { db, runId, dataDir };
}

describe("素材挑选：节点只加工选中的素材", () => {
  it("未配置挑选时全部素材照常进入（现有行为不变）", async () => {
    const { db, runId } = await runGraph(undefined, "pick-default");

    const rows = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.excluded === false)).toBe(true);
    // 每个素材都带着身份落库，供下游与结果页识别
    expect(rows.map((r) => r.itemKey)).toEqual(["node:n_a", "node:n_b", "node:n_c"]);
    // 没配挑选就不该刷「跳过」日志
    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    expect(logs.some((l) => l.content.includes("素材挑选"))).toBe(false);

    const out = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_out"))).get();
    expect(out?.status).toBe("done");
  });

  it("只选中的素材进入节点，未选中的不产出且记录为 excluded", async () => {
    const { db, runId, dataDir } = await runGraph({ n_b: [] , n_a: ["node:n_a"], n_c: ["node:n_c"] }, "pick-subset");

    const rows = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    const consumed = rows.filter((r) => !r.excluded);
    const excluded = rows.filter((r) => r.excluded);
    expect(consumed.map((r) => r.itemKey).sort()).toEqual(["node:n_a", "node:n_c"]);
    expect(excluded.map((r) => r.itemKey)).toEqual(["node:n_b"]);
    // 排除行不参与「本节点消费了什么」的展示，因此不带正文
    expect(excluded[0].text).toBeNull();

    // 最终产物里确实没有乙的内容——挑选不是只影响状态显示
    const out = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_out"))).get();
    expect(out?.status).toBe("done");
    const markdown = await readFile(join(dataDir, out!.outputPath!), "utf8");
    expect(markdown).toContain("甲：第一条的内容。");
    expect(markdown).toContain("丙：第三条的内容。");
    expect(markdown).not.toContain("乙：第二条的内容。");

    // 摘要必须点明「本次只处理了 2/3 段」，否则结果页看起来像丢内容
    const mergeRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_merge"))).get();
    expect(mergeRow?.summary).toContain("处理 2/3 段");
    expect(mergeRow?.summary).toContain("跳过 1 段");

    const logs = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).all();
    const pickLog = logs.find((l) => l.content.includes("素材挑选"));
    expect(pickLog?.content).toContain("跳过 1 段");
    expect(pickLog?.content).toContain("node:n_b");
  });

  it("全部排除时拒绝执行，并给出可操作的提示", async () => {
    const { db, runId } = await runGraph({ n_a: [], n_b: [], n_c: [] }, "pick-none");

    const mergeRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_merge"))).get();
    expect(mergeRow?.status).toBe("error");
    expect(String(mergeRow?.error)).toMatch(/素材挑选没有选中任何素材/);
    // 下游不产出文件，避免「静默跑出一份空笔记」
    const out = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_out"))).get();
    expect(out?.outputPath ?? null).toBeNull();
  });
});

describe("素材挑选：界面侧的依据", () => {
  it("多素材链路才给出可选项；单素材链路没有可挑的余地", () => {
    const multi = parseGraph({
      schemaVersion: 1,
      nodes: [...textSources(), mergeNode(), outputNode()],
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const options = collectSegmentOptions(multi, "n_merge");
    expect(options.map((o) => o.key)).toEqual(["node:n_a", "node:n_b", "node:n_c"]);
    expect(options.map((o) => o.title)).toEqual(["甲文稿", "乙文稿", "丙文稿"]);

    const single = parseGraph({
      schemaVersion: 1,
      nodes: [textSources()[0], mergeNode()],
      edges: [{ id: "e0", source: "n_a", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(collectSegmentOptions(single, "n_merge")).toEqual([]);
  });

  it("上游换过选区后，失效的挑选键会被点名", () => {
    const graph = parseGraph({
      schemaVersion: 1,
      nodes: [...textSources(), mergeNode()],
      edges: edges.slice(0, 3),
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const options = collectSegmentOptions(graph, "n_merge");
    expect(stalePickKeys(options, { n_a: ["node:n_a"], n_b: ["node:n_gone"] })).toEqual(["node:n_gone"]);
    expect(stalePickKeys(options, { n_a: ["node:n_a"] })).toEqual([]);
  });
});

describe("素材段标识", () => {
  it("B 站按 bvid+分P，本地文件按 fileId，文本按来源节点，三者互不冲突", () => {
    expect(segmentKey("n_src", { bvid: "BV1xx", page: 3 })).toBe("bvid:BV1xx:3");
    expect(segmentKey("n_src", { bvid: "BV1xx", cid: 99 })).toBe("bvid:BV1xx:cid99");
    expect(segmentKey("n_src", {})).toBe("node:n_src");
    expect(fileSegmentKey({ fileId: "f_1", fileName: "a.mp4" })).toBe("file:f_1");
    expect(fileSegmentKey({ fileName: "a.mp4" })).toBe("file:a.mp4");
  });
});
