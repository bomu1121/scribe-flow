/**
 * M2 API 自检（不依赖 B 站真实登录）。
 * 前置：pnpm dev（后端 8787 已启动）。
 * 用法：node scripts/m2-api-check.mjs
 */
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.env.API_URL ?? "http://localhost:8787";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // 无 JSON 响应体
  }
  return { res, body };
}

async function run() {
  // 1. 登录二维码生命周期
  const qr = await request("/api/auth/qr", { method: "POST" });
  check("POST /api/auth/qr", qr.res.ok && Boolean(qr.body?.qrId) && String(qr.body?.image ?? "").startsWith("data:image/") && qr.body?.expiresIn === 180, JSON.stringify({ status: qr.res.status, qrId: Boolean(qr.body?.qrId), expiresIn: qr.body?.expiresIn }));
  const qrId = qr.body?.qrId;

  const poll = qrId ? await request(`/api/auth/qr/${qrId}`) : { res: { ok: false, status: 0 }, body: null };
  check("GET /api/auth/qr/:qrId 未扫码", poll.res.ok && ["waiting", "scanned", "expired"].includes(poll.body?.status), `status=${poll.body?.status}`);

  // 2. 未登录状态与拦截
  const status = await request("/api/auth/status");
  check("GET /api/auth/status 未登录", status.res.ok && status.body?.loggedIn === false);

  const folders = await request("/api/bilibili/fav/folders");
  check("未登录访问收藏夹返回 401 中文错误", folders.res.status === 401 && /请先登录/.test(folders.body?.error ?? ""), `${folders.res.status} ${folders.body?.error}`);

  // 3. 文件上传：合法 mp4
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])], { type: "video/mp4" }), "验收样例.mp4");
  const upload = await request("/api/files/upload", { method: "POST", body: form });
  check(
    "POST /api/files/upload 合法 mp4",
    upload.res.ok && Boolean(upload.body?.fileId) && upload.body?.fileName === "验收样例.mp4" && upload.body?.storedPath?.startsWith("uploads/"),
    JSON.stringify({ status: upload.res.status, error: upload.body?.error }),
  );
  if (upload.body?.storedPath) {
    try {
      await unlink(join(ROOT, "apps", "server", "data", upload.body.storedPath));
    } catch {
      // 清理失败不阻塞验收
    }
  }

  // 4. 文件上传：拒绝 txt
  const badForm = new FormData();
  badForm.append("file", new Blob(["not a video"], { type: "text/plain" }), "readme.txt");
  const badUpload = await request("/api/files/upload", { method: "POST", body: badForm });
  check("POST /api/files/upload 拒绝 txt", badUpload.res.status === 400 && /仅支持/.test(badUpload.body?.error ?? ""), `${badUpload.res.status} ${badUpload.body?.error}`);

  // 5. 退出登录（未登录时也应幂等成功）
  const logout = await request("/api/auth/logout", { method: "POST" });
  check("POST /api/auth/logout 幂等", logout.res.ok && logout.body?.ok === true);
}

await run();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[m2-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
