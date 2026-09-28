/**
 * M4 API 自检：提示词块库 CRUD、运行日志、数据账本与清理契约。
 * 前置：pnpm dev。用法：node scripts/m4-api-check.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 内置块数量从源码推导，不写死。
 * 这里原先把断言写成「等于 8」，新增内置块后脚本就静默变红了很久——
 * 那种断言只是在记录过去的事实，不是在检查现在。
 */
function builtinBlockCount() {
  const source = readFileSync(join(process.cwd(), "packages/shared/src/prompt.ts"), "utf8");
  return (source.match(/id: "builtin\./g) ?? []).length;
}

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
  // 数量从 BUILTIN_PROMPT_BLOCKS 推导，新增内置块时无需改这里
  const expectedBuiltin = builtinBlockCount();
  const actualBuiltin = initial.data?.items?.filter((b) => b.builtin).length ?? -1;
  check(
    `GET /api/prompts 返回全部内置块（${expectedBuiltin} 个）`,
    initial.status === 200 && actualBuiltin === expectedBuiltin,
    `实际 ${actualBuiltin}`,
  );

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

  // 3. 数据账本与清理计划
  const dataInfo = await j("GET", "/api/settings/data");
  const overview = dataInfo.data ?? {};
  const areas = overview.areas ?? [];
  check(
    "GET /api/settings/data 返回六个分区",
    dataInfo.status === 200 && ["database", "media", "uploads", "runs", "outputs", "graphBackups"].every((key) => areas.some((a) => a.key === key)),
    `${areas.length} 个分区`,
  );
  const areaSum = areas.reduce((acc, a) => acc + a.bytes, 0);
  const fileSum = areas.reduce((acc, a) => acc + a.files, 0);
  check("账本合计等于各分区之和", overview.totals?.bytes === areaSum && overview.totals?.files === fileSum, `合计 ${overview.totals?.bytes} / 分区和 ${areaSum}`);
  const outputsArea = areas.find((a) => a.key === "outputs");
  check("本次运行写的产物进入输出分区", (outputsArea?.files ?? 0) >= 1, `${outputsArea?.files ?? 0} 个文件`);
  check(
    "运行与工程计数已反映本次运行",
    (overview.runs?.total ?? 0) >= 1 && (overview.runs?.finished ?? 0) >= 1 && (overview.projects?.total ?? 0) >= 1,
    `${overview.runs?.total ?? 0} 条运行 / ${overview.projects?.total ?? 0} 个工程`,
  );
  const cleanupTargets = (overview.cleanup ?? []).map((item) => item.target);
  check(
    "清理计划覆盖五个可回收项且每项带数字",
    cleanupTargets.length === 5 && (overview.cleanup ?? []).every((item) => typeof item.count === "number" && typeof item.bytes === "number" && typeof item.rule === "string"),
    cleanupTargets.join(" / "),
  );
  check(
    "可回收合计等于各项之和",
    overview.reclaimableBytes === (overview.cleanup ?? []).reduce((acc, item) => acc + item.bytes, 0),
    `${overview.reclaimableBytes} 字节`,
  );

  // 清理只验契约：这里的服务端实例可能装着真实数据，自检脚本不做真正的删除（删除路径由单测在临时目录覆盖）。
  const pruneNoTargets = await j("POST", "/api/settings/prune", {});
  check("POST /api/settings/prune 缺 targets 返回 400", pruneNoTargets.status === 400);
  const pruneBadTarget = await j("POST", "/api/settings/prune", { targets: ["nope"] });
  check("POST /api/settings/prune 未知目标返回 400", pruneBadTarget.status === 400);

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
