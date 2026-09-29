/**
 * 「AI 能不能自己连画布」的守卫实验。
 *
 * 做法：把一份合法的工作流图施加**每一种可能的违反**，逐条问「谁在守这条约束」。
 * 约束清单是从代码里推的（不是从模型输出统计的——没有 API key，也没跑模型）。
 *
 * 从仓库根目录跑：
 *   node node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs sharing/tools/graph-guards.ts
 */
import { graphSchema } from "../../packages/shared/src/schema";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType, type WorkflowGraph } from "../../packages/shared/src/graph";
import { canConnectSpecs, type PortSpec } from "../../packages/shared/src/port";
import { WORKFLOW_TEMPLATES, buildTemplateGraph } from "../../packages/shared/src/templates";

type Graph = WorkflowGraph;
const clone = (g: Graph): Graph => JSON.parse(JSON.stringify(g)) as Graph;

// ───────── 三道（其实只有两道）守卫 ─────────
/** L1：保存与运行前都会走的图校验（`parseGraph` → 这个 schema）。 */
const L1 = (g: unknown) => graphSchema.safeParse(g).success;
/** L2：端口类型兼容。前端只在鼠标拖拽时调它，**数据路径上没有它**。 */
function L2(g: Graph): boolean {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t) continue;
    const sp = NODE_PORTS[s.type as NodeType]?.outputs.find((p: PortSpec) => p.id === e.sourceHandle);
    const tp = NODE_PORTS[t.type as NodeType]?.inputs.find((p: PortSpec) => p.id === e.targetHandle);
    if (!sp || !tp || !canConnectSpecs(sp, tp)) return false;
  }
  return true;
}
/** L3：有没有环。目前**没有任何一层做这件事**——这个函数是我写的，用来证明「能做，只是没做」。 */
function hasCycle(g: Graph): boolean {
  const adj = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) adj.get(e.source)?.push(e.target);
  const state = new Map<string, 0 | 1 | 2>(); // 0=没进过 1=在栈上 2=已完成
  const dfs = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const nx of adj.get(id) ?? []) if (dfs(nx)) return true;
    state.set(id, 2);
    return false;
  };
  return g.nodes.some((n) => dfs(n.id));
}

// ───────── 基线：9 条内置链路 × 3 种来源 ─────────
const base: Array<{ name: string; g: Graph }> = [];
for (const tpl of WORKFLOW_TEMPLATES) {
  for (const source of ["bili", "file", "text"] as const) {
    const g = buildTemplateGraph(tpl.id, { source });
    if (g) base.push({ name: `${tpl.name}/${source}`, g: g as Graph });
  }
}
// 前置断言：基线必须全部合法、无环、且类型全部兼容——否则这个实验的口径就是错的
for (const { name, g } of base) {
  if (!L1(g)) throw new Error(`前置断言失败：内置链路「${name}」没通过图校验`);
  if (!L2(g)) throw new Error(`前置断言失败：内置链路「${name}」有类型不兼容的连线`);
  if (hasCycle(g)) throw new Error(`前置断言失败：内置链路「${name}」里有环`);
}
console.log(`前置断言通过：${base.length} 张内置链路全部合法、类型兼容、无环\n`);

