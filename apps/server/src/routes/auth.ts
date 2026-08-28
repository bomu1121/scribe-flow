import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { biliCookies, biliSessions } from "../db/schema";
import { BiliApiError, fetchBiliAccount, pollBiliQr, renderQrDataUrl, startBiliQr } from "../lib/bilibili";

const QR_TTL_MS = 180 * 1000;

/** qrId -> qrcodeKey。密钥不落库，仅保存在进程内。 */
const qrKeys = new Map<string, { qrcodeKey: string; expiresAt: number }>();

function cleanExpiredQr() {
  const now = Date.now();
  for (const [id, entry] of qrKeys) {
    if (entry.expiresAt <= now) qrKeys.delete(id);
  }
}

export function authApi(db: AppDatabase) {
  const api = new Hono();

  api.post("/qr", async (c) => {
    const ticket = await startBiliQr().catch((err) => {
      const message = err instanceof Error ? err.message : "申请二维码失败";
      return c.json({ error: message }, 502);
    });
    if (!ticket || "status" in ticket) return ticket;

    const qrId = randomUUID();
    qrKeys.set(qrId, { qrcodeKey: ticket.qrcodeKey, expiresAt: Date.now() + QR_TTL_MS });
    await db.insert(biliSessions).values({ id: qrId, status: "waiting", createdAt: Date.now(), expiresAt: Date.now() + QR_TTL_MS });

    const image = await renderQrDataUrl(ticket.url);
    return c.json({ qrId, image, expiresIn: 180 });
  });

  api.get("/qr/:qrId", async (c) => {
    cleanExpiredQr();
    const qrId = c.req.param("qrId");
    const entry = qrKeys.get(qrId);
    if (!entry) {
      return c.json({ status: "expired" });
    }
    if (entry.expiresAt <= Date.now()) {
      qrKeys.delete(qrId);
      await db.update(biliSessions).set({ status: "expired" }).where(eq(biliSessions.id, qrId));
      return c.json({ status: "expired" });
    }

    try {
      const result = await pollBiliQr(entry.qrcodeKey);
      if (result.status === "waiting" || result.status === "scanned") {
        await db
          .update(biliSessions)
          .set({ status: result.status })
          .where(eq(biliSessions.id, qrId));
        return c.json({ status: result.status });
      }
      if (result.status === "expired") {
        qrKeys.delete(qrId);
        await db.update(biliSessions).set({ status: "expired" }).where(eq(biliSessions.id, qrId));
        return c.json({ status: "expired" });
      }

      if (!result.cookie) {
        return c.json({ status: "waiting", error: "登录成功但未取得 Cookie，请重试" });
      }
      const user = await fetchBiliAccount(result.cookie);
      await db
        .insert(biliCookies)
        .values({ id: 1, cookie: result.cookie, mid: user.mid, uname: user.uname, face: user.face, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: biliCookies.id,
          set: { cookie: result.cookie, mid: user.mid, uname: user.uname, face: user.face, updatedAt: Date.now() },
        });
      qrKeys.delete(qrId);
      await db.update(biliSessions).set({ status: "success" }).where(eq(biliSessions.id, qrId));
      return c.json({ status: "success", user });
    } catch (err) {
      if (err instanceof BiliApiError && err.code === -101) {
        return c.json({ status: "expired" });
      }
      throw err;
    }
  });

  api.get("/status", async (c) => {
    const row = await db.select().from(biliCookies).where(eq(biliCookies.id, 1)).get();
    if (!row) return c.json({ loggedIn: false });
    return c.json({ loggedIn: true, user: { mid: row.mid, uname: row.uname, face: row.face } });
  });

  api.post("/logout", async (c) => {
    await db.delete(biliCookies).where(eq(biliCookies.id, 1));
    return c.json({ ok: true });
  });

  return api;
}
