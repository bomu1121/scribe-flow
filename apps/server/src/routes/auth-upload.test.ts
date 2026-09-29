import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDatabase } from "../db/client";

/**
 * 登录态契约与文件上传的集成测试（进程内，不联网）。
 *
 * 原先是 `scripts/m2-api-check.mjs` 的一部分，但它要先把 `pnpm dev` 拉起来才能跑，
 * 因此从不在 CI 执行。这里只保留**不依赖 B 站网络**的那几条：未登录契约、上传校验、退出幂等。
 * 真正需要访问 B 站的二维码生命周期留在 `scripts/bili-api-check.mjs`（手工跑）。
 *
 * 上传路径的包含性（`storedPath` 落在 uploads 目录内）由 `storage.test.ts` 覆盖，这里验的是 HTTP 契约。
 */
const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-auth-upload-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, dataDir };
}

type App = ReturnType<typeof createApp>;

const upload = (app: App, body: FormData) => app.request("/api/files/upload", { method: "POST", body });

const mp4Form = () => {
  const form = new FormData();
  const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  form.append("file", new Blob([bytes], { type: "video/mp4" }), "验收样例.mp4");
  return form;
};

describe("未登录契约", () => {
  it("status 报未登录，收藏夹返回 401 中文错误", async () => {
    const { app } = await setup();

    const status = await app.request("/api/auth/status");
    expect(status.status).toBe(200);
    expect(((await status.json()) as { loggedIn: boolean }).loggedIn).toBe(false);

    const folders = await app.request("/api/bilibili/fav/folders");
    expect(folders.status).toBe(401);
    expect(((await folders.json()) as { error: string }).error).toContain("请先登录");
  });

  it("退出登录幂等：未登录时也返回 ok", async () => {
    const { app } = await setup();
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("文件上传校验", () => {
  it("接受 mp4，保留原文件名，落在 uploads/ 下", async () => {
    const { app, dataDir } = await setup();
    const res = await upload(app, mp4Form());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileId: string; fileName: string; storedPath: string; size: number };
    expect(body.fileId).toBeTruthy();
    expect(body.fileName).toBe("验收样例.mp4");
    expect(body.storedPath.startsWith("uploads/")).toBe(true);
    expect(body.size).toBe(8);
    // 确实写进了 data 目录（而不是工作目录）；上传目录由路由自己保证存在
    await expect(rm(join(dataDir, body.storedPath))).resolves.toBeUndefined();
  });

  it("扩展名不在白名单时报 400", async () => {
    const { app } = await setup();
    const form = new FormData();
    form.append("file", new Blob(["not a video"], { type: "text/plain" }), "readme.txt");
    const res = await upload(app, form);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("仅支持");
  });

  it("扩展名合法但 MIME 不是音视频时报 400", async () => {
    const { app } = await setup();
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "fake.mp4");
    const res = await upload(app, form);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("不是音频或视频");
  });

  it("缺少文件字段时报 400", async () => {
    const { app } = await setup();
    const res = await upload(app, new FormData());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("缺少上传文件");
  });

  it("超过体积上限时报 413", async () => {
    const { app } = await setup();
    const form = new FormData();
    const big = new Uint8Array(11 * 1024 * 1024);
    form.append("file", new Blob([big], { type: "video/mp4" }), "big.mp4");
    const res = await upload(app, form);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain("10MB");
  });
});
