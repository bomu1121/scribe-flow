/**
 * 把一个 ZCode 会话导出并同步到坚果云（换机器时用）。
 *
 * 做法：
 *   1) 从 ZCode 会话库读这个会话的 message / part（权威来源是 db.sqlite；rollout jsonl 在 64 MB
 *      会被轮转、不含开头，不能当来源）；
 *   2) 生成三个文件：可读的 Markdown 纪要、全量 JSONL（保真）、关键产物清单 MANIFEST.md；
 *   3) 复用应用自己的 WebDAV 客户端（apps/server/src/lib/nutstore.ts）上传，行为与同步一致。
 *
 * 密码只在脚本内从应用设置库里读出来直接用：不打印，也不写进任何导出文件。
 *
 * 跑法（在 apps/server 目录下，这样 @scribe-flow/shared 的类型能解析到）：
 *   node --import tsx ../../scripts/sync-session-to-nutstore.mts [会话id]
 * 不传会话 id 时用下面的默认值；会话 id 可在 ~/.zcode/cli/db/db.sqlite 的 session 表里查。
 */
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { ensureRemoteDirectory, writeRemoteBuffer } from "../apps/server/src/lib/nutstore.ts";

const SESSION_ID = process.argv[2] ?? "sess_ba11aa4c-f4ae-43f0-a3af-2ee49762ba7c";

/* ---------- 1. 读坚果云配置（不打印密码） ---------- */
const appDb = new DatabaseSync(join(process.cwd(), "..", "..", "apps", "server", "data", "scribe-flow.sqlite"), { readOnly: true });
const get = (key) => {
  const row = appDb.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? String(row.value) : "";
};
const config = { serverUrl: get("nutstore.serverUrl"), account: get("nutstore.account"), password: get("nutstore.password") };
const remoteRoot = get("nutstore.remoteRoot") || "/ScribeFlow";
appDb.close();
if (!config.serverUrl || !config.account || !config.password) {
  console.error("坚果云配置不完整，停止。");
  process.exit(1);
}
console.log(`坚果云：${config.account} @ ${config.serverUrl}  根目录 ${remoteRoot}`);

/* ---------- 2. 读会话 ---------- */
const zdb = new DatabaseSync(join(homedir(), ".zcode", "cli", "db", "db.sqlite"), { readOnly: true });
const session = zdb.prepare("SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?").get(SESSION_ID);
if (!session) {
  console.error("找不到会话", SESSION_ID);
  process.exit(1);
}
const messages = zdb.prepare("SELECT id, sequence, data FROM message WHERE session_id = ? ORDER BY sequence").all(SESSION_ID);
const partsByMsg = new Map();
for (const p of zdb.prepare("SELECT message_id, sequence, data FROM part WHERE session_id = ? ORDER BY sequence").all(SESSION_ID)) {
  const list = partsByMsg.get(p.message_id) ?? [];
  list.push(JSON.parse(p.data));
  partsByMsg.set(p.message_id, list);
}
zdb.close();

/* ---------- 3. 脱敏 ---------- */
const secrets = [config.password];
const scrub = (text) =>
  secrets.reduce((acc, s) => (s && s.length > 5 ? acc.split(s).join("***（已脱敏）***") : acc), String(text ?? ""));

/* ---------- 4. 生成可读纪要 ---------- */
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString("zh-CN") : "");
const lines = [];
lines.push(`# ZCode 会话：${session.title}`);
lines.push("");
lines.push(`- 会话 id：\`${session.id}\``);
lines.push(`- 工作目录：\`${session.directory}\``);
lines.push(`- 时间：${fmtTime(session.time_created)} → ${fmtTime(session.time_updated)}`);
lines.push(`- 消息 ${messages.length} 条 / 片段 ${[...partsByMsg.values()].reduce((a, b) => a + b.length, 0)} 个`);
lines.push("");
lines.push("> 这份纪要保留全部**用户消息**与**助手正文**，工具调用只保留一行摘要（参数与输出截断）。");
lines.push("> 需要全量（含推理过程与完整工具输出）看同目录的 `session.jsonl`。");
lines.push("");
lines.push("---");
lines.push("");

