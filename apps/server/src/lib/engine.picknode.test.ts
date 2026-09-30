import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { collectSegmentOptions, parseGraph } from "@scribe-flow/shared";
import { createDatabase } from "../db/client";
import { projects, runNodeInputs, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";
import { sleep } from "./sleep";

/**
 * 「素材挑选」节点（flow.pick）：接在上游模块之后，识别它给出的那一堆素材，
 * 只放行勾选的几段，其余不往下走。
 *
 * 用例用「多份文稿」搭链路，保证离线可跑（B 站来源会真发网络请求）。
 */

const tmpDirs: string[] = [];

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

/** 「一个输入一份结果」的中间模块（文本工具）；用来把挑选与来源卡隔开一层。 */
const textToolNode = (id: string, x = 320) => ({
  id,
  type: "process.text" as const,
  position: { x, y: 120 },
  data: { label: "文本工具", operation: "cleanup" },
});

/** 同上，但换成 AI 校对——与用户真实工程的形状一致（`B站链接 → 转写 → … → 挑选`）。 */
const refineNode = (id: string, x = 320) => ({
  id,
  type: "process.refine" as const,
  position: { x, y: 120 },
  data: { label: "AI 校对" },
});

/**
 * 挑选与来源卡之间隔着中间模块——这是真实工程的形状（用户的工程是「B站合集 → 转写 → 挑选 → 校对」）。
 *
 * 界面写进挑选表的是**来源卡**的 id（`collectSegmentOptions` 的 `originNodeId`），
 * 而运行时的直接上游是中间模块；引擎若按直接上游查表就会落空，
 * 落空的语义恰好是「全选」——挑选静默失效，节点上还写着「放行 3/3 段」。
 */
describe("素材挑选节点：与来源卡之间隔着中间模块", () => {
  const chainedNodes = () => [
    ...textSources(),
    textToolNode("n_text"),
    pickNode("n_pick", undefined, 620),
    mergeNode("n_merge", undefined, 900),
    outputNode(),
  ];
  const chainedEdges = [
    { id: "e1", source: "n_1", target: "n_text", sourceHandle: "transcript", targetHandle: "in" },
    { id: "e2", source: "n_2", target: "n_text", sourceHandle: "transcript", targetHandle: "in" },
    { id: "e3", source: "n_3", target: "n_text", sourceHandle: "transcript", targetHandle: "in" },
    { id: "et", source: "n_text", target: "n_pick", sourceHandle: "out", targetHandle: "in" },
    { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
    { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
  ];

  it("按来源卡查表：取消第二张卡后只放行 2/3 段", async () => {
    const nodes = chainedNodes();
    // 挑选表由界面那套 API 生成（PickCard.vue 的 writePick 就是这么写）：键是来源卡 id，
    // 被取消的那张卡写空数组。这里顺带断言「界面看到的是三张来源卡，不是文本工具」。
    const options = collectSegmentOptions(
      parseGraph({ schemaVersion: 1, nodes, edges: chainedEdges, viewport: { x: 0, y: 0, zoom: 1 } }),
      "n_pick",
    );
    expect(options.map((o) => o.originNodeId)).toEqual(["n_1", "n_2", "n_3"]);
    nodes[4].data = { label: "素材挑选", pick: { n_2: [] } };

    const { db, runId } = await runGraph(nodes, chainedEdges, "picknode-chained");

    const pickRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_pick"))).get();
    expect(pickRow?.status).toBe("done");
    expect(pickRow?.summary).toContain("放行 2/3 段");

    const mergeInputs = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    expect(mergeInputs.map((r) => r.itemKey)).toEqual(["node:n_1", "node:n_3"]);

    // 被排除的那段：记的是**直接上游**（文本工具），而挑选表的键是来源卡 n_2——两者不同正是这个用例的意义
    const excluded = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runId), eq(runNodeInputs.targetNodeId, "n_pick"), eq(runNodeInputs.excluded, true)))
      .all();
    expect(excluded.map((r) => [r.sourceNodeId, r.itemKey])).toEqual([["n_text", "node:n_2"]]);
  });

  it("从挑选节点单独重跑（scope=fromNode）：上游产物的段身份仍能还原，挑选照旧生效", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scribe-picknode-from-"));
    tmpDirs.push(dataDir);
    const db = createDatabase(dataDir);
    const projectId = "prj_picknode_from";
    const now = Date.now();

    const graph = parseGraph({
      schemaVersion: 1,
      nodes: [
        ...textSources(),
        refineNode("n_refine"),
        // 与真实工程同形：挑选表按来源卡记键（未配置的来源=全选，所以「都不要」写空数组）
        pickNode("n_pick", { n_1: ["node:n_1"], n_2: [], n_3: ["node:n_3"] }, 620),
        mergeNode("n_merge", undefined, 900),
        outputNode(),
      ],
      edges: [
        { id: "e1", source: "n_1", target: "n_refine", sourceHandle: "transcript", targetHandle: "transcript" },
        { id: "e2", source: "n_2", target: "n_refine", sourceHandle: "transcript", targetHandle: "transcript" },
        { id: "e3", source: "n_3", target: "n_refine", sourceHandle: "transcript", targetHandle: "transcript" },
        { id: "et", source: "n_refine", target: "n_pick", sourceHandle: "transcript", targetHandle: "in" },
        { id: "ep", source: "n_pick", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" },
        { id: "eo", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    db.insert(projects)
      .values({ id: projectId, name: "挑选 fromNode", description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
      .run();

    // 造一次「上次跑过」的记录：fromNode 路径就是从这两张表还原上游产物，
    // 所以这里种的是转写/校对那类节点真实会落下的行（不真跑，省掉 AI 调用）。
    const seededRun = "run_picknode_seed";
    db.insert(runs).values({ id: seededRun, projectId, status: "success", scope: "all", createdAt: now, finishedAt: now + 1, graphJson: JSON.stringify(graph) }).run();
    db.insert(runNodeResults)
      .values({
        id: "res_seed_refine",
        runId: seededRun,
        nodeId: "n_refine",
        nodeType: "process.refine",
        status: "done",
        outputKind: "text",
        outputText: "一：第一份校对稿。\n\n二：第二份校对稿。\n\n三：第三份校对稿。",
        updatedAt: now,
      })
      .run();
    ["node:n_1", "node:n_2", "node:n_3"].forEach((itemKey, position) => {
      db.insert(runNodeInputs)
        .values({
          id: `in_seed_${position}`,
          runId: seededRun,
          targetNodeId: "n_refine",
          sourceNodeId: `n_${position + 1}`,
          kind: "text",
          text: `第 ${position + 1} 份转写稿`,
          resultText: `第 ${position + 1} 份校对稿`,
          size: 8,
          position,
          itemKey,
          excluded: false,
          createdAt: now,
        })
        .run();
    });

    const runFrom = "run_picknode_from";
    db.insert(runs).values({ id: runFrom, projectId, status: "running", scope: "fromNode", nodeId: "n_pick", createdAt: now + 2, graphJson: JSON.stringify(graph) }).run();
    new RunEngine(db, dataDir).start(runFrom, projectId, graph, "fromNode", "n_pick");
    const deadline = Date.now() + 8000;
    let runRow = db.select().from(runs).where(eq(runs.id, runFrom)).get();
    while ((!runRow || runRow.status === "running") && Date.now() < deadline) {
      await sleep(25);
      runRow = db.select().from(runs).where(eq(runs.id, runFrom)).get();
    }
    expect(runRow?.status).not.toBe("running");

    // 上游三份被还原成三份（而不是一份合并产物），且带着原始段标识——
    // 少了段标识，挑选表里那两个键一个都匹配不上，会退化成「全选」把三份全放行。
    const pickedInputs = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runFrom), eq(runNodeInputs.targetNodeId, "n_pick")))
      .orderBy(runNodeInputs.position)
      .all();
    expect(pickedInputs.map((r) => r.itemKey).sort()).toEqual(["node:n_1", "node:n_2", "node:n_3"]);
    // 放行顺序与来源顺序一致；被排除那段记在案（位置排在放行的之后）
    expect(pickedInputs.filter((r) => !r.excluded).map((r) => r.itemKey)).toEqual(["node:n_1", "node:n_3"]);
    expect(pickedInputs.filter((r) => r.excluded).map((r) => r.itemKey)).toEqual(["node:n_2"]);

    const pickRow = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runFrom), eq(runNodeResults.nodeId, "n_pick"))).get();
    expect(pickRow?.status).toBe("done");
    expect(pickRow?.summary).toContain("放行 2/3 段");

    const mergeInputs = db
      .select()
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, runFrom), eq(runNodeInputs.targetNodeId, "n_merge")))
      .all();
    expect(mergeInputs.map((r) => r.itemKey)).toEqual(["node:n_1", "node:n_3"]);
  });
});
