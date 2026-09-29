/**
 * B 站接口的手工自检：**需要能访问 B 站**（二维码是向 B 站真实申请的），所以不进 CI。
 *
 * 前置：pnpm dev。用法：pnpm check:api:bili
 *
 * 这里只留「必须联网」的那几条。未登录契约、上传校验、退出幂等这些不联网的断言
 * 已经迁进 `apps/server/src/routes/auth-upload.test.ts`，由 CI 每次执行。
 * 真正扫码登录之后的流程（收藏夹 / 合集 / 稍后再看）仍然只能手工验。
 */
const BASE = process.env.API_URL ?? "http://localhost:8787";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function j(method, path) {
  const res = await fetch(`${BASE}${path}`, { method });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // 无 JSON 响应体
  }
  return { res, body };
}

/** B 站不可达时给出明确提示，而不是把网络错误伪装成断言失败。 */
async function reachable() {
  try {
    await fetch("https://api.bilibili.com/x/web-interface/nav", { method: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

if (!(await reachable())) {
  console.log("[bili-api-check] 访问不到 B 站，跳过（这条自检必须联网）");
  process.exit(0);
}

const qr = await j("POST", "/api/auth/qr");
check(
  "POST /api/auth/qr 返回二维码与 180 秒有效期",
  qr.res.ok && Boolean(qr.body?.qrId) && String(qr.body?.image ?? "").startsWith("data:image/") && qr.body?.expiresIn === 180,
  JSON.stringify({ status: qr.res.status, qrId: Boolean(qr.body?.qrId), expiresIn: qr.body?.expiresIn }),
);

if (qr.body?.qrId) {
  const poll = await j("GET", `/api/auth/qr/${qr.body.qrId}`);
  check("GET /api/auth/qr/:qrId 报未扫码", poll.res.ok && ["waiting", "scanned", "expired"].includes(poll.body?.status), `status=${poll.body?.status}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n[bili-api-check] ${results.length - failed}/${results.length} 项通过`);
if (failed > 0) process.exit(1);