// ───────── 变异：每一种违反各做一遍 ─────────
type Case = { id: string; label: string; mutate: (g: Graph) => Graph | null };
const cases: Case[] = [
  {
    id: "bad-enum",
    label: "字段取值非法（章节粒度写成 \"huge\"）",
    mutate: (g) => {
      const n = g.nodes.find((x) => x.type === "process.chapter");
      if (!n) return null;
      const m = clone(g);
      m.nodes.find((x) => x.id === n.id)!.data.granularity = "huge" as never;
      return m;
    },
  },
  {
    id: "missing-required",
    label: "缺必填字段（章节节点删掉 granularity）",
    mutate: (g) => {
      const n = g.nodes.find((x) => x.type === "process.chapter");
      if (!n) return null;
      const m = clone(g);
      delete (m.nodes.find((x) => x.id === n.id)!.data as Record<string, unknown>).granularity;
      return m;
    },
  },
  {
    id: "bad-type-of-field",
    label: "字段类型错（字数上限写成字符串）",
    mutate: (g) => {
      const n = g.nodes.find((x) => x.type === "process.chapter");
      if (!n) return null;
      const m = clone(g);
      m.nodes.find((x) => x.id === n.id)!.data.maxChapters = "20" as never;
      return m;
    },
  },
  {
    id: "dup-node-id",
    label: "两个节点 id 相同",
    mutate: (g) => {
      if (g.nodes.length < 2) return null;
      const m = clone(g);
      m.nodes[1].id = m.nodes[0].id;
      return m;
    },
  },
  {
    id: "dup-edge-id",
    label: "两条连线 id 相同",
    mutate: (g) => {
      if (g.edges.length < 2) return null;
      const m = clone(g);
      m.edges[1].id = m.edges[0].id;
      return m;
    },
  },
  {
    id: "dangling-edge",
    label: "连线指向不存在的节点",
    mutate: (g) => {
      const m = clone(g);
      m.edges[0].target = "n_does_not_exist";
      return m;
    },
  },
  {
    id: "bad-handle",
    label: "连线用了不存在的端口",
    mutate: (g) => {
      const m = clone(g);
      m.edges[0].sourceHandle = "not-a-port";
      return m;
    },
  },
  {
    id: "self-loop",
    label: "自连（节点连自己）",
    mutate: (g) => {
      const n = g.nodes.find((x) => NODE_PORTS[x.type as NodeType].outputs.length > 0 && NODE_PORTS[x.type as NodeType].inputs.length > 0);
      if (!n) return null;
      const m = clone(g);
      m.edges.push({
        id: "e_self",
        source: n.id,
        target: n.id,
        sourceHandle: NODE_PORTS[n.type as NodeType].outputs[0].id,
        targetHandle: NODE_PORTS[n.type as NodeType].inputs[0].id,
      });
      return m;
    },
  },
  {
    id: "type-mismatch",
    label: "端口类型不兼容（把「文稿」接到「笔记块」口）",
    mutate: (g) => {
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      for (const e of g.edges) {
        const s = byId.get(e.source)!;
        const sp = NODE_PORTS[s.type as NodeType].outputs.find((p: PortSpec) => p.id === e.sourceHandle);
        if (!sp) continue;
        for (const cand of g.nodes) {
          if (cand.id === s.id || cand.id === e.target) continue;
          const tp = NODE_PORTS[cand.type as NodeType].inputs[0];
          if (!tp) continue;
          if (canConnectSpecs(sp, tp)) continue; // 只挑不兼容的
          const m = clone(g);
          const me = m.edges.find((x) => x.id === e.id)!;
          me.target = cand.id;
          me.targetHandle = tp.id;
          return m;
        }
      }
      return null;
    },
  },
  {
    id: "cycle",
    label: "成环（两个多类型端口节点互相连）",
    mutate: (g) => {
      // 找两个「输入接受 transcript」的节点，把它们接成一个环：前者 → 后者 → 前者
      const polys = g.nodes.filter(
        (n) => NODE_PORTS[n.type as NodeType].inputs.some((p: PortSpec) => p.accepts?.includes("transcript")),
      );
      if (polys.length < 2) return null; // 内置链路里多数只有 1 个多类型节点，不够就跳过（下面另有构造用例）
      const [a, b] = polys;
      const m = clone(g);
      m.edges.push({ id: "e_cycle", source: b.id, target: a.id, sourceHandle: NODE_PORTS[b.type as NodeType].outputs[0].id, targetHandle: NODE_PORTS[a.type as NodeType].inputs[0].id });
      return m;
    },
  },
];

