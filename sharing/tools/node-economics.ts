/**
 * 「加一个节点值多少、付多少」的实测脚本。
 *
 * 从仓库根目录跑（tsx 在 pnpm 的虚拟目录里，先找到它的 cli.mjs）：
 *   node node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs sharing/tools/node-economics.ts
 * 装了 tsx 之后也可以：npx tsx sharing/tools/node-economics.ts
 *
 * 三部分：① 连线判定矩阵与可插入位置 ② 链路组合数（含口径警告） ③ 手写枚举清单
 * 每一步都有前置断言，口径不对就直接抛错——不拿失真的数字去讲。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType } from "../../packages/shared/src/graph";
import { canConnectSpecs, type PortSpec } from "../../packages/shared/src/port";
import { WORKFLOW_TEMPLATES, buildTemplateGraph } from "../../packages/shared/src/templates";

const ROOT = join(import.meta.dirname, "..", "..");
const types = Object.keys(NODE_PORTS) as NodeType[];
const label = (t: NodeType) => NODE_TYPE_LABELS[t];
const outToIn = (a: NodeType, b: NodeType) =>
  NODE_PORTS[a].outputs.some((o: PortSpec) => NODE_PORTS[b].inputs.some((i: PortSpec) => canConnectSpecs(o, i)));
const fmt = (n: number) => n.toLocaleString("en-US");

// ───────── 前置断言 ─────────
if (types.length !== 16) throw new Error(`前置断言失败：期望 16 种节点，实际 ${types.length}`);
for (const [a, b] of [
  ["process.output", "process.merge"],
  ["source.text", "process.transcribe"],
  ["process.prompt", "process.refine"],
] as Array<[NodeType, NodeType]>) {
  if (outToIn(a, b)) throw new Error(`前置断言失败：${label(a)} → ${label(b)} 本应不可连`);
}
for (const [a, b] of [
  ["source.text", "process.refine"],
  ["flow.pick", "process.merge"],
  ["process.chapter", "process.merge"],
] as Array<[NodeType, NodeType]>) {
  if (!outToIn(a, b)) throw new Error(`前置断言失败：${label(a)} → ${label(b)} 本应可连`);
}
console.log("前置断言通过：16 种节点；定向的可连/不可连各 3 条，判定全部符合预期\n");

// ───────── ① 连线判定矩阵 ─────────
let legal = 0;
for (const a of types) for (const b of types) if (a !== b && outToIn(a, b)) legal++;
console.log(`【一】连线判定：${types.length}×${types.length} = ${types.length ** 2} 个有序对，合法 ${legal} 个（${((legal / types.length ** 2) * 100).toFixed(1)}%）`);
const deg = types
  .map((t) => ({ t, p: types.filter((x) => x !== t && outToIn(x, t)).length, s: types.filter((x) => x !== t && outToIn(t, x)).length }))
  .sort((a, b) => b.p + b.s - (a.p + a.s));
for (const r of deg) console.log(`  ${label(r.t).padEnd(14)} 前驱 ${String(r.p).padStart(2)}  后继 ${String(r.s).padStart(2)}`);

// ───────── ② 可插入位置 ─────────
// 位置 = 展开图上的一条边（前驱 → 后继），外加每个终点后面的「尾端」。
// 按 (前驱 id, 后继 id) 去重：分支模板（多路对照）的共享前缀只算一个位置，不按分支重复计。
interface Slot { template: string; source: string; prev: NodeType; next: NodeType | null }
const slotMap = new Map<string, Slot>();
const graphs: Array<{ template: string; source: string; nodes: Map<string, NodeType>; edges: Array<[string, string]>; sinks: string[] }> = [];
for (const tpl of WORKFLOW_TEMPLATES) {
  for (const source of ["bili", "file", "text"] as const) {
    const g = buildTemplateGraph(tpl.id, { source });
    if (!g) continue;
    const nodes = new Map(g.nodes.map((n) => [n.id, n.type as NodeType]));
    const edges = g.edges.map((e) => [e.source, e.target] as [string, string]);
    const hasOut = new Set(edges.map(([a]) => a));
    const sinks = g.nodes.map((n) => n.id).filter((id) => !hasOut.has(id));
    graphs.push({ template: tpl.name, source, nodes, edges, sinks });
    for (const [a, b] of edges) {
      const prev = nodes.get(a)!, next = nodes.get(b)!;
      if (!outToIn(prev, next)) throw new Error(`前置断言失败：内置链路「${tpl.name}」里 ${label(prev)} → ${label(next)} 不合法`);
      slotMap.set(`${tpl.id}|${source}|${a}->${b}`, { template: tpl.name, source, prev, next });
    }
    for (const s of sinks) slotMap.set(`${tpl.id}|${source}|${s}->TAIL`, { template: tpl.name, source, prev: nodes.get(s)!, next: null });
  }
}
const slots = [...slotMap.values()];
console.log(`\n【二】9 条内置链路 × 3 种来源 = ${graphs.length} 张展开图（「选段加工」只有音视频两种来源，所以不是 27）`);
console.log(`     去重后的可插入位置 ${slots.length} 个（按「前驱 → 后继」去重，分支模板的共享前缀只算一次）`);
console.log("     两个口径：① 能接在多少处上游之后（单向：前驱输出 → 新节点输入）");
console.log("               ② 能严格插进多少段之间（双向：还要能把产物交给原来那个后继）");
const ranked = types
  .map((cand) => {
    const attach = slots.filter((s) => outToIn(s.prev, cand));
    const insert = attach.filter((s) => (s.next === null ? NODE_PORTS[cand].outputs.length > 0 : outToIn(cand, s.next)));
    return { cand, attach: attach.length, insert: insert.length, tpls: new Set(attach.map((h) => h.template)).size };
  })
  .sort((a, b) => b.insert - a.insert || b.attach - a.attach);
for (const r of ranked) {
  const pct = (n: number) => `${((n / slots.length) * 100).toFixed(0).padStart(3)}%`;
  console.log(`  ${label(r.cand).padEnd(14)} ① ${String(r.attach).padStart(3)}/${slots.length}（${pct(r.attach)}）  ② ${String(r.insert).padStart(3)}/${slots.length}（${pct(r.insert)}）  覆盖 ${r.tpls}/9 条链路`);
}

// ───────── ③ 链路组合数（口径警告） ─────────
const sources = types.filter((t) => NODE_PORTS[t].inputs.length === 0);
const sinks = types.filter((t) => NODE_PORTS[t].outputs.length === 0);
function countPaths(allowAll: boolean, subset: NodeType[]) {
  const n = subset.length;
  const idx = new Map(subset.map((t, i) => [t, i]));
  const adj = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (allowAll ? i !== j : outToIn(subset[i], subset[j]))));
  const f = new Float64Array((1 << n) * n);
  for (const s of subset.filter((t) => sources.includes(t))) f[(1 << idx.get(s)!) * n + idx.get(s)!] = 1;
  let all = 0, sinkEnd = 0;
  const pop = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
  for (let mask = 1; mask < 1 << n; mask++)
    for (let v = 0; v < n; v++) {
      const cur = f[mask * n + v];
      if (cur === 0) continue;
      if (pop(mask) >= 2) { all += cur; if (sinks.includes(subset[v])) sinkEnd += cur; }
      for (let u = 0; u < n; u++) if (adj[v][u] && !(mask & (1 << u))) f[(mask | (1 << u)) * n + u] += cur;
    }
  return { all, sinkEnd };
}
const typed = countPaths(false, types);
const untyped = countPaths(true, types);
const without = countPaths(false, types.filter((t) => t !== "process.drill"));
console.log(`\n【三】链路组合数（口径：起点是无输入端口的节点、同一节点类型不重复的简单路径）`);
console.log(`  带类型系统：${fmt(typed.all)} 条；其中终点落在「输出 / Obsidian」的 ${fmt(typed.sinkEnd)} 条`);
console.log(`  不加类型限制（任意节点都能接任意节点）：${fmt(untyped.all)} 条`);
console.log(`  把「知识巩固」这一个节点拿掉：${fmt(without.all)} 条（净增 ${fmt(typed.all - without.all)}）`);
console.log(`  ⚠ 这个数**不要拿去讲**：它把「连串三个素材挑选」这类无意义连法也算进去了，是上界不是可用量。`);

// ───────── ④ 手写枚举清单 ─────────
// 扫描整棵源码树，口径与这条命令一致（结果应当相等，可交叉核验）：
//   grep -rn '=== "process\.\|=== "source\.\|=== "flow\.\|!== "process\.\|!== "source\.\|!== "flow\.' \
//     --include="*.ts" --include="*.vue" apps packages | grep -v node_modules | grep -v '\.test\.' | wc -l
// 注意 `!== "flow.` 这个分支不能漏：漏了会少数 2 行（第一版就是这么错的）。
console.log(`\n【四】按节点类型手写枚举的地方`);
const RE = /[!=]== "(?:process|source|flow)\./g;
/** 单位是「行」：一行里连着写几个 `||` 比较只算一处，因为你改的时候就是改那一行。 */
const perFile = new Map<string, { lines: number; hits: number }>();
const scan = (dir: string) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") scan(rel); continue; }
    if (!/\.(ts|vue)$/.test(e.name) || /\.test\./.test(e.name)) continue;
    let lines = 0, hits = 0;
    for (const line of readFileSync(join(ROOT, rel), "utf8").split("\n")) {
      const m = line.match(RE);
      if (m) { lines++; hits += m.length; }
    }
    if (lines > 0) perFile.set(rel, { lines, hits });
  }
};
scan("apps");
scan("packages");
const totalLines = [...perFile.values()].reduce((a, b) => a + b.lines, 0);
const totalHits = [...perFile.values()].reduce((a, b) => a + b.hits, 0);
if (totalLines !== 73) throw new Error(`前置断言失败：期望 73 行，实际 ${totalLines}——源码变了就更新本脚本与文档`);
for (const [f, n] of [...perFile.entries()].sort((a, b) => b[1].lines - a[1].lines)) console.log(`  ${String(n.lines).padStart(3)} 行（${String(n.hits).padStart(3)} 处）  ${f}`);
console.log(`  ── 合计 ${totalLines} 行 / ${totalHits} 处「节点类型硬比较」，分布在 ${perFile.size} 个文件里`);
console.log(`  两个口径的差（${totalHits - totalLines}）= 一行里写了好几个 \\|\\| 的那类条件；改的时候只改一行，所以讲的行数`);
console.log(`  对照：graph.ts 是 ${perFile.get("packages/shared/src/graph.ts")?.lines ?? 0} 行——契约文件用 Record<NodeType,…> 声明，一处硬比较都没有`);
console.log(`  runNode 的 switch 用的是 default 抛运行时错，不是 never 穷尽断言 → 漏加 case 编译得过\n`);
