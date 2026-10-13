/**
 * 链路自检：跑一遍内置链路「全提示词对照」——
 * B站链接 → 转写 → 校对 → 每个已放开的提示词各一条 AI 加工分支 → Obsidian 笔记。
 *
 * 链路形状**来自模板**（`packages/shared/src/templates.ts` 的 `template.all-prompts`），脚本不再自己拼图：
 * 它建的工程与用户在「新建工程」里点出来的那条一模一样，所以这条自检同时也是那条模板的端到端验收。
 *
 * 前置：pnpm dev + 设置页配好 AI 模型与语音识别密钥。本脚本会**真的**下载音频、真的转写、真的调模型，
 * 结尾会往设置页指向的 Obsidian 库里真的写一篇笔记（标题固定成测试标题，反复跑只覆盖它自己，
 * 不会盖住同名真实笔记——模板本身不写死标题，是脚本建的临时工程里改的）。
 * **跑的过程中别改 `apps/server` 或 `packages/shared` 的源码**：dev server 是 `node --watch`，
 * 一重启就会把正在跑的运行打断成 `interrupted`（实测踩过，报出来的是「节点被 cancelled」）。
 * 用法：pnpm check:api:chain
 *       BILI_URL=https://www.bilibili.com/video/BV1xxxxxxx pnpm check:api:chain   # 换素材
 *       node scripts/m-chain-api-check.mjs --dry-run                              # 只建图并校验，不起跑（几秒）
 *
 * 断言挑的都是**运行成功也照样会漏过去**的地方：
 * 1. 模板的分支 = 当前已放开的提示词块。分支数跟着 `aiPromptBlocks`（画布下拉同一份）走，
 *    写死一份 id 清单、白名单变了没跟上的话，这一条会红；
 * 2. 每个分支真的各跑各的块——节点没读到 `promptBlockId` 时，所有分支会一起退化成引擎默认提示词、
 *    产物雷同，**而运行状态仍是 success**，所以「产物两两不同」单列一条；
 * 3. 全部分支按压平语义进同一篇笔记，且库里那份文件真的在盘上。
 *
 * 自建自清：跑通就删掉临时工程（连同运行记录）；有断言失败则留下来供查看画布与结果页。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { aiPromptBlocks } from "../packages/shared/src/prompt.ts";

const BASE = process.env.API_URL ?? "http://localhost:8787";
const BILI_URL = process.env.BILI_URL ?? "https://www.bilibili.com/video/BV1ct9DB1E6m";
/** 内置链路 id：形状在 templates.ts，这里按 id 引用、不自己拼图。 */
const TEMPLATE_ID = "template.all-prompts";
/** 临时工程名：带「自检」字样，与用户自己建的工程区分开。 */
const PROJECT_NAME = "全提示词对照（自检）";
/** 写进库里的笔记标题：固定的测试标题，不跟着视频标题走。 */
const NOTE_TITLE = "全提示词对照（测试）";
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_MS = 3000;
/** 只建图并过一遍形状断言、不起跑。 */
const DRY_RUN = process.argv.includes("--dry-run");

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

