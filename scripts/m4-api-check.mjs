/**
 * M4 API 自检：提示词块库 CRUD、运行日志、设置数据信息。
 * 前置：pnpm dev。用法：node scripts/m4-api-check.mjs
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

const textGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "M4 日志验收文稿" } },
    { id: "n_merge", type: "process.merge", position: { x: 200, y: 0 }, data: { label: "合并", title: "M4 验收" } },
    { id: "n_out", type: "process.output", position: { x: 400, y: 0 }, data: { label: "输出", fileName: "m4.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
    { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

async function waitRun(runId) {
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const { data } = await j("GET", `/api/runs/${runId}`);
    if (data?.status !== "running") return data;
  }
  throw new Error(`运行超时：${runId}`);
}

async function run() {
  // 1. 提示词块库
  const initial = await j("GET", "/api/prompts");
  check("GET /api/prompts 返回内置 4 块", initial.status === 200 && initial.data?.items?.filter((b) => b.builtin).length === 4);

  const created = await j("POST", "/api/prompts", { name: "M4 验收块", prompt: "这是验收提示词。" });
  check("POST /api/prompts 创建自定义块", created.status === 201 && created.data?.id?.startsWith("custom."), created.data?.id ?? "");
  const blockId = created.data?.id;

  const patched = await j("PATCH", `/api/prompts/${blockId}`, { name: "M4 验收块（改）", prompt: "修改后的提示词。" });
  check("PATCH /api/prompts 更新", patched.status === 200 && patched.data?.name?.includes("（改）") && patched.data?.prompt?.includes("修改"));

  const blockList = await j("GET", "/api/prompts");
  check("自定义块进入列表", blockList.data?.items?.some((b) => b.id === blockId));

  // 2. 运行日志（文本链路）
  const project = await j("POST", "/api/projects", { name: "M4 API 验收" });
  const projectId = project.data?.id;
  await j("PUT", `/api/projects/${projectId}/graph`, { graph: textGraph });
  const started = await j("POST", `/api/projects/${projectId}/runs`, { scope: "all" });
  const runId = started.data?.id;
  const detail = await waitRun(runId);
  check("文本链路运行成功", detail?.status === "success");

  const logs = await j("GET", `/api/runs/${runId}/logs`);
  check("GET /api/runs/:id/logs 有日志", logs.status === 200 && logs.data?.items?.length >= 2, `${logs.data?.items?.length ?? 0} 条`);
  check("日志包含输入与输出文件信息", logs.data?.items?.some((l) => l.kind === "input") && logs.data?.items?.some((l) => l.kind === "info" && l.content.includes("m4.md")));

  const nodeLogs = await j("GET", `/api/runs/${runId}/logs?nodeId=n_out`);
  check("日志可按节点过滤", nodeLogs.data?.items?.every((l) => l.nodeId === "n_out"));

  // 3. 数据信息
  const dataInfo = await j("GET", "/api/settings/data");
  check("GET /api/settings/data", dataInfo.status === 200 && typeof dataInfo.data?.runCount === "number" && typeof dataInfo.data?.outputFiles === "number");

  // 4. 删除提示词块与清理
  const deletedBlock = await j("DELETE", `/api/prompts/${blockId}`);
  check("DELETE /api/prompts/:id", deletedBlock.status === 200 && deletedBlock.data?.ok === true);
  const builtinDelete = await j("DELETE", "/api/prompts/builtin.insight");
  check("内置提示词块不可删除", builtinDelete.status === 400);

  await j("DELETE", `/api/runs/${runId}`);
  await j("DELETE", `/api/projects/${projectId}`);
  check("清理 M4 临时数据", true);
}

await run();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[m4-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
