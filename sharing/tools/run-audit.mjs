/**
 * 从真实运行记录里读使用情况。**只读打开数据库，不改任何数据。**
 *
 *   node sharing/tools/run-audit.mjs
 *   node sharing/tools/run-audit.mjs --db <另一个 sqlite 路径>
 *
 * 为什么要按 project_id 分组看：这个库是生产库，里面混着自检脚本留下的工程。
 * 实测踩过——53 次失败全来自一个工程、其中 50 次在 9 秒内连发，
 * 直接对全表求平均就会得出「失败率 60%」这种被一次异常刷屏带偏的结论。
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const dbPath = argv[argv.indexOf("--db") + 1] && argv.includes("--db")
  ? argv[argv.indexOf("--db") + 1]
  : "apps/server/data/scribe-flow.sqlite";
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}\n（这个脚本只在作者本机有数据时能跑；换机器请用 --db 指一个副本）`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const min = (ms) => (Number(ms) / 60000).toFixed(1);

// ───────── 前置断言：先确认这个库的形态是我们以为的那样 ─────────
const cols = q("PRAGMA table_info(runs)").map((c) => c.name);
for (const need of ["id", "project_id", "status", "scope", "elapsed_ms"]) {
  if (!cols.includes(need)) throw new Error(`前置断言失败：runs 表里没有 ${need} 列，这个库的形态和脚本假设不符`);
}
const total = one("SELECT COUNT(*) n FROM runs").n;
if (total === 0) throw new Error("前置断言失败：一条运行记录都没有，后面的比例都没有意义");
console.log(`数据库：${dbPath}`);
console.log(`前置断言通过：runs 有 ${total} 条记录；有 elapsed_ms 的记录 ${one("SELECT COUNT(*) n FROM runs WHERE elapsed_ms IS NOT NULL").n} 条\n`);

// ───────── 1. 找出「异常刷屏」的工程：短时间内连发的那种 ─────────
// 注意不能用「整个工程的时间跨度」算：实测那个工程的 53 次跨了 5 小时，
// 密集期只在最后 9 秒——按整段平均会被稀释成「0.003 次/秒」而漏掉。所以用滑动窗口找最密集的 10 秒。
console.log("=== 一、先揪出异常刷屏的工程（否则全表平均会被它带偏）===");
const WINDOW_MS = 10_000;
const BURST_MIN = 10; // 10 秒内 ≥10 次就算机械连发：人点不出这个节奏
let badProjects = [];
for (const r of q(`SELECT r.project_id, p.name, COUNT(*) n FROM runs r JOIN projects p ON p.id = r.project_id GROUP BY r.project_id HAVING n >= 5`)) {
  const ts = q(`SELECT created_at FROM runs WHERE project_id = ? ORDER BY created_at`, r.project_id).map((x) => Number(x.created_at));
  let best = 0, bestAt = 0;
  for (let i = 0; i < ts.length; i++) {
    let j = i;
    while (j + 1 < ts.length && ts[j + 1] - ts[i] < WINDOW_MS) j++;
    const span = ts[j] - ts[i];
    const rate = span > 0 ? ((j - i + 1) / span) * 1000 : Infinity;
    if (j - i + 1 > best || (j - i + 1 === best && rate > 0)) { best = Math.max(best, j - i + 1); bestAt = span; }
  }
  const flag = best >= BURST_MIN ? `  ← 最密集的 ${bestAt / 1000} 秒内连发 ${best} 次，不像人点的` : "";
  console.log(`  ${String(r.n).padStart(3)} 次  「${String(r.name).slice(0, 28)}」${flag}`);
  if (best >= BURST_MIN) badProjects.push(r.project_id);
}
if (badProjects.length === 0) console.log("  （没有）");
const exclude = badProjects.length
  ? `project_id NOT IN (${badProjects.map(() => "?").join(",")})`
  : "1=1";
const exArgs = badProjects;

// ───────── 2. 两个口径的基线 ─────────
console.log("\n=== 二、基线：全表 vs 剔除异常工程（引用请用右边那列）===");
const line = (label, where, args) => {
  const t = one(`SELECT COUNT(*) n, SUM(status='success') s, SUM(status='error') e, SUM(scope='fromNode') f FROM runs WHERE ${where}`, ...args);
  const pc = (x) => `${((x / t.n) * 100).toFixed(0)}%`;
  console.log(`  ${label.padEnd(20)} 共 ${String(t.n).padStart(3)} 次  成功 ${String(t.s).padStart(3)}（${pc(t.s)}）  失败 ${String(t.e).padStart(3)}（${pc(t.e)}）  局部重跑 ${String(t.f).padStart(3)}（${pc(t.f)}）`);
};
line("全部", "1=1", []);
line("剔除异常工程", exclude, exArgs);

// ───────── 3. 重复劳动：早就成功过的节点又被跑了一遍 ─────────
console.log("\n=== 三、重复劳动（需求一：改一句话要重等多久）===");
const seq = q(`SELECT project_id, id, scope, created_at FROM runs WHERE ${exclude} ORDER BY project_id, created_at`, ...exArgs);
const seen = new Set();
let reran = 0, reranMs = 0;
for (const r of seq) {
  for (const x of q("SELECT node_id, status, elapsed_ms FROM run_node_results WHERE run_id = ?", r.id)) {
    const key = `${r.project_id}|${x.node_id}`;
    if (x.status === "done" && r.scope === "all" && seen.has(key)) { reran++; reranMs += Number(x.elapsed_ms); }
    if (x.status === "done") seen.add(key);
  }
}
const okMs = Number(one(`SELECT SUM(elapsed_ms) m FROM runs WHERE status='success' AND ${exclude}`, ...exArgs).m ?? 0);
console.log(`  全跑时重复执行的「早就成功过」的节点：${reran} 次，合计 ${min(reranMs)} 分钟`);
console.log(`  对照：成功运行总耗时 ${min(okMs)} 分钟 → 占 ${((reranMs / okMs) * 100).toFixed(0)}%（**上限口径**：改了参数的重跑也算在里面了）`);

console.log("\n  单步价钱（节点级耗时，实测）：");
for (const r of q(`SELECT res.node_type, COUNT(*) n, ROUND(AVG(res.elapsed_ms)/1000.0) avg_s, ROUND(MAX(res.elapsed_ms)/60000.0,1) max_min
  FROM run_node_results res JOIN runs ru ON ru.id = res.run_id
  WHERE res.status='done' AND ${exclude.replace(/project_id/g, "ru.project_id")}
  GROUP BY res.node_type ORDER BY SUM(res.elapsed_ms) DESC LIMIT 6`, ...exArgs))
  console.log(`    ${String(r.node_type).padEnd(20)} ${String(r.n).padStart(3)} 次  平均 ${String(r.avg_s).padStart(5)}s  最贵 ${r.max_min} 分钟`);

console.log("\n  同一工程同一节点被成功跑多次的（迭代留下的痕迹）：");
for (const r of q(`SELECT p.name, res.node_type, COUNT(*) n, ROUND(SUM(res.elapsed_ms)/60000.0,1) m
  FROM run_node_results res JOIN runs ru ON ru.id = res.run_id JOIN projects p ON p.id = ru.project_id
  WHERE res.status='done' AND res.elapsed_ms > 1000 AND ${exclude.replace(/project_id/g, "ru.project_id")}
  GROUP BY ru.project_id, res.node_id HAVING n > 1 ORDER BY SUM(res.elapsed_ms) DESC LIMIT 6`, ...exArgs))
  console.log(`    ${String(r.n).padStart(2)} 次  合计 ${String(r.m).padStart(6)} 分钟  ${String(r.node_type).padEnd(20)} 「${String(r.name).slice(0, 22)}」`);

// ───────── 4. 「从中间一步跑」的死角 ─────────
console.log("\n=== 四、局部重跑的死角（需求二）===");
console.log("  (a) 剔除异常工程后的失败原因：");
for (const r of q(`SELECT res.error, COUNT(*) n FROM run_node_results res JOIN runs ru ON ru.id = res.run_id
  WHERE res.status='error' AND ${exclude.replace(/project_id/g, "ru.project_id")} GROUP BY res.error ORDER BY n DESC LIMIT 6`, ...exArgs))
  console.log(`      ${String(r.n).padStart(2)} 次  ${String(r.error).slice(0, 74)}`);

console.log("\n  (b) 解剖那个异常工程——它是「上游从没跑过」的标本：");
for (const pid of badProjects) {
  const p = one("SELECT name FROM projects WHERE id = ?", pid);
  const runsN = one("SELECT COUNT(*) n, SUM(status='success') s FROM runs WHERE project_id = ?", pid);
  const err = one(`SELECT res.error, COUNT(*) n, ROUND(AVG(res.elapsed_ms),1) avg_ms FROM run_node_results res JOIN runs ru ON ru.id=res.run_id
    WHERE ru.project_id = ? AND res.status='error' GROUP BY res.error ORDER BY n DESC LIMIT 1`, pid);
  console.log(`      「${p.name}」：${runsN.n} 次运行，成功 ${runsN.s} 次`);
  console.log(`      最常见错误：${String(err.error).slice(0, 60)}（${err.n} 次，平均只用 ${err.avg_ms} 毫秒）`);
  // 这些失败的运行从哪个节点起跑？它的上游在历史里有没有留下可复用的产物？
  const starts = q(`SELECT node_id, COUNT(*) n FROM runs WHERE project_id = ? AND scope='fromNode' GROUP BY node_id ORDER BY n DESC LIMIT 3`, pid);
  for (const s of starts) console.log(`      ${String(s.n).padStart(3)} 次都从节点 ${String(s.node_id).slice(0, 14)} 起跑（scope=fromNode）`);
  const missing = q(`SELECT json_extract(n.value, '$.type') type FROM projects p, json_each(json_extract(p.graph_json, '$.nodes')) n
    WHERE p.id = ? AND NOT EXISTS (SELECT 1 FROM run_node_results res JOIN runs ru ON ru.id = res.run_id
      WHERE ru.project_id = p.id AND res.node_id = json_extract(n.value, '$.id') AND res.status='done')`, pid);
  console.log(`      图里有 ${missing.length} 个节点在历史里从来没有成功产出过：${missing.map((m) => m.type).join("、") || "（无）"}`);
  // 需求四：没接线的节点（拖上来但忘了接）
  const g = JSON.parse(one("SELECT graph_json FROM projects WHERE id = ?", pid).graph_json);
  const wired = new Set();
  for (const e of g.edges) { wired.add(e.source); wired.add(e.target); }
  const orphans = g.nodes.filter((n) => !wired.has(n.id));
  console.log(`      图里 ${g.nodes.length} 个节点 / ${g.edges.length} 条连线，其中 ${orphans.length} 个节点**没接任何线**：${orphans.map((o) => o.type).join("、") || "（无）"}`);
}

console.log(`\n  全库「5 毫秒内就失败」的节点结果：${one("SELECT COUNT(*) n FROM run_node_results WHERE status='error' AND elapsed_ms <= 5").n} 条——这类失败发生在输入解析阶段，连活都没开始干`);

// ───────── 5. 运行记录能回答「谁发起的」吗 ─────────
console.log("\n=== 五、运行记录能不能说清「谁发起的」（需求三）===");
console.log(`  runs 表的列：${cols.join(", ")}`);
for (const c of ["triggered_by", "triggeredBy", "attempt", "retry_count"]) {
  console.log(`  ${cols.includes(c) ? "有" : "没有"} ${c}`);
}

// ───────── 6. 从来没成功过的工程 ─────────
console.log("\n=== 六、跑过但一次都没成功过的工程 ===");
const never = q(`SELECT p.name, COUNT(*) n FROM runs ru JOIN projects p ON p.id = ru.project_id
  GROUP BY ru.project_id HAVING SUM(ru.status='success') = 0 ORDER BY n DESC`);
if (never.length === 0) console.log("  （没有）");
for (const r of never) console.log(`  ${String(r.n).padStart(3)} 次全败  「${String(r.name).slice(0, 30)}」`);
console.log(`\n有运行记录的工程 ${one("SELECT COUNT(DISTINCT project_id) n FROM runs").n} 个，其中从未成功 ${never.length} 个`);
