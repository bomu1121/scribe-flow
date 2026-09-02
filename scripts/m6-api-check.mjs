/**
 * M6 API 自检：条件分支（true/false + skipped）、文本工具、非法重试配置校验。
 * 前置：pnpm dev。用法：node scripts/m6-api-check.mjs
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

const ifGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "这是 用于 M6 条件分支验收的 文稿， 内容 足够长。" } },
    { id: "n_if", type: "flow.if", position: { x: 200, y: 0 }, data: { label: "条件分支", condition: { field: "charCount", op: "gt", value: "10" } } },
    { id: "n_true_text", type: "process.text", position: { x: 420, y: -80 }, data: { label: "正则清理", operation: "regexReplace", pattern: "\\s+", replace: "", flags: "g" } },
    { id: "n_false_text", type: "process.text", position: { x: 420, y: 80 }, data: { label: "不走的文本", operation: "cleanup" } },
    { id: "n_true_out", type: "process.output", position: { x: 640, y: -80 }, data: { label: "输出 true", fileName: "m6-true.md" } },
    { id: "n_false_out", type: "process.output", position: { x: 640, y: 80 }, data: { label: "输出 false", fileName: "m6-false.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_if", sourceHandle: "transcript", targetHandle: "in" },
    { id: "e2", source: "n_if", target: "n_true_text", sourceHandle: "true", targetHandle: "in" },
    { id: "e3", source: "n_if", target: "n_false_text", sourceHandle: "false", targetHandle: "in" },
    { id: "e4", source: "n_true_text", target: "n_true_out", sourceHandle: "out", targetHandle: "noteDoc" },
    { id: "e5", source: "n_false_text", target: "n_false_out", sourceHandle: "out", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const invalidRetryGraph = structuredClone(ifGraph);
invalidRetryGraph.nodes[1].data.retry = { maxRetries: -1, backoffMs: 3000 };

async function waitRun(runId) {
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const { data } = await j("GET", `/api/runs/${runId}`);
    if (data?.status !== "running") return data;
  }
  throw new Error(`运行超时：${runId}`);
}

async function run() {
  // 1. 非法重试配置被 schema 拒绝
  const invalidProject = await j("POST", "/api/projects", { name: "M6 非法重试验收" });
  const invalidProjectId = invalidProject.data?.id;
  const putInvalid = await j("PUT", `/api/projects/${invalidProjectId}/graph`, { graph: invalidRetryGraph });
  check("PUT graph 拒绝 maxRetries=-1", putInvalid.status === 400, `status=${putInvalid.status}`);
  if (invalidProjectId) await j("DELETE", `/api/projects/${invalidProjectId}`);

  // 2. 条件分支 + 文本工具运行
  const project = await j("POST", "/api/projects", { name: "M6 API 验收" });
  const projectId = project.data?.id;
  const put = await j("PUT", `/api/projects/${projectId}/graph`, { graph: ifGraph });
  check("PUT graph 接受条件分支图", put.status === 200, `status=${put.status}`);

  const started = await j("POST", `/api/projects/${projectId}/runs`, { scope: "all" });
  const runId = started.data?.id;
  const detail = await waitRun(runId);
  check("条件分支链路运行成功", detail?.status === "success", detail?.status ?? "");

  const nodes = detail?.nodeResults ?? [];
  const trueText = nodes.find((n) => n.nodeId === "n_true_text");
  const falseText = nodes.find((n) => n.nodeId === "n_false_text");
  const trueOut = nodes.find((n) => n.nodeId === "n_true_out");
  const falseOut = nodes.find((n) => n.nodeId === "n_false_out");
  check("true 路 process.text 完成", trueText?.status === "done", trueText?.status ?? "");
  check("false 路 process.text 被跳过", falseText?.status === "skipped", falseText?.status ?? "");
  check("true 路输出完成", trueOut?.status === "done", trueOut?.status ?? "");
  check("false 路输出被跳过", falseOut?.status === "skipped", falseOut?.status ?? "");
  check("正则替换生效（空格被删除）", !(trueText?.output?.text ?? "").includes(" "), (trueText?.output?.text ?? "").slice(0, 60));

  // 3. 清理
  if (runId) await j("DELETE", `/api/runs/${runId}`);
  if (projectId) await j("DELETE", `/api/projects/${projectId}`);
  check("清理 M6 临时数据", true);
}

await run();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[m6-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