let toolCount = 0;
for (const m of messages) {
  const md = JSON.parse(m.data);
  const role = md.role === "user" ? "用户" : md.role === "assistant" ? "助手" : md.role;
  const parts = partsByMsg.get(m.id) ?? [];
  const bucket = [];
  for (const p of parts) {
    if (p.type === "text" && String(p.text || "").trim()) {
      bucket.push(scrub(p.text).trim());
    } else if (p.type === "tool") {
      toolCount += 1;
      const name = p.tool ?? p.state?.tool ?? "tool";
      const input = scrub(JSON.stringify(p.state?.input ?? {})).slice(0, 300);
      const output = scrub(String(p.state?.output ?? "")).slice(0, 300);
      const status = p.state?.status ?? "";
      bucket.push(`> \`[工具]\` **${name}** (${status})\n> 入参：\`${input}\`${output ? `\n> 输出：\`${output.replace(/\n/g, " ")}\`` : ""}`);
    }
  }
  if (bucket.length === 0) continue;
  lines.push(`## ${role} · ${fmtTime(md.time?.created ?? 0)}`);
  lines.push("");
  lines.push(bucket.join("\n\n"));
  lines.push("");
}

const mdText = scrub(lines.join("\n"));
const jsonl = messages
  .map((m) => {
    const md = JSON.parse(m.data);
    const parts = partsByMsg.get(m.id) ?? [];
    return JSON.stringify({ message: { id: m.id, sequence: m.sequence, role: md.role, time: md.time }, parts });
  })
  .join("\n");

/* ---------- 5. 关键产物清单 ---------- */
const REPO = "D:\\Develop\\scribe-flow";
const artifacts = [
  ["sharing/ROOM.md", "**现场手册**：那天说什么、绝不投什么、竞品答法、被问什么"],
  ["sharing/QA.md", "答辩备查：本次真查过的问题（现象→定位→改法→证据强度）"],
  ["sharing/SPEECH.md", "逐页讲稿（18 页 PPT 的配套）"],
  ["sharing/README.md", "分享材料总目录（含 PPT 与导出图）"],
  ["sharing/out/ScribeFlow-前端技术分享.pptx", "18 页 PPT 成品"],
  ["docs/research/project-audit-2026-09-27.md", "全项目审计：七个区域逐文件走过，60 条分级"],
  ["sharing/MODULES.md", "逐模块口播稿（前端优先，被追问具体实现时看它）"],
  ["docs/research/repo-legibility-and-over-engineering.md", "仓库可读性与过度工程调研"],
  ["docs/research/r1-desktop-research.md", "市场调研：20 个竞品的产品功能地图"],
  ["apps/web/src/components/canvas/FlowCanvas.vue", "本次唯一改动的源码：视口裁剪 + 事件合流 + ELK 进 Worker"],
  ["docs/status.md", "项目现状（进度、缺口、关键数字）"],
  ["AGENTS.md", "给 AI/人的仓库入口说明"],
  ["CHANGELOG.md", "变更记录"],
];
const manifest = [
  `# 关键产物在哪（${new Date().toLocaleDateString("zh-CN")}）`,
  "",
  `仓库：\`${REPO}\``,
  "",
  "| 文件 | 是什么 |",
  "| --- | --- |",
  ...artifacts.map(([p, d]) => `| \`${p}\` | ${d} |`),
  "",
  "## 换一台电脑之后怎么接上",
  "",
  "1. 先读 `sharing/ROOM.md`：那份是分享当天的执行稿，其余都是它的备料。",
  "2. 想复现演示：`pnpm dev`，打开任意一个有节点、有连线的工程即可。",
  "3. 想看这次会话在聊什么：同目录的 `session.md`（可读）与 `session.jsonl`（全量）。",
  "4. 画布性能那三处改动在 `apps/web/src/components/canvas/FlowCanvas.vue`，报告里写了为什么。",
  "",
  "## 文件是否在仓库里",
  "",
  "| 路径 | 在仓库里？ |",
  "| --- | --- |",
  ...artifacts.map(([p]) => `| \`${p}\` | ${existsSync(join(process.cwd(), "..", "..", p)) ? "是" : "否（或未提交）"} |`),
  "",
].join("\n");

/* ---------- 6. 落地到本地临时目录 ---------- */
// 用本地日期做目录名（toISOString 是 UTC，凌晨跑会差一天）
const now = new Date();
const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const remoteDir = `${remoteRoot}/ZCode会话/${dateTag}-${session.title.replace(/[\\/:*?"<>|]/g, "_")}`;
const outDir = join(tmpdir(), `sf-session-${dateTag}`);
mkdirSync(outDir, { recursive: true });
const files = [
  ["session.md", Buffer.from(mdText, "utf8"), "text/markdown; charset=utf-8"],
  ["session.jsonl", Buffer.from(jsonl, "utf8"), "application/x-ndjson; charset=utf-8"],
  ["MANIFEST.md", Buffer.from(manifest, "utf8"), "text/markdown; charset=utf-8"],
];
for (const [name, buf] of files) {
  const p = join(outDir, name);
  writeFileSync(p, buf);
  console.log(`本地：${p}  ${(statSync(p).size / 1024).toFixed(0)} KB`);
}

/* ---------- 7. 上传 ---------- */
await ensureRemoteDirectory(config, remoteDir);
console.log("远端目录已就绪：", remoteDir);
for (const [name, buf, contentType] of files) {
  await writeRemoteBuffer(config, `${remoteDir}/${name}`, buf, contentType);
  console.log(`已上传：${remoteDir}/${name}`);
}
console.log("");
console.log(`完成。会话纪要（用户+助手正文，工具一行摘要）${(mdText.length / 1024).toFixed(0)} KB，`
  + `全量 JSONL ${(jsonl.length / 1024).toFixed(0)} KB，工具调用 ${toolCount} 次。`);
