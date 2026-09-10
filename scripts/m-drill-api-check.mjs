/**
 * 知识巩固节点（process.drill）API 自检。
 *
 * 前置：pnpm dev + 已在设置页配置 AI 模型密钥（本脚本会真实调用模型）。
 * 用法：node scripts/m-drill-api-check.mjs
 *
 * 覆盖：schema 校验、三步配方跑通、产物契约（drillSet JSON + 引文命中原文）、
 *       摘要格式、下游序列化（接合并/输出产出可读 Markdown）。
 */
const BASE = process.env.API_URL ?? "http://localhost:8787";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** 自检文稿：内容自带明确结论与因果，便于抽点与出题。 */
const SOURCE = [
  "很多人做视频笔记的失败点不在转写，而在切分。",
  "按字数切分会在论证中间截断，模型看到的上下文不完整，于是提炼出来的观点往往是半句。",
  "按语义切章则能保证每个章节自洽，代价是要多一次模型调用。",
  "所以切章粒度要按论证单元来定，而不是按字数来定。",
  "命中率是检索的第一指标，覆盖率同样重要。",
].join("");

function drillGraph(extra = {}) {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "n_text", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: SOURCE } },
      {
        id: "n_drill",
        type: "process.drill",
        position: { x: 400, y: 0 },
        data: {
          label: "知识巩固",
          pointCount: 5,
          kinds: ["single", "judge", "cloze"],
          difficulty: "medium",
          withExtensions: true,
          retry: { maxRetries: 1, backoffMs: 2000 },
          ...extra,
        },
      },
    ],
    edges: [{ id: "e1", source: "n_text", target: "n_drill", sourceHandle: "transcript", targetHandle: "in" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 追加「知识巩固 → 合并 → 输出」下游链路，验证产物序列化成可读 Markdown。 */
function drillToOutputGraph() {
  const graph = drillGraph();
  graph.nodes.push({ id: "n_merge", type: "process.merge", position: { x: 800, y: 0 }, data: { label: "合并", title: "练一练" } });
  graph.nodes.push({ id: "n_out", type: "process.output", position: { x: 1200, y: 0 }, data: { label: "输出", fileName: "练一练.md" } });
  graph.edges.push({ id: "e2", source: "n_drill", target: "n_merge", sourceHandle: "out", targetHandle: "noteBlock" });
  graph.edges.push({ id: "e3", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" });
  return graph;
}

function normalize(text) {
  return String(text ?? "")
    .replace(/[*_`~\s]/g, "")
    .toLowerCase();
}

async function waitRun(runId) {
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    const { data } = await j("GET", `/api/runs/${runId}`);
    if (data?.status !== "running") return data;
  }
  throw new Error(`运行超时：${runId}`);
}

async function run() {
  // 1. schema：越界参数必须在写入图时被拒绝
  const buf = await j("POST", "/api/projects", { name: "知识巩固 非法参数验收" });
  const bufId = buf.data?.id;
  const badCount = await j("PUT", `/api/projects/${bufId}/graph`, { graph: drillGraph({ pointCount: 99 }) });
  check("PUT graph 拒绝 pointCount=99", badCount.status === 400, `status=${badCount.status}`);
  const badKinds = await j("PUT", `/api/projects/${bufId}/graph`, { graph: drillGraph({ kinds: [] }) });
  check("PUT graph 拒绝空题型", badKinds.status === 400, `status=${badKinds.status}`);
  if (bufId) await j("DELETE", `/api/projects/${bufId}`);

  // 2. 出题链路
  const project = await j("POST", "/api/projects", { name: "知识巩固 API 验收" });
  const projectId = project.data?.id;
  const put = await j("PUT", `/api/projects/${projectId}/graph`, { graph: drillGraph() });
  check("PUT graph 接受知识巩固节点", put.status === 200, `status=${put.status}`);

  const started = await j("POST", `/api/projects/${projectId}/runs`, { scope: "all" });
  if (started.status !== 200) {
    check("启动运行", false, JSON.stringify(started.data).slice(0, 160));
    return;
  }
  const runId = started.data?.id;
  const detail = await waitRun(runId);
  check("知识巩固节点运行成功", detail?.status === "success", detail?.status ?? JSON.stringify(detail).slice(0, 160));

  const drill = (detail?.nodeResults ?? []).find((n) => n.nodeId === "n_drill");
  check("节点产物类型为 noteBlock", drill?.output?.kind === "noteBlock", drill?.output?.kind ?? "");
  check("摘要可读（考察点/题数/延伸）", /个考察点 · \d+ 题 · \d+ 条延伸/.test(drill?.summary ?? ""), drill?.summary ?? "");

  let product = null;
  try {
    product = JSON.parse(drill?.output?.text ?? "");
  } catch {
    product = null;
  }
  check("产物是合法 JSON", product !== null);
  check("产物带 drillSet 标记", product?.kind === "drillSet", String(product?.kind));
  check("产出知识点 ≥ 3", (product?.points?.length ?? 0) >= 3, `points=${product?.points?.length ?? 0}`);
  check("产出题目 ≥ 3", (product?.items?.length ?? 0) >= 3, `items=${product?.items?.length ?? 0}`);

  const items = product?.items ?? [];
  const kinds = new Set(items.map((item) => item.kind));
  check("题型在允许集合内", [...kinds].every((kind) => ["single", "multi", "judge", "cloze"].includes(kind)), [...kinds].join(","));

  const normalizedSource = normalize(SOURCE);
  const missingQuotes = items.filter((item) => !item.sourceQuote || !normalizedSource.includes(normalize(item.sourceQuote)));
  check("每题引文都能在原文逐字命中", missingQuotes.length === 0, `未命中 ${missingQuotes.length} 题`);

  const badAnswer = items.filter(
    (item) => item.kind !== "cloze" && (!Array.isArray(item.answer) || item.answer.length === 0 || item.answer.some((a) => !item.options.includes(a))),
  );
  check("客观题答案都在选项内", badAnswer.length === 0, `异常 ${badAnswer.length} 题`);

  const danglingRefs = items.filter((item) => !(product?.points ?? []).some((point) => point.id === item.pointId));
  check("题目引用的知识点都存在", danglingRefs.length === 0, `悬空 ${danglingRefs.length} 题`);

  const extensions = product?.extensions ?? [];
  check("产出延伸问题", extensions.length > 0, `extensions=${extensions.length}`);
  check(
    "延伸问题不给答案（只有提示与方向）",
    extensions.every((ext) => !Object.prototype.hasOwnProperty.call(ext, "answer")),
  );

  if (runId) await j("DELETE", `/api/runs/${runId}`);

  // 3. 下游序列化：接合并/输出后应是可读 Markdown
  const project2 = await j("POST", "/api/projects", { name: "知识巩固 下游序列化验收" });
  const projectId2 = project2.data?.id;
  await j("PUT", `/api/projects/${projectId2}/graph`, { graph: drillToOutputGraph() });
  const started2 = await j("POST", `/api/projects/${projectId2}/runs`, { scope: "all" });
  const runId2 = started2.data?.id;
  const detail2 = await waitRun(runId2);
  check("知识巩固 → 合并 → 输出 运行成功", detail2?.status === "success", detail2?.status ?? "");

  const mergeNode = (detail2?.nodeResults ?? []).find((n) => n.nodeId === "n_merge");
  const mergedText = mergeNode?.output?.text ?? "";
  check("合并产物是可读 Markdown（不含原始 JSON）", mergedText.includes("## 练习题") && !mergedText.includes('"drillSet"'), mergedText.slice(0, 80));
  check("合并产物含答案与原文依据", mergedText.includes("**答案**：") && mergedText.includes("**原文依据**"));

  const outNode = (detail2?.nodeResults ?? []).find((n) => n.nodeId === "n_out");
  check("输出节点写出文件", outNode?.status === "done" && Boolean(outNode?.output?.path), outNode?.output?.path ?? "");

  // 4. 清理
  if (runId2) await j("DELETE", `/api/runs/${runId2}`);
  if (projectId) await j("DELETE", `/api/projects/${projectId}`);
  if (projectId2) await j("DELETE", `/api/projects/${projectId2}`);
  check("清理临时数据", true);
}

await run();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[drill-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
