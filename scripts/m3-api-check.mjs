/**
 * M3 运行引擎 API 自检：文本工作流端到端（不依赖 AI/ASR 密钥）。
 * 前置：pnpm dev。用法：node scripts/m3-api-check.mjs
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
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "这是 M3 引擎验收文稿。\n第二段内容。" } },
    { id: "n_merge", type: "process.merge", position: { x: 200, y: 0 }, data: { label: "合并", title: "验收笔记" } },
    { id: "n_out", type: "process.output", position: { x: 400, y: 0 }, data: { label: "输出", fileName: "验收.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
    { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

async function readSseUntilDone(runId) {
  const res = await fetch(`${BASE}/api/runs/${runId}/events`);
  if (!res.ok || !res.body) return [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) {
          try {
            const event = JSON.parse(dataLine.slice(5).trim());
            events.push(event);
            if (event.type === "run.done") return events;
          } catch {
            // 忽略半包
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return events;
}

async function waitRun(runId) {
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const { data } = await j("GET", `/api/runs/${runId}`);
    if (data?.status !== "running") return data;
  }
  throw new Error(`运行超时：${runId}`);
}

async function run() {
  // 1. 设置默认值
  const settings = await j("GET", "/api/settings");
  check("GET /api/settings 返回默认配置", settings.status === 200 && settings.data?.ai?.provider === "deepseek" && settings.data?.asr?.engine === "mimo");
  const putSettings = await j("PUT", "/api/settings", { general: { concurrency: 2, outputDir: "outputs" } });
  check("PUT /api/settings 保存", putSettings.status === 200 && putSettings.data?.general?.concurrency === 2);

  // 2. 建临时工程 + 文本工作流
  const created = await j("POST", "/api/projects", { name: "M3 API 验收" });
  check("创建验收工程", created.status === 201 && Boolean(created.data?.id), created.data?.id ?? "");
  const projectId = created.data?.id;
  const putGraph = await j("PUT", `/api/projects/${projectId}/graph`, { graph: textGraph });
  check("写入文本工作流", putGraph.status === 200);

  // 3. 启动 + SSE 事件
  const started = await j("POST", `/api/projects/${projectId}/runs`, { scope: "all" });
  check("启动运行返回 202 + run id", started.status === 202 && Boolean(started.data?.id), started.data?.id ?? "");
  const runId = started.data?.id;
  const events = await Promise.race([readSseUntilDone(runId), sleep(20000).then(() => [])]);
  check("SSE 收到 run.started / node.done / run.done", events.some((e) => e.type === "run.started") && events.some((e) => e.type === "node.done") && events.some((e) => e.type === "run.done"), events.map((e) => e.type).join(", "));

  const detail = await waitRun(runId);
  check("文本链路 3 节点全部 done", detail?.status === "success" && detail.nodeResults?.every((n) => n.status === "done"), detail?.summary ?? "");
  check("输出节点产物带路径", detail.nodeResults?.some((n) => n.output?.path?.endsWith("验收.md")), detail.nodeResults?.find((n) => n.output?.path)?.output?.path ?? "");

  // 4. 运行列表
  const list = await j("GET", "/api/runs");
  check("GET /api/runs 包含本次运行", list.status === 200 && list.data?.items?.some((r) => r.id === runId));

  // 5. 单节点重跑（依赖上一次运行产物）
  const retry = await j("POST", `/api/runs/${runId}/nodes/n_merge/retry`);
  check("POST retry 创建单节点运行", retry.status === 202 && retry.data?.scope === "node", retry.data?.id ?? "");
  const retryDetail = await waitRun(retry.data.id);
  check("单节点重跑成功（复用上次产物）", retryDetail?.status === "success" && retryDetail.nodeResults?.some((n) => n.nodeId === "n_merge" && n.status === "done"));

  // 6. 停止接口可用
  const stop = await j("POST", `/api/runs/${runId}/stop`);
  check("POST /api/runs/:id/stop 返回 ok", stop.status === 200 && stop.data?.ok === true);

  // 7. 清理
  await j("DELETE", `/api/runs/${retry.data.id}`);
  const delRun = await j("DELETE", `/api/runs/${runId}`);
  check("DELETE /api/runs/:id", delRun.status === 200 && delRun.data?.ok === true);
  const delProject = await j("DELETE", `/api/projects/${projectId}`);
  check("清理验收工程", delProject.status === 200);
}

await run();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[m3-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
