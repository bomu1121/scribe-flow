import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createDatabase } from "./db/client";

/** 跨站防线（app 级中间件）的验收：夹具与 auth-upload.test.ts 相同，只测门，不测业务。 */
const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-origin-guard-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  return createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
}

describe("跨站防线", () => {
  it("无 Origin 的请求放行（curl / 服务端调用）", async () => {
    const app = await setup();
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("与请求 Host 同源的 Origin 放行（生产部署由本服务托管前端）", async () => {
    const app = await setup();
    const res = await app.request("/api/health", { headers: { Origin: "http://127.0.0.1:8787", Host: "127.0.0.1:8787" } });
    expect(res.status).toBe(200);
  });

  it("本机开发前端的来源放行（Vite dev / preview，经代理转发到 8787）", async () => {
    const app = await setup();
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]) {
      const res = await app.request("/api/health", { headers: { Origin: origin, Host: "127.0.0.1:8787" } });
      expect(res.status, origin).toBe(200);
    }
  });

  it("其他来源一律 403，GET 与带副作用的 POST 都拦", async () => {
    const app = await setup();
    const get = await app.request("/api/health", { headers: { Origin: "http://evil.example", Host: "127.0.0.1:8787" } });
    expect(get.status).toBe(403);
    expect(((await get.json()) as { error: string }).error).toContain("跨站请求被拒绝");

    const post = await app.request("/api/projects", {
      method: "POST",
      headers: { Origin: "http://evil.example", Host: "127.0.0.1:8787", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "不该被创建" }),
    });
    expect(post.status).toBe(403);
  });

  it("CORS_ORIGIN 显式配置的具体来源放行；* 不等于全开", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://my-frontend.example");
    const app = await setup();
    const allowed = await app.request("/api/health", { headers: { Origin: "https://my-frontend.example", Host: "127.0.0.1:8787" } });
    expect(allowed.status).toBe(200);

    vi.stubEnv("CORS_ORIGIN", "*");
    const wildcard = await app.request("/api/health", { headers: { Origin: "http://evil.example", Host: "127.0.0.1:8787" } });
    expect(wildcard.status).toBe(403);
  });
});
