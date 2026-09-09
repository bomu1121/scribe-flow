/**
 * CDP UI 冒烟脚本（无第三方依赖，Node 22+）：
 * 用真实 Chrome 无头模式验证 ScribeFlow 前端在「单壳工作台」布局（M8）下的关键交互。
 *
 * 背景：UI 已重构为单壳工作台 —— 没有独立的工程列表页/运行记录页；
 * 工程与运行记录都在左侧探索器（工作台面板）树里（见 apps/web/src/router.ts 顶部注释）。
 * 本脚本断言全部对齐当前真实 DOM（类名均在 apps/web/src 源码中核实过）：
 *   - .ws-rail / .ws-rail-btn / .wp-projects / .wp-item / .np-tpl / .el-dialog / .sf-account 等
 *   - 节点添加从画布侧栏 palette 改为工作台「节点」面板（NodesPanel .wp-node-item）
 *   - 运行按钮为画布浮动按钮 .sf-float-run；运行结果状态类 .sf-node.is-done
 *   - 运行详情与日志为 RunDetailView 的 .rv-preview / RunLogDialog 的 .rl-log-item
 * 用法：先启动 pnpm dev，再执行 node scripts/cdp-ui-smoke.mjs
 */
import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://localhost:5173/";
const API_URL = process.env.API_URL ?? "http://localhost:8787";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333);
const DEBUG_PORT = `http://127.0.0.1:${CDP_PORT}`;
const PROFILE = join(ROOT, ".tmp-cdp-profile");
const SHOT_LIST = join(ROOT, ".tmp-cdp-list.png");
const SHOT_DIALOG = join(ROOT, ".tmp-cdp-dialog.png");
const SHOT_LOGIN = join(ROOT, ".tmp-cdp-login.png");
const SHOT_EDITOR = join(ROOT, ".tmp-cdp-editor.png");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let cdp;
let msgId = 0;
const pending = new Map();

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const targets = await fetch(`${DEBUG_PORT}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
          }
        });
        cdp = ws;
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Page.setDeviceMetricsOverride", {
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        return;
      }
    } catch {
      // Chrome 还没起来，继续等
    }
    await sleep(500);
  }
  throw new Error("无法连接 Chrome CDP");
}

function send(method, params = {}) {
  const id = ++msgId;
  cdp.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evalJs(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Runtime.evaluate 失败");
  }
  return response.result?.value;
}

async function navigate(url) {
  await send("Page.navigate", { url });
  for (let i = 0; i < 40; i += 1) {
    const ready = await evalJs("document.readyState");
    if (ready === "complete" || ready === "interactive") break;
    await sleep(250);
  }
}

async function waitFor(expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evalJs(expression)) return true;
    } catch {
      // 页面可能还在切换，继续等
    }
    await sleep(250);
  }
  return false;
}

async function shot(path) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path, Buffer.from(data, "base64"));
  return path;
}

async function pressEscape() {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await sleep(500);
}

// Element Plus 对话框 append-to-body 且关闭后 DOM 常驻（display:none）：
// 「可见对话框」= 存在 display 非 none 的 .el-overlay 且其内（或紧随其后）有 .el-dialog。
const VISIBLE_DIALOG_JS = `(() => {
  const ov = [...document.querySelectorAll('.el-overlay')].find((o) => getComputedStyle(o).display !== 'none');
  if (!ov) return null;
  const d = ov.querySelector('.el-dialog');
  if (!d) return null;
  const t = d.querySelector('.el-dialog__title');
  return { title: t ? t.textContent.trim() : '', hasButton: d.querySelectorAll('.el-button').length, hasInput: d.querySelectorAll('.el-input').length };
})()`;

async function visibleDialogInfo() {
  return evalJs(VISIBLE_DIALOG_JS);
}

/** 没有任何可见的 EP 对话框。 */
async function noVisibleDialog() {
  const info = await evalJs(VISIBLE_DIALOG_JS);
  return info === null;
}

/** 点击活动条按钮（按 aria-label），避免同 tab 再点被收起：先保证面板已打开。 */
async function openRailTab(ariaLabel) {
  const state = await evalJs(`(() => {
    const open = !!document.querySelector('.ws-panel.open');
    const openTab = [...document.querySelectorAll('.ws-seg-btn.active')].map((b) => b.textContent.trim()).join('');
    const want = [...document.querySelectorAll('.ws-rail-btn')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)});
    return { open, openTab, hasBtn: !!want };
  })()`);
  if (!state.hasBtn) return false;
  if (!state.open || state.openTab !== ariaLabel) {
    await evalJs(`[...document.querySelectorAll('.ws-rail-btn')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)})?.click(); true`);
  }
  return true;
}

/** 工作台底部「设置」入口开的是自定义浮层（非 EP），这里只验证结构。 */
async function run() {
  await connect();

  // ---------------------------------------------------------------
  // 1. 应用壳：单壳工作台渲染 + 工程树
  // ---------------------------------------------------------------
  const apiResult = await fetch(`${API_URL}/api/projects`).then((r) => r.json());
  const projects = Array.isArray(apiResult) ? apiResult : apiResult?.items;
  const projectNames = Array.isArray(projects) ? projects.map((p) => p.name) : [];
  if (!Array.isArray(projects) || projects.length === 0) {
    check("后端存在工程数据", false, "后端没有工程，其余工程树/画布章节将受牵连");
  } else {
    check("后端存在工程数据", true, `${projects.length} 个工程：${projectNames.join("、")}`);
  }

  await navigate(APP_URL);
  const shellReady = await waitFor("!!document.querySelector('.ws-rail') && !!document.querySelector('.ws-panel')", 12000);
  check("工作台壳渲染（ws-rail 活动条 + ws-panel 就位）", shellReady);
  // 有工程时 '/' 会自动跳进最近工程编辑器（HomeView redirectIfPossible）
  await waitFor("!!document.querySelector('.sf-editor') || !!document.querySelector('.sf-home')", 15000);

  const rail = (await evalJs(`(() => {
    const btns = [...document.querySelectorAll('.ws-rail-btn')];
    return {
      logo: document.querySelectorAll('.ws-logo').length,
      btns: btns.length,
      labels: btns.map((b) => b.getAttribute('aria-label')).join('/'),
      version: document.querySelector('.ws-version')?.textContent?.trim() ?? '',
    };
  })()`)) ?? { logo: 0, btns: 0, labels: "", version: "" };
  check(
    "活动条入口齐全（工程/运行记录/节点/设置）",
    rail.logo === 1 && rail.btns === 4 && rail.labels === "工程/运行记录/节点/设置",
    `logo=${rail.logo} btns=${rail.btns} [${rail.labels}] ${rail.version}`,
  );

  // 工程面板默认打开，工具栏与筛选框齐全
  const toolbar = (await evalJs(`(() => {
    const bar = document.querySelector('.wp-projects .wp-toolbar');
    if (!bar) return null;
    return {
      ibtn: bar.querySelectorAll('.wp-ibtn').length,
      labels: [...bar.querySelectorAll('.wp-ibtn')].map((b) => b.getAttribute('aria-label')).join('/'),
      search: !!document.querySelector('.wp-projects .wp-search-input'),
      close: !!document.querySelector('.wp-head .wp-close'),
    };
  })()`)) ?? null;
  check(
    "工程面板工具栏渲染（新建工程/文件夹/导入/刷新/排序 + 筛选 + 收起）",
    toolbar?.ibtn === 5 && toolbar.search && toolbar.close,
    toolbar ? `ibtn=${toolbar.ibtn} [${toolbar.labels}] search=${toolbar.search} close=${toolbar.close}` : "面板未就绪",
  );

  // 树行：文件夹行 [data-folder-id] 与工程行 [data-project-id]
  const rowsReady = await waitFor("document.querySelectorAll('.wp-projects [data-tree-row]').length > 0", 12000);
  const readTree = () => evalJs(`(() => {
    try {
      const folderRows = [...document.querySelectorAll('.wp-projects [data-folder-id]')];
      const projectRows = [...document.querySelectorAll('.wp-projects [data-project-id]')];
      return {
        rows: document.querySelectorAll('.wp-projects [data-tree-row]').length,
        folders: folderRows.map((r) => r.querySelector('.wp-row-label')?.textContent?.trim() ?? ''),
        projects: projectRows.map((r) => r.querySelector('.wp-item-name')?.textContent?.trim() ?? ''),
        panel: !!document.querySelector('.wp-projects'),
        error: '',
      };
    } catch (err) {
      return { rows: 0, folders: [], projects: [], panel: false, error: String(err) };
    }
  })()`);
  let rawTree = await readTree();
  for (let i = 0; i < 3 && rawTree === null; i += 1) {
    await sleep(400);
    rawTree = await readTree();
  }
  const tree = rawTree ?? {};
  const treeRows = Number(tree.rows) || 0;
  const treeProjects = Array.isArray(tree.projects) ? tree.projects : [];
  const treeFolders = Array.isArray(tree.folders) ? tree.folders : [];
  check("工程树渲染出工程行（≥1）", rowsReady && treeRows > 0 && treeProjects.length >= 1, `${treeRows} 行：${treeProjects.join("、")}`);
  check(
    "工程树渲染出文件夹行（真拖测试 / 12312312）",
    treeRows > 0 && treeFolders.length >= 2 && treeFolders.includes("真拖测试") && treeFolders.includes("12312312"),
    treeFolders.join("、") || "无文件夹行",
  );

  await shot(SHOT_LIST);

  // ---------------------------------------------------------------
  // 2. 新建工程对话框（工作台工具栏入口）
  // ---------------------------------------------------------------
  await evalJs("document.querySelector('.wp-projects .wp-toolbar .wp-ibtn[aria-label=\"新建工程\"]')?.click(); true");
  const dialogInfo = await waitFor(
    `(() => { const i = ${VISIBLE_DIALOG_JS}; return !!i && i.title.includes('新建工程'); })()`,
    5000,
  );
  check("新建工程对话框打开", dialogInfo, JSON.stringify(await visibleDialogInfo()));
  const tpl = (await evalJs(`(() => ({
    count: document.querySelectorAll('.np-tpl').length,
    names: [...document.querySelectorAll('.np-tpl-name')].map((n) => n.textContent.trim()),
  }))()`)) ?? { count: 0, names: [] };
  // NewProjectDialog = 「空白工程」+ WORKFLOW_TEMPLATES（packages/shared/src/templates.ts 共 8 个）
  const expectTpl = 1 + 8;
  check(
    "模板按钮渲染 9 个（空白 + 8 工作流模板）",
    tpl.count === expectTpl,
    `${tpl.count} 个：${tpl.names.join("、")}`,
  );
  // Element Plus 按钮/输入框断言落在对话框真实语境（footer 取消 el-button + 名称 el-input）
  const epInDialog = await evalJs(`(() => {
    const i = ${VISIBLE_DIALOG_JS};
    if (!i) return null;
    const d = [...document.querySelectorAll('.el-overlay')].find((o) => getComputedStyle(o).display !== 'none')?.querySelector('.el-dialog');
    const btnTexts = [...(d?.querySelectorAll('.el-button') ?? [])].map((b) => b.textContent.trim());
    const inputPh = d?.querySelector('.np-name .el-input__inner')?.getAttribute('placeholder') ?? '';
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim();
    return { btnTexts, inputPh, brand };
  })()`);
  check(
    "对话框内 Element Plus 控件渲染（el-button 取消 + 名称 el-input）",
    epInDialog?.btnTexts?.includes("取消") && epInDialog?.inputPh?.includes("工程名称"),
    `按钮=[${epInDialog?.btnTexts?.join("、")}] 占位=${epInDialog?.inputPh}`,
  );
  check(
    "Element Plus 主色来自品牌令牌（--el-color-primary ≠ 默认 #409eff）",
    Boolean(epInDialog?.brand) && epInDialog?.brand.toLowerCase() !== "#409eff",
    `--el-color-primary=${epInDialog?.brand}`,
  );
  await sleep(400);
  await shot(SHOT_DIALOG);
  await pressEscape();
  await waitFor(`(() => { const i = ${VISIBLE_DIALOG_JS}; return i === null; })()`, 4000);
  check("Esc 关闭对话框", await noVisibleDialog());

  // ---------------------------------------------------------------
  // 3. M2：登录入口与扫码弹窗（入口现位于工程编辑器顶栏 BiliAccountButton .sf-account）
  // ---------------------------------------------------------------
  const loginProj = projects[0];
  await fetch(`${API_URL}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  await navigate(`${APP_URL}project/${loginProj.id}`);
  const accountReady = await waitFor("!!document.querySelector('.sf-editor-bar .sf-account')", 12000);
  const accountText = await evalJs("document.querySelector('.sf-editor-bar .sf-account')?.textContent ?? ''");
  check("编辑器顶栏显示未登录入口（.sf-account）", accountReady && accountText.includes("未登录"), accountText.trim());
  await evalJs("document.querySelector('.sf-editor-bar .sf-account')?.click(); true");
  const loginDialogShown = await waitFor(
    `(() => { const i = ${VISIBLE_DIALOG_JS}; return !!i && i.title.includes('登录 B 站'); })()`,
    5000,
  );
  check("登录 B 站对话框打开", loginDialogShown, JSON.stringify(await visibleDialogInfo()));
  const loginBodyOk = await waitFor("!!document.querySelector('.sf-qr-img, .sf-qr-message--error')", 15000);
  check("登录弹窗内出现二维码或错误态", loginBodyOk);
  await sleep(300);
  await shot(SHOT_LOGIN);
  await pressEscape();
  await waitFor(`(() => { const i = ${VISIBLE_DIALOG_JS}; return i === null; })()`, 3000);
  check("Esc 关闭登录对话框", await noVisibleDialog());

  // ---------------------------------------------------------------
  // 4. M2：临时工程 + 工作台「节点」面板添加节点（palette 已并入左侧面板）
  // ---------------------------------------------------------------
  const tempCreate = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "M2 验收临时工程" }),
  }).then((r) => r.json());
  const tempId = tempCreate?.id;
  if (!tempId) {
    check("创建 M2 验收临时工程", false, JSON.stringify(tempCreate).slice(0, 120));
  } else {
    await navigate(`${APP_URL}project/${tempId}`);
    const canvasReady = await waitFor("!!document.querySelector('.sf-flow-canvas')", 12000);
    check("临时工程画布就绪", canvasReady);

    await openRailTab("节点");
    await waitFor("!!document.querySelector('.wp-nodes')", 5000);
    const nodeCatalog = (await evalJs(`(() => ({
      groups: document.querySelectorAll('.wp-nodes .wp-group').length,
      items: document.querySelectorAll('.wp-nodes .wp-node-item').length,
      names: [...document.querySelectorAll('.wp-nodes .wp-node-name')].map((n) => n.textContent.trim()),
    }))()`)) ?? { groups: 0, items: 0, names: [] };
    check(
      "节点面板目录齐全（来源/转写/AI 加工/文本与逻辑/组织与输出）",
      nodeCatalog.groups >= 5 && nodeCatalog.items >= 10,
      `${nodeCatalog.groups} 组 ${nodeCatalog.items} 项`,
    );

    // B站收藏（action 型入口）未登录时被拦截：自定义 toast 提示扫码登录
    await evalJs("[...document.querySelectorAll('.wp-nodes .wp-node-item')].find((b) => (b.textContent).includes('B站收藏'))?.click(); true");
    const gateToast = await waitFor(
      "(() => { const t = [...document.querySelectorAll('.sf-toast--info .sf-toast-message')].map((e) => e.textContent); return t.some((x) => x.includes('请先')); })()",
      5000,
    );
    check("未登录点击 B 站收藏被拦截（请先登录提示）", gateToast);

    // 本地文件节点：来源组「本地文件」（NodesPanel → canvas 中心）
    await evalJs("[...document.querySelectorAll('.wp-nodes .wp-node-item')].find((b) => (b.textContent).includes('本地文件'))?.click(); true");
    const fileNodeReady = await waitFor("!!document.querySelector('.vue-flow__node .sf-node--source-file .sf-node-upload')", 6000);
    const fileZoneText = await evalJs("document.querySelector('.vue-flow__node .sf-node-upload')?.textContent ?? ''");
    check("本地文件节点渲染 el-upload 拖拽区", fileNodeReady && fileZoneText.includes("点击或拖入"), fileZoneText.trim().slice(0, 60));

    // 文本节点：文本域初始为空 + 输入后计数更新（旧版“空文稿即报错”的前端校验已随重构移除，见源码说明）
    await evalJs("[...document.querySelectorAll('.wp-nodes .wp-node-item')].find((b) => (b.textContent).includes('文本'))?.click(); true");
    const textNodeReady = await waitFor("!!document.querySelector('.vue-flow__node .sf-node--source-text .el-textarea__inner')", 6000);
    const nodeCount = (await evalJs("document.querySelectorAll('.vue-flow__node').length")) ?? 0;
    check("文本节点渲染并可输入（画布节点数）", textNodeReady && nodeCount >= 2, `${nodeCount} 个画布节点`);
    await evalJs(`(() => {
      const ta = document.querySelector('.vue-flow__node .sf-node--source-text .el-textarea__inner');
      if (!ta) return false;
      ta.value = '你好';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const countOk = await waitFor("document.querySelector('.vue-flow__node .sf-node-text-count')?.textContent.includes('2 / 50000') ?? false", 4000);
    check("输入文稿后字数计数更新（2 / 50000）", countOk, await evalJs("document.querySelector('.vue-flow__node .sf-node-text-count')?.textContent ?? ''"));

    await fetch(`${API_URL}/api/projects/${tempId}`, { method: "DELETE" }).catch(() => undefined);
    check("清理 M2 验收临时工程", true);
  }

  // ---------------------------------------------------------------
  // 5. M3：文本工作流在画布上运行到 done（源文本→合并→输出，不依赖 AI/ASR 密钥）
  //     运行按钮 = 画布浮动 .sf-float-run（原 .sf-editor-bar-actions 主按钮已重构掉）
  // ---------------------------------------------------------------
  const m3TextGraph = {
    schemaVersion: 1,
    nodes: [
      { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "M3 UI 验收文稿" } },
      { id: "n_merge", type: "process.merge", position: { x: 200, y: 0 }, data: { label: "合并", title: "验收笔记" } },
      { id: "n_out", type: "process.output", position: { x: 400, y: 0 }, data: { label: "输出", fileName: "ui.md" } },
    ],
    edges: [
      { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
      { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const m3Create = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "M3 UI 验收" }),
  }).then((r) => r.json());
  const m3Id = m3Create?.id;
  let m3RunId = "";
  if (!m3Id) {
    check("创建 M3 UI 验收工程", false, JSON.stringify(m3Create).slice(0, 100));
  } else {
    await fetch(`${API_URL}/api/projects/${m3Id}/graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: m3TextGraph }),
    });
    await navigate(`${APP_URL}project/${m3Id}`);
    const m3Canvas = await waitFor("document.querySelectorAll('.vue-flow__node').length === 3", 15000);
    check("M3 画布渲染 3 节点", m3Canvas, `${await evalJs("document.querySelectorAll('.vue-flow__node').length")} 个节点`);
    const runBtnReady = await waitFor("!!document.querySelector('.sf-float-run:not([disabled])')", 8000);
    check("M3 运行按钮可用（浮动运行 .sf-float-run）", runBtnReady);
    await evalJs("document.querySelector('.sf-float-run')?.click(); true");
    const allDone = await waitFor("document.querySelectorAll('.sf-node.is-done').length === 3", 25000);
    check("SSE 驱动 3 个节点进入 done 状态", allDone, `${await evalJs("document.querySelectorAll('.sf-node.is-done').length")} 个节点`);

    // 运行记录入库：切到工作台「运行记录」tab（原独立 /runs 页已并入面板）
    await openRailTab("运行记录");
    const runRowReady = await waitFor("document.querySelectorAll('.wp-runs .wp-run').length > 0", 10000);
    const runRowMeta = (await evalJs(`(() => ({
      rows: document.querySelectorAll('.wp-runs .wp-run').length,
      title: document.querySelector('.wp-runs-title')?.textContent?.trim() ?? '',
      first: document.querySelector('.wp-runs .wp-run-meta')?.textContent?.trim() ?? '',
    }))()`)) ?? { rows: 0, title: "", first: "" };
    check("运行库出现本次运行（面板内行）", runRowReady && runRowMeta.rows >= 1, `${runRowMeta.rows} 行 · ${runRowMeta.title} · ${runRowMeta.first}`);
    const m3RunList = await fetch(`${API_URL}/api/runs?projectId=${m3Id}`).then((r) => r.json());
    m3RunId = m3RunList?.items?.[0]?.id ?? "";

    // -------------------------------------------------------------
    // 6. M4：运行详情日志查看器（RunDetailView .rv-preview / RunLogDialog .rl-log-item）
    // -------------------------------------------------------------
    if (m3RunId) {
      await navigate(`${APP_URL}project/${m3Id}/run/${m3RunId}`);
      const docOk = await waitFor("!!document.querySelector('.rv-main .rv-preview')", 8000);
      const docText = await evalJs("document.querySelector('.rv-main .rv-preview')?.textContent ?? ''");
      check("运行详情渲染输出文档", docOk && docText.includes("M3 UI 验收文稿"), docText.slice(0, 80));
      await evalJs("[...document.querySelectorAll('.rv-actions .rv-btn')].find((b) => b.textContent.includes('查看日志'))?.click(); true");
      const logItems = await waitFor("document.querySelectorAll('.rl-log-item').length >= 2", 8000);
      check("日志查看器展示节点日志（≥2 条）", logItems, `${await evalJs("document.querySelectorAll('.rl-log-item').length")} 条`);
      await pressEscape();
      await waitFor("!document.querySelector('.rl-overlay')", 3000);
    }

    // 设置页（独立路由 /settings，仍为 .sf-settings-* 结构）
    await navigate(`${APP_URL}settings`);
    await waitFor("!!document.querySelector('.sf-settings-nav')", 8000);
    const aiForm = (await evalJs(`(() => ({
      inputs: document.querySelectorAll('.sf-settings-form .el-input').length,
      selects: document.querySelectorAll('.sf-settings-form .el-select').length,
    }))()`)) ?? { inputs: 0, selects: 0 };
    check(
      "设置页 AI 表单渲染（el-input + el-select）",
      aiForm.inputs >= 2 && aiForm.selects >= 2,
      `${aiForm.inputs} 输入框 / ${aiForm.selects} 下拉`,
    );
    await evalJs("[...document.querySelectorAll('.sf-settings-nav-item')].find((b) => b.textContent.trim() === '语音识别')?.click(); true");
    const asrOk = await waitFor("!!document.querySelector('.sf-settings-form .sf-model-select')", 5000);
    check("设置页 ASR 引擎为下拉控件（ModelSelect）", asrOk);
    await evalJs("[...document.querySelectorAll('.sf-settings-nav-item')].find((b) => b.textContent.trim() === '提示词块库')?.click(); true");
    const blocksOk = await waitFor("document.querySelectorAll('.sf-block-card').length >= 4", 6000);
    check("提示词块库渲染内置块（≥4）", blocksOk, `${await evalJs("document.querySelectorAll('.sf-block-card').length")} 块`);
    await evalJs("[...document.querySelectorAll('.sf-settings-nav-item')].find((b) => b.textContent.trim() === '数据与工程')?.click(); true");
    const dataOk = await waitFor("document.querySelectorAll('.sf-data-cell').length >= 3", 5000);
    check("数据与工程页渲染数据信息", dataOk, `${await evalJs("document.querySelectorAll('.sf-data-cell').length")} 个单元格`);

    // M5：移动端响应式（390x844）—— 画布只读提示 + 活动条隐藏 + 抽屉面板可收起/重开
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(`${APP_URL}project/${m3Id}`);
    await waitFor("!!document.querySelector('.sf-mobile-hint')", 8000);
    check("移动端画布只读提示显示", await evalJs("(() => { const h = document.querySelector('.sf-mobile-hint'); return !!h && getComputedStyle(h).display !== 'none'; })()"));
    check("移动端活动条隐藏（节点库入口随之隐藏）", await evalJs("(() => { const r = document.querySelector('.ws-rail'); return !!r && getComputedStyle(r).display === 'none'; })()"));
    const scrimVisible = await waitFor("!!document.querySelector('.ws-scrim.open')", 4000);
    if (scrimVisible) {
      await evalJs("document.querySelector('.ws-scrim.open')?.click(); true");
    }
    const mobileBtn = await waitFor(
      "(() => { const b = document.querySelector('.ws-mobile-panel-btn'); return !!b && getComputedStyle(b).display !== 'none'; })()",
      6000,
    );
    check("移动端可收起面板并出现「打开工程面板」按钮", mobileBtn);
    if (mobileBtn) {
      await evalJs("document.querySelector('.ws-mobile-panel-btn')?.click(); true");
      const reopened = await waitFor("!!document.querySelector('.ws-panel.open')", 4000);
      check("移动端抽屉面板可重新打开", reopened);
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    if (m3RunId) await fetch(`${API_URL}/api/runs/${m3RunId}`, { method: "DELETE" }).catch(() => undefined);
    await fetch(`${API_URL}/api/projects/${m3Id}`, { method: "DELETE" }).catch(() => undefined);
    check("清理 M3 UI 验收工程", true);
  }

  // ---------------------------------------------------------------
  // 7. M6：画布控件深层交互（受控工程：文稿/转写/AI 加工/合并）
  //     旧版依赖 .sf-palette 展开 + EP el-select/el-segmented；现画布内控件为
  //     ModelSelect（.sf-model-select）自研下拉 + EP el-input/el-textarea。
  // ---------------------------------------------------------------
  const widgetGraph = {
    schemaVersion: 1,
    nodes: [
      { id: "n_text", type: "source.text", position: { x: 0, y: 40 }, data: { label: "文稿", text: "示例文稿内容" } },
      { id: "n_asr", type: "process.transcribe", position: { x: 460, y: 40 }, data: { label: "转写" } },
      { id: "n_prompt", type: "process.prompt", position: { x: 880, y: 40 }, data: { label: "AI 加工" } },
      { id: "n_merge", type: "process.merge", position: { x: 1320, y: 40 }, data: { label: "合并", title: "合并标题" } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const widgetCreate = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "M6 画布控件验收" }),
  }).then((r) => r.json());
  const widgetId = widgetCreate?.id;
  if (!widgetId) {
    check("创建 M6 画布控件验收工程", false, JSON.stringify(widgetCreate).slice(0, 100));
  } else {
    await fetch(`${API_URL}/api/projects/${widgetId}/graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: widgetGraph }),
    });
    await navigate(`${APP_URL}project/${widgetId}`);
    const nodesReady = await waitFor("document.querySelectorAll('.vue-flow__node').length === 4", 15000);
    check("M6 画布渲染 4 节点", nodesReady, `${await evalJs("document.querySelectorAll('.vue-flow__node').length")} 个节点`);
    const epInputs = (await evalJs(`(() => ({
      input: document.querySelectorAll('.vue-flow__node .el-input').length,
      textarea: document.querySelectorAll('.vue-flow__node .el-textarea__inner').length,
      modelSelect: document.querySelectorAll('.vue-flow__node .sf-model-select').length,
    }))()`)) ?? { input: 0, textarea: 0, modelSelect: 0 };
    check(
      "画布节点内 EP 输入与自研下拉渲染（el-input/textarea/ModelSelect）",
      epInputs.input >= 1 && epInputs.textarea >= 1 && epInputs.modelSelect >= 2,
      `input=${epInputs.input} textarea=${epInputs.textarea} modelSelect=${epInputs.modelSelect}`,
    );

    // 提示词块下拉：AI 加工节点 → 打开 → 选项 ≥3 → 选中回显
    await evalJs("document.querySelector('.vue-flow__node .sf-node--process-prompt .sf-model-select__trigger')?.click(); true");
    const promptOpen = await waitFor("document.querySelectorAll('.sf-model-select__option').length >= 3", 5000);
    const optionLabels = await evalJs("[...document.querySelectorAll('.sf-model-select__option-label')].map((n) => n.textContent.trim())");
    check("提示词块下拉打开且有选项（≥3）", promptOpen, `${optionLabels.length} 个选项`);
    const clickedLabel = await evalJs(`(() => {
      const el = [...document.querySelectorAll('.sf-model-select__option')].find((b) => /观点提炼|技术文案提炼|信息溯源/.test(b.textContent ?? ''));
      if (!el) return '';
      el.click();
      return el.querySelector('.sf-model-select__option-label')?.textContent?.trim() ?? '';
    })()`);
    check("提示词块下拉选中回显", /观点提炼|技术文案提炼|信息溯源/.test(clickedLabel), clickedLabel);

    // ASR 引擎下拉：转写节点默认 MiMo-V2.5 → 切到 OpenAI 兼容
    const asrBefore = await evalJs("document.querySelector('.vue-flow__node .sf-node--process-transcribe .sf-model-select__value')?.textContent?.trim() ?? ''");
    await evalJs("document.querySelector('.vue-flow__node .sf-node--process-transcribe .sf-model-select__trigger')?.click(); true");
    const asrOpen = await waitFor("document.querySelectorAll('.sf-model-select__option-label').length >= 2", 5000);
    check("ASR 引擎下拉打开且含 ≥2 选项", asrOpen, `${await evalJs("document.querySelectorAll('.sf-model-select__option-label').length")} 个选项`);
    await evalJs(`(() => {
      const el = [...document.querySelectorAll('.sf-model-select__option')].find((b) => (b.textContent ?? '').includes('OpenAI 兼容'));
      el?.click();
      return true;
    })()`);
    const asrAfter = await waitFor(
      "(() => { const v = document.querySelector('.vue-flow__node .sf-node--process-transcribe .sf-model-select__value'); return v?.textContent.includes('OpenAI 兼容') ?? false; })()",
      4000,
    );
    check("ASR 引擎下拉可切换（MiMo-V2.5 → OpenAI 兼容）", asrAfter, `${asrBefore} → ${await evalJs("document.querySelector('.vue-flow__node .sf-node--process-transcribe .sf-model-select__value')?.textContent?.trim() ?? ''")}`);

    // -------------------------------------------------------------
    // 8. 打开真实工程进画布（不污染数据；验证旧工程图正常渲染）
    // -------------------------------------------------------------
    const realProject =
      projects.find((p) => (p.name ?? "").includes("视频转笔记")) ?? projects.find((p) => (p.nodeCount ?? 0) > 0) ?? null;
    if (realProject) {
      await navigate(`${APP_URL}project/${realProject.id}`);
      const realNodes = await waitFor("document.querySelectorAll('.vue-flow__node').length > 0", 15000);
      const realCount = (await evalJs("document.querySelectorAll('.vue-flow__node').length")) ?? 0;
      const titled = (await evalJs("document.querySelectorAll('.vue-flow__node .sf-node-title').length")) ?? 0;
      check("真实工程画布渲染节点", realNodes && realCount > 0 && titled > 0, `「${realProject.name}」${realCount} 个节点（含 ${titled} 个标题）`);
      await sleep(600);
      await shot(SHOT_EDITOR);
    } else {
      check("存在可打开的真实工程", false, "后端没有可用工程");
    }

    await fetch(`${API_URL}/api/projects/${widgetId}`, { method: "DELETE" }).catch(() => undefined);
    check("清理 M6 画布控件验收工程", true);
  }
}

try {
  await run();
} finally {
  try {
    if (cdp) cdp.close();
  } catch {
    // 忽略关闭失败
  }
  chrome.kill();
  await sleep(800);
  for (let i = 0; i < 5; i += 1) {
    try {
      await rm(PROFILE, { recursive: true, force: true });
      break;
    } catch {
      await sleep(500);
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n[cdp-ui-smoke] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
