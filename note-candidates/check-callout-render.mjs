/**
 * 应用内渲染的端到端验证：在**真实浏览器**里调用应用自己的 `renderMarkdown`
 * （marked + DOMPurify 全链路），确认 Obsidian callout 在应用里也画得出来。
 *
 * 为什么必须真跑：单元测试跑在 node 环境里，`DOMPurify` 依赖 DOM，那条路径测不到；
 * 而 `details` / `summary` / `open` / `data-*` 能不能过它默认的白名单，只有真跑才知道。
 *
 * 前置：`pnpm dev:web`。**Vite 在本机只监听 IPv6**（`netstat` 里显示为 `[::1]:5173`），
 * 所以地址要写 `http://[::1]:<port>/`，端口以启动日志里那一行为准（5173 被占时它会顺延）。
 * 用法：
 *   APP_URL="http://[::1]:5176/" node note-candidates/check-callout-render.mjs
 *   ... --shot    顺便用真实产物渲一遍应用内截图（写进 docs/research/）
 *   REUSE=1 ...   连已开着的 Chrome（手动起过调试实例时用）
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9347);
const APP = process.env.APP_URL ?? "http://127.0.0.1:5173/";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** REUSE=1：不再另起 Chrome，连已开着的那个（手动起 Chrome 调试时用）。 */
const REUSE = process.env.REUSE === "1";
const chrome = REUSE
  ? { kill() {} }
  : spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${PORT}`, "--user-data-dir=.tmp-shots/obs-typography/profile-verify", "about:blank"], { stdio: "ignore" });

let ws;
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const id = (msgId += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
};

try {
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          const entry = pending.get(message.id);
          if (!entry) return;
          pending.delete(message.id);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        });
        break;
      }
    } catch {
      /* Chrome 还没起来 */
    }
    await sleep(250);
  }
  if (!ws) throw new Error("连不上 Chrome");

  await send("Page.enable");
  // 视口要给够高：截图容器是固定定位的，视口只有几百像素时它下半部分根本不渲染（截图会留白）
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 2400, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  await sleep(2500);

  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const mod = await import("/src/lib/markdown.ts");
      const cases = {
        速览: "> [!summary] 速览\\n> - 第一条\\n> - 第二条",
        速查折叠: "> [!example]- 速查\\n> **数字**\\n>\\n> - **税率**：百分之十二点四",
        速查展开: "> [!example]+ 速查\\n> - 一",
        普通引用: "> 普通引用",
      };
      const out = {};
      for (const [name, src] of Object.entries(cases)) out[name] = mod.renderMarkdown(src);
      return JSON.stringify(out);
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const raw = result.result?.value ?? result.exceptionDetails ?? result;
  if (typeof raw !== "string") {
    console.log("调试：evaluate 返回了非字符串\n", JSON.stringify(result).slice(0, 1200));
    process.exit(1);
  }
  const html = JSON.parse(raw);
  const checks = [
    ["速览：还原成 callout 盒子（data-callout 过白名单）", html["速览"].includes('data-callout="summary"')],
    ["速览：字面的 [!summary] 不再出现", !html["速览"].includes("[!summary]")],
    ["速览：标题行是 速览", html["速览"].includes("速览")],
    ["速览：条目渲染成列表", html["速览"].includes("<li>第一条</li>")],
    ["速查：`-` 出 details 且不带 open（默认折叠）", html["速查折叠"].includes("<details") && !/<details[^>]*\sopen/.test(html["速查折叠"])],
    ["速查：`+` 带 open（默认展开）", /<details[^>]*\sopen/.test(html["速查展开"])],
    ["速查：data-tone 通过白名单", html["速查折叠"].includes('data-tone="neutral"')],
    ["速查：组名与条目都在框内", html["速查折叠"].includes("数字") && html["速查折叠"].includes("税率")],
    ["普通引用块没被误伤", html["普通引用"].includes("<blockquote>") && !html["普通引用"].includes("data-callout")],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`\n[check-callout-render] ${checks.length - failed}/${checks.length} 项通过`);
  if (failed > 0) {
    console.log("\n--- 实际 HTML（速览）---\n" + html["速览"]);
    console.log("\n--- 实际 HTML（速查折叠）---\n" + html["速查折叠"]);
    process.exitCode = 1;
  }

  /* ---------------------------------------------------- --shot：出应用内截图 */
  if (process.argv.includes("--shot")) {
    const SAMPLE = "note-candidates/排版方案demo/B2-真实产物（改版后真跑）.md";
    const body = readFileSync(SAMPLE, "utf8").replace(/^---[\s\S]*?\n---\n+/, "").replace(/^# .+\n+/, "").trim();
    const sulan = body.slice(0, body.indexOf("\n## "));
    const zhengwen = body.slice(body.indexOf("\n## ") + 1, body.indexOf("\n> [!example]")).split("\n").slice(0, 6).join("\n");
    const sucha = body.slice(body.indexOf("> [!example]"));

    const shoot = async (markdown, openSucha, file) => {
      const put = `(async () => {
        const mod = await import("/src/lib/markdown.ts");
        let host = document.getElementById("shot-host");
        if (!host) {
          host = document.createElement("div");
          host.id = "shot-host";
          // 固定定位 + 顶层 z-index：应用是整屏工作台布局，普通追加的容器会被裁掉/压住
          host.style.cssText = "position: fixed; top: 0; left: 0; z-index: 2147483647; width: 900px; background: var(--color-surface, #fff); padding: 14px 22px; overflow: visible;";
          document.body.appendChild(host);
        }
        host.innerHTML = '<div class="markdown-body" style="max-width: 720px;">' + mod.renderMarkdown(${JSON.stringify(markdown)}) + "</div>";
        if (${openSucha}) for (const d of host.querySelectorAll("details")) d.open = true;
        scrollTo(0, 0);
        return true;
      })()`;
      await send("Runtime.evaluate", { expression: put, awaitPromise: true, returnByValue: true });
      await sleep(250); // 等展开后的重排落定再量高度，否则截图底部会留一条空白
      const measured = await send("Runtime.evaluate", {
        expression: `(() => { const r = document.getElementById("shot-host").getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }); })()`,
        returnByValue: true,
      });
      const rect = JSON.parse(measured.result.value);
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
      });
      mkdirSync("docs/research", { recursive: true });
      writeFileSync(`docs/research/${file}`, Buffer.from(shot.data, "base64"));
      console.log(`[check-callout-render] docs/research/${file}  ${Math.round(rect.width)}×${Math.round(rect.height)}`);
    };

    await shoot(`${sulan}\n${zhengwen}`, false, "obsidian-note-typography-app-callout.png");
    await shoot(sucha, false, "obsidian-note-typography-app-sucha-folded.png");
    await shoot(sucha, true, "obsidian-note-typography-app-sucha-open.png");
  }
} finally {
  chrome.kill();
  ws?.close();
}