/** B 站不可达时给出明确提示，而不是把网络问题伪装成断言失败。 */
async function biliReachable() {
  try {
    await fetch("https://api.bilibili.com/x/web-interface/nav", { method: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

/** 轮询到运行结束；每 15 秒打一行进度，免得十几分钟里看不出卡在哪。 */
async function waitRun(runId, startedAt) {
  let tick = 0;
  while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
    await sleep(POLL_MS);
    tick += 1;
    const { data } = await j("GET", `/api/runs/${runId}`);
    if (data?.status !== "running") return data;
    if (tick % 5 === 0) {
      const done = (data.nodeResults ?? []).filter((node) => node.status === "done").length;
      const total = (data.nodeResults ?? []).length;
      console.log(`  … 运行中：${done}/${total} 节点完成（已 ${Math.round((Date.now() - startedAt) / 1000)}s）`);
    }
  }
  throw new Error(`运行超时（>${Math.round(RUN_TIMEOUT_MS / 60000)} 分钟）：${runId}`);
}

/** 跑完就删掉自建的临时工程（连同运行记录）；有断言失败时保留，便于查看画布与结果页。 */
async function cleanup(projectId) {
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.log(`\n有 ${failed} 项断言失败，临时工程 ${projectId} 保留下来供查看。`);
    return;
  }
  const { status } = await j("DELETE", `/api/projects/${projectId}`);
  console.log(`\n已清理临时工程（${status === 200 ? "连同运行记录" : `删除返回 ${status}`}）。`);
}

async function main() {
  if (!(await biliReachable())) {
    console.log("[chain-api-check] 访问不到 B 站，跳过（这条自检必须联网）");
    return;
  }

  const settings = (await j("GET", "/api/settings")).data ?? {};
  // 与模板同一口径：模板在 shared 里构建，只含内置已放开块（见 templates.ts 的 OPEN_PROMPT_BLOCKS）。
  const expected = aiPromptBlocks([], true);
  const customBlocks = ((await j("GET", "/api/prompts")).data?.items ?? []).filter((block) => !block.builtin);
  check(
    "已放开的提示词块 ≥ 2（少于 2 个就不成对照）",
    expected.length >= 2,
    `n=${expected.length}：${expected.map((block) => block.name).join("、")}`,
  );
  if (customBlocks.length > 0) {
    console.log(`  （另有 ${customBlocks.length} 个自定义块不进这条链路：模板在 shared 里构建，读不到用户库里的块）`);
  }

  /*
   * 笔记的落点：节点没有写死 folder，落点就是设置页的默认目录（引擎的缺省值是 00-Inbox）——
   * 与引擎同一套取值顺序。**跑之前**先记下它上一次的修改时间：库里可能已经躺着上一次跑出来的那篇，
   * 光看「文件存在、内容也含全部分支」两条，是拿旧笔记冒充本次产物（实测踩过）。
   */
  const folder = String(settings.obsidian?.folder ?? "").trim().replace(/^[\\/]+|[\\/]+$/g, "") || "00-Inbox";
  const notePath = join(settings.obsidian?.vaultPath ?? "", ...folder.split(/[\\/]+/).filter(Boolean), `${NOTE_TITLE}.md`);
  const noteMtimeBefore = existsSync(notePath) ? statSync(notePath).mtimeMs : 0;

  // 1. 按模板建临时工程——服务端用 buildTemplateGraph 建图，与「新建工程」对话框走的是同一条路。
  const created = await j("POST", "/api/projects", { name: PROJECT_NAME, templateId: TEMPLATE_ID, source: "bili" });
  const projectId = created.data?.id;
  check("按模板建出工程", created.status === 201 && Boolean(projectId), created.status === 201 ? projectId : JSON.stringify(created.data).slice(0, 160));
  if (!projectId) return;

  // 2. 只改测试用的两处：来源卡填素材、笔记标题固定。
  //    （模板不写死标题是对的——用户用它时应该跟着视频标题走；自检则必须固定，否则会盖住同名真实笔记。）
  const graph = created.data.graph;
  const sourceNode = graph.nodes.find((node) => node.type === "source.bili");
  // 节点 id 由模板的 stage key 决定，脚本不写死它们——按类型取，模板改名也不会把自检搞哑。
  const refineNode = graph.nodes.find((node) => node.type === "process.refine");
  const obsidianNode = graph.nodes.find((node) => node.type === "process.obsidian");
  sourceNode.data.url = BILI_URL;
  obsidianNode.data.title = NOTE_TITLE;
  const put = await j("PUT", `/api/projects/${projectId}/graph`, { graph });
  check("把素材填进来源卡", put.status === 200, put.status === 200 ? "" : JSON.stringify(put.data).slice(0, 160));

  const branchNodes = graph.nodes.filter((node) => node.type === "process.prompt");
  check(
    `模板分支 = 当前放开的 ${expected.length} 个块（分支跟着白名单走）`,
    branchNodes.map((node) => node.data.promptBlockId).join(",") === expected.map((block) => block.id).join(","),
    branchNodes.map((node) => node.data.label ?? node.data.promptBlockId).join("、"),
  );

  if (DRY_RUN) {
    check("图通过服务端校验（未起跑）", true, `${graph.nodes.length} 节点 / ${graph.edges.length} 连线`);
    await cleanup(projectId);
    return;
  }

  const startedAt = Date.now();
  const started = await j("POST", `/api/projects/${projectId}/runs`, { scope: "all" });
  // 启动运行返回 202（不是 200）：m-drill 自检曾在这一点上写成 200，结果一直卡在这一步没跑到链路。
  if (started.status !== 202) {
    check("启动整链运行", false, `${started.status} ${JSON.stringify(started.data).slice(0, 200)}`);
    await cleanup(projectId);
    return;
  }
  const runId = started.data.id;
  console.log(`\n运行 ${runId}：真下载 + 真转写 + ${branchNodes.length} 条分支，约 8–12 分钟\n`);

  const detail = await waitRun(runId, startedAt);
  const nodeResults = detail?.nodeResults ?? [];
  const byId = new Map(nodeResults.map((node) => [node.nodeId, node]));

  check("整链运行成功", detail?.status === "success", detail?.status ?? "（无响应）");
  for (const node of nodeResults.filter((item) => item.status === "error")) {
    console.log(`      ↳ ${node.nodeLabel ?? node.nodeId} 失败：${node.error ?? "未给出原因"}`);
  }

  const refine = byId.get(refineNode.id);
  check("校对节点产出文稿", refine?.status === "done" && (refine?.output?.text?.length ?? 0) > 200, refine?.summary ?? "");

  const branches = branchNodes.map((node) => byId.get(node.id));
  check(
    "每个分支节点都完成",
    branches.every((node) => node?.status === "done"),
    branches.map((node) => node?.status ?? "缺失").join("/"),
  );

  const texts = branches.map((node) => node?.output?.text ?? "");
  check("每个分支产物都非空（> 200 字）", texts.every((text) => text.length > 200), texts.map((text) => text.length).join("/"));
  const distinct = new Set(texts.map((text) => text.replace(/\s+/g, "")));
  check(
    `${branchNodes.length} 个分支产物两两不同（各自真的用了自己的块）`,
    texts.length > 0 && distinct.size === texts.length,
    `去重后 ${distinct.size} 份`,
  );

  const obsidian = byId.get(obsidianNode.id);
  const noteText = obsidian?.output?.text ?? "";
  check("Obsidian 节点产出笔记文档", obsidian?.status === "done" && obsidian?.output?.kind === "noteDoc", obsidian?.summary ?? "");
  const missing = texts.filter((text) => !text.trim() || !noteText.includes(text.trim()));
  check(
    "全部分支内容都压平进同一篇笔记",
    // 分支产物为空时这条会「因为没什么可缺的」而真空通过，所以先把「每段都非空」也算进来。
    texts.length > 0 && texts.every((text) => text.trim().length > 0) && missing.length === 0,
    missing.length > 0 ? `缺 ${missing.length} 段` : `笔记 ${noteText.length} 字`,
  );

  /*
   * 两种路径口径，别混（第一版断言就是在这里写错的）：
   * · **库内笔记**（Obsidian 节点自己写出的那篇）的路径只在节点摘要里（「已保存到 Obsidian：<目录>/<文件名>」）；
   * · `output.path` 是运行收尾**另存**的一份交付产物——`saveRunDocuments` 把末端节点的笔记再写一份到
   *   输出目录（默认 `data/outputs/run_<id>/<工程名>.md`，数据目录**相对**路径），并改写了 `output.path`。
   *   所以它相对的是数据目录，不是 Obsidian 库。
   */
  const rawPath = obsidian?.output?.path ?? "";
  const dataRoot = settings.general?.resolvedOutputDir ? dirname(settings.general.resolvedOutputDir) : "";
  const artifactPath = !rawPath ? "" : isAbsolute(rawPath) ? rawPath : dataRoot ? join(dataRoot, rawPath) : "";
  check("交付产物另存一份到输出目录", Boolean(artifactPath) && existsSync(artifactPath), artifactPath || "（无 output.path）");

  // 落点与跑前的 mtime 在起跑前就算好了（见上面 notePath 那段注释）。
  check("笔记真的落盘在 Obsidian 库里", existsSync(notePath), notePath);
  const written = existsSync(notePath) ? statSync(notePath).mtimeMs : 0;
  const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString("zh-CN") : "无");
  check("笔记是本次运行写的（不是上一次留下的那一篇）", written > noteMtimeBefore, `本次 ${clock(written)} · 跑前 ${clock(noteMtimeBefore)}`);
  if (existsSync(notePath)) {
    const file = readFileSync(notePath, "utf8");
    check("落盘文件带正确的 frontmatter 标题", file.includes(`标题: ${NOTE_TITLE}`), NOTE_TITLE);
    check(
      "落盘文件含全部分支内容",
      texts.every((text) => text.trim() && file.includes(text.trim())),
      `${file.length} 字`,
    );
  }

  console.log("\n节点耗时与摘要：");
  for (const node of nodeResults) {
    const label = node.nodeLabel ?? node.nodeId;
    const seconds = `${(node.elapsedMs / 1000).toFixed(1)}s`.padStart(7);
    console.log(`  ${String(label).padEnd(18)} ${String(node.status).padEnd(6)}${seconds}  ${node.summary ?? node.error ?? ""}`);
  }
  if (notePath) console.log(`\nObsidian 笔记：${notePath}`);
  if (artifactPath) console.log(`交付产物副本：${artifactPath}`);
  console.log(`工程「${PROJECT_NAME}」是用模板 ${TEMPLATE_ID} 建的临时工程（与「新建工程」对话框同一条路）。`);

  await cleanup(projectId);
}

try {
  await main();
} catch (err) {
  check("脚本执行", false, err instanceof Error ? err.message : String(err));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n[chain-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