console.log("【每个违反，各层守卫的判定】");
console.log("图例：✅=拦住了  ❌=放过去了");
console.log("  L1 = 图校验（`parseGraph` / `graphSchema`，保存与发起运行前都会走）");
console.log("  L2 = 端口类型兼容（`canConnectSpecs`，全仓只有 FlowCanvas.vue:299 一个调用点，挂在鼠标拖拽上）");
console.log("  L3 = 环检测（**产品里不存在这一层**；这列是我写的判断，用来证明它做得到——✅ 表示「若有就能拦住」）");
console.log("");
const summary: Array<{ label: string; applied: number; l1: number; l2: number; l3: number }> = [];
for (const c of cases) {
  let applied = 0, l1 = 0, l2 = 0, l3 = 0;
  for (const { g } of base) {
    const m = c.mutate(g);
    if (!m) continue;
    applied++;
    if (!L1(m)) l1++;
    if (!L2(m)) l2++;
    if (hasCycle(m)) l3++;
  }
  summary.push({ label: c.label, applied, l1, l2, l3 });
  const f = (n: number) => (applied === 0 ? " ——（造不出来，见下方构造用例）" : n === applied ? "  ✅" : n === 0 ? "  ❌" : ` ${n}/${applied}`);
  console.log(`  ${c.label.padEnd(38)} 适用 ${String(applied).padStart(2)} 张 │ L1${f(l1)} │ L2${f(l2)} │ L3${f(l3)}`);
}

// ───────── 成环：用一个构造用例把话说死 ─────────
// 内置链路里每张最多一个多类型节点，所以环在模板上造不出来；这里按真实节点类型自己搭一个。
console.log("\n【构造用例】文本 → 文本工具 → 素材挑选，再把「素材挑选」接回「文本工具」");
const cyclic: Graph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", position: { x: 0, y: 0 }, type: "source.text", data: { text: "x" } },
    { id: "n_text", position: { x: 200, y: 0 }, type: "process.text", data: { operation: "cleanup" } },
    { id: "n_pick", position: { x: 400, y: 0 }, type: "flow.pick", data: {} },
  ] as never,
  edges: [
    { id: "e1", source: "n_src", target: "n_text", sourceHandle: "transcript", targetHandle: "in" },
    { id: "e2", source: "n_text", target: "n_pick", sourceHandle: "out", targetHandle: "in" },
    { id: "e3", source: "n_pick", target: "n_text", sourceHandle: "out", targetHandle: "in" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};
console.log(`  L1 图校验：${L1(cyclic) ? "❌ 放过去了（这张图能存进工程、能发起运行）" : "✅ 拦住了"}`);
console.log(`  L2 端口类型：${L2(cyclic) ? "❌ 放过去了（三条边的类型都是兼容的）" : "✅ 拦住了"}`);
console.log(`  L3 环检测：${hasCycle(cyclic) ? "发现环（但没有人在调用这个判断）" : "没发现"}`);
// 复现引擎的排序规则（engine.ts:606-618：只有 visited、没有「在栈上」标记的 DFS）
const order: string[] = [];
{
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const e of cyclic.edges) if (e.target === id) visit(e.source);
    order.push(id);
  };
  for (const n of cyclic.nodes) visit(n.id);
}
console.log(`  引擎算出来的执行顺序：${order.map((id) => NODE_TYPE_LABELS[cyclic.nodes.find((n) => n.id === id)!.type as NodeType]).join(" → ")}`);
console.log(`  → 源头先跑完；剩下两个互为上游、isReadyToRun 都返回 false，且谁都没失败/跳过，`);
console.log(`     skipBlocked 也不会跳过它们 → 运行循环等不到可跑的节点，**空转不结束**（按代码路径推断，未真跑引擎）`);

// ───────── 汇总：没人守的约束 ─────────
console.log("\n【没人守的约束】");
const unguarded = summary.filter((s) => s.applied > 0 && s.l1 === 0 && s.l2 === 0);
for (const u of unguarded) console.log(`  · ${u.label}`);
console.log("  · 成环（见上：图校验放行、引擎空转）");
console.log("\n【只在鼠标上守着的约束】");
for (const s of summary.filter((x) => x.applied > 0 && x.l1 === 0 && x.l2 > 0)) console.log(`  · ${s.label} —— 拖拽时会拦，把图从别处（文件、模型）送进来时没人拦`);
