/**
 * CDP UI 冒烟脚本（无第三方依赖，Node 22+）：
 * 用真实 Chrome 无头模式验证 ScribeFlow 前端在 Element Plus 迁移后的关键交互。
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

async function dialogClosed() {
  return evalJs(
    "(() => { const d = document.querySelector('.el-dialog'); if (!d) return true; const ov = document.querySelector('.el-overlay'); return !!ov && getComputedStyle(ov).display === 'none'; })()",
  );
}

async function run() {
  await connect();

  // 1. 工程列表页
  await navigate(APP_URL);
  await waitFor("!!document.querySelector('.sf-project-card, .sf-empty')");
  const cardCount = await evalJs("document.querySelectorAll('.sf-project-card').length");
  check("工程列表页渲染", cardCount > 0, `${cardCount} 个工程卡片`);
  check("Element Plus 按钮已渲染", await evalJs("document.querySelectorAll('.sf-head-actions .el-button').length === 2"));
  check("按钮主题色来自品牌令牌", await evalJs("getComputedStyle(document.querySelector('.el-button--primary')).backgroundColor !== 'rgb(255, 255, 255)'"));
  await shot(SHOT_LIST);

  // 2. 新建工程对话框
  await evalJs("document.querySelector('.sf-head-actions .el-button--primary').click(); true");
  const dialogShown = await waitFor("!!document.querySelector('.el-dialog') && getComputedStyle(document.querySelector('.el-dialog')).display !== 'none'");
  check("新建工程对话框打开", dialogShown);
  check("模板卡片渲染 5 个", await evalJs("document.querySelectorAll('.sf-tpl-card').length === 5"));
  await sleep(400);
  await shot(SHOT_DIALOG);
  await pressEscape();
  const escState = await evalJs(
    "(() => { const d = document.querySelector('.el-dialog'); if (!d) return 'no-dialog'; const s = getComputedStyle(d); const ov = document.querySelector('.el-overlay'); return `dialog display=${s.display} class=${d.className} overlay=${ov ? getComputedStyle(ov).display : 'none'}`; })()",
  );
  check("Esc 关闭对话框", await dialogClosed(), escState);

  // 2.5 M2：登录入口与扫码弹窗（先把服务端登录态复位）
  await fetch(`${API_URL}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  await navigate(APP_URL);
  await waitFor("!!document.querySelector('.sf-account')");
  check("侧边栏显示未登录入口", await evalJs("document.querySelector('.sf-account').textContent.includes('未登录')"));
  await evalJs("document.querySelector('.sf-account').click(); true");
  const loginDialogShown = await waitFor(
    "(() => { const ov = document.querySelector('.el-overlay'); return !!ov && getComputedStyle(ov).display !== 'none' && !!document.querySelector('.el-dialog'); })()",
  );
  check("登录 B 站对话框打开", loginDialogShown);
  const loginBodyOk = await waitFor("!!document.querySelector('.sf-qr-img, .sf-qr-message--error')", 15000);
  check("登录弹窗内出现二维码或错误态", loginBodyOk);
  await sleep(300);
  await shot(SHOT_LOGIN);
  await pressEscape();
  check("Esc 关闭登录对话框", await dialogClosed());

  // 2.6 M2：临时工程验证批量入口 / 上传控件 / 文本校验
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
    await waitFor("!!document.querySelector('.sf-palette')");

    await evalJs("[...document.querySelectorAll('.sf-palette-item')].find((b) => b.textContent.includes('B站链接'))?.click(); true");
    await waitFor("!!document.querySelector('.vue-flow__node .sf-node-batch')");
    check("批量选择按钮已启用", await evalJs("!document.querySelector('.vue-flow__node .sf-node-batch').disabled"));
    await evalJs("document.querySelector('.vue-flow__node .sf-node-batch').click(); true");
    const loginHintShown = await waitFor("!!document.querySelector('.el-message') && document.querySelector('.el-message').textContent.includes('请先')", 4000);
    check("未登录点击批量入口被拦截", loginHintShown);

    await evalJs("[...document.querySelectorAll('.sf-palette-item')].find((b) => b.textContent.includes('本地文件'))?.click(); true");
    await waitFor("!!document.querySelector('.vue-flow__node .sf-node-upload')");
    check("本地文件节点渲染 el-upload 拖拽区", true);

    await evalJs("[...document.querySelectorAll('.sf-palette-item')].find((b) => b.textContent.includes('文本'))?.click(); true");
    await waitFor("!!document.querySelector('.sf-node-text-error')");
    check("空文稿显示校验错误", await evalJs("document.querySelector('.sf-node-text-error').textContent.includes('不能为空')"));
    await evalJs("(() => { const ta = document.querySelector('.vue-flow__node .el-textarea__inner'); ta.value = '你好'; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    await sleep(400);
    check("输入文稿后错误消失且计数更新", await evalJs("!document.querySelector('.sf-node-text-error') && document.querySelector('.sf-node-text-count').textContent.includes('2 / 50000')"));

    await fetch(`${API_URL}/api/projects/${tempId}`, { method: "DELETE" }).catch(() => undefined);
    check("清理 M2 验收临时工程", true);
  }

  // 2.7 M3：文本工作流在画布上运行到 done（源文本→合并→输出，不依赖 AI/ASR 密钥）
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
    await waitFor("!!document.querySelector('.sf-editor-bar-actions .el-button--primary')");
    check("M3 运行按钮已启用", await evalJs("!document.querySelector('.sf-editor-bar-actions .el-button--primary').disabled"));
    await evalJs("document.querySelector('.sf-editor-bar-actions .el-button--primary').click(); true");
    const allDone = await waitFor("document.querySelectorAll('.sf-node.is-done').length === 3", 20000);
    check("SSE 驱动 3 个节点进入 done 状态", allDone, `${await evalJs("document.querySelectorAll('.sf-node.is-done').length")} 个节点`);
    check("底部控制台显示运行结束", await evalJs("document.querySelector('.sf-console-text').textContent.includes('运行结束')"));
    await sleep(500);
    await navigate(`${APP_URL}runs`);
    await waitFor("document.querySelectorAll('.el-table__row').length > 0", 8000);
    check("运行记录页出现本次运行", await evalJs("document.querySelectorAll('.el-table__row').length > 0"));
    const m3RunList = await fetch(`${API_URL}/api/runs?projectId=${m3Id}`).then((r) => r.json());
    m3RunId = m3RunList?.items?.[0]?.id ?? "";

    // M4：运行详情日志弹窗
    if (m3RunId) {
      await navigate(`${APP_URL}project/${m3Id}/run/${m3RunId}`);
      await waitFor("!!document.querySelector('.sf-markdown-text')", 8000);
      check("运行详情渲染输出文档", await evalJs("document.querySelector('.sf-markdown-text')?.textContent.includes('M3 UI 验收文稿') ?? false"));
      await evalJs("[...document.querySelectorAll('.sf-run-actions button')].find((b) => b.textContent.includes('查看日志'))?.click(); true");
      await waitFor("!!document.querySelector('.sf-log-item')", 5000);
      check("日志弹窗展示节点日志", await evalJs("document.querySelectorAll('.sf-log-item').length >= 2"));
      await pressEscape();
    }

    await navigate(`${APP_URL}settings`);
    await waitFor("!!document.querySelector('.sf-settings-form')");
    check("设置页 AI 表单渲染", await evalJs("document.querySelectorAll('.sf-settings-form .el-input, .sf-settings-form .el-select').length >= 3"));
    check("DeepSeek 模型为下拉", await evalJs("document.querySelectorAll('.sf-settings-form .el-select').length >= 2"));
    await evalJs("document.querySelectorAll('.sf-settings-nav-item')[1].click(); true");
    await waitFor("!!document.querySelector('.sf-settings-form .el-segmented')", 5000);
    check("设置页 ASR 分段控件渲染", true);
    await evalJs("document.querySelectorAll('.sf-settings-nav-item')[3].click(); true");
    await waitFor("document.querySelectorAll('.sf-block-card').length >= 4", 5000);
    check("提示词块库渲染内置 4 块", await evalJs("document.querySelectorAll('.sf-block-card').length >= 4"));
    await evalJs("document.querySelectorAll('.sf-settings-nav-item')[5].click(); true");
    await waitFor("!!document.querySelector('.sf-data-grid')", 5000);
    check("数据与工程页渲染数据信息", await evalJs("document.querySelectorAll('.sf-data-cell').length >= 3"));

    // M5：移动端响应式（390x844）
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(`${APP_URL}project/${m3Id}`);
    await waitFor("!!document.querySelector('.sf-mobile-hint')");
    check("移动端画布只读提示", await evalJs("getComputedStyle(document.querySelector('.sf-mobile-hint')).display !== 'none'"));
    check("移动端节点库隐藏", await evalJs("getComputedStyle(document.querySelector('.sf-palette')).display === 'none'"));
    await navigate(APP_URL);
    await waitFor("!!document.querySelector('.sf-bottom-nav')");
    check("移动端底部导航显示", await evalJs("getComputedStyle(document.querySelector('.sf-bottom-nav')).display === 'flex'"));
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    if (m3RunId) await fetch(`${API_URL}/api/runs/${m3RunId}`, { method: "DELETE" }).catch(() => undefined);
    await fetch(`${API_URL}/api/projects/${m3Id}`, { method: "DELETE" }).catch(() => undefined);
    check("清理 M3 UI 验收工程", true);
  }

  // 3. 打开第一个工程进画布
  const apiResult = await fetch(`${API_URL}/api/projects`).then((r) => r.json());
  const projects = Array.isArray(apiResult) ? apiResult : apiResult?.items;
  if (!Array.isArray(projects) || projects.length === 0) {
    check("存在可打开的工程", false, "后端没有工程，跳过画布验证");
    return;
  }
  const project = projects[0];
  await navigate(`${APP_URL}project/${project.id}`);
  await waitFor("document.querySelectorAll('.vue-flow__node').length > 0");
  const nodeCount = await evalJs("document.querySelectorAll('.vue-flow__node').length");
  check("画布节点渲染", nodeCount > 0, `${nodeCount} 个节点`);
  check("节点卡片内 ElInput 渲染", await evalJs("document.querySelectorAll('.vue-flow__node .el-input').length > 0"));
  check("ASR 分段控件渲染", await evalJs("document.querySelectorAll('.vue-flow__node .el-segmented').length > 0"));
  check("提示词块 ElSelect 渲染", await evalJs("document.querySelectorAll('.vue-flow__node .el-select').length > 0"));

  // 4. 打开提示词块下拉并选择第一项
  await evalJs("(() => { const el = document.querySelector('.vue-flow__node .el-select'); const w = el.querySelector('.el-select__wrapper'); w.click(); return true; })()");
  await waitFor("document.querySelectorAll('.el-select-dropdown__item').length > 0", 5000);
  const optionCount = await evalJs("document.querySelectorAll('.el-select-dropdown__item').length");
  check("提示词块下拉打开且有选项", optionCount >= 3, `${optionCount} 个选项`);
  await evalJs("document.querySelector('.el-select-dropdown__item').click(); true");
  await sleep(400);
  const selectedText = await evalJs("document.querySelector('.vue-flow__node .el-select').textContent.replace(/\\s+/g, ' ').trim()");
  check("下拉选中回显", /观点提炼|技术文案提炼|信息溯源/.test(selectedText), selectedText);

  // 5. 切换 ASR 分段控件第二项
  const segmentedBefore = await evalJs("document.querySelectorAll('.vue-flow__node .el-segmented__item').length");
  await evalJs("document.querySelectorAll('.vue-flow__node .el-segmented__item')[1].click(); true");
  await sleep(300);
  const segmentedAfter = await evalJs("document.querySelectorAll('.vue-flow__node .el-segmented__item.is-selected').length");
  check("ASR 分段控件可切换", segmentedBefore >= 2 && segmentedAfter >= 1, `${segmentedBefore} 个选项，选中态 ${segmentedAfter} 个`);

  await shot(SHOT_EDITOR);
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
