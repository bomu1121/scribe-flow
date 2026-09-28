import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunMeta } from "@scribe-flow/shared";
import { createApp } from "../app";
import { createDatabase } from "../db/client";
import { runs } from "../db/schema";

const cleanupDirs: string[] = [];

afterEach(async () => {
  // Windows 上 sqlite 句柄可能短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-runs-api-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, db };
}

type App = ReturnType<typeof createApp>;

async function patch(app: App, path: string, body: unknown) {
  return app.request(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function seedRun(db: ReturnType<typeof createDatabase>, id: string) {
  db.insert(runs)
    .values({
      id,
      projectId: "p1",
      status: "interrupted",
      scope: "all",
      createdAt: Date.now(),
      summary: "2 个节点已完成",
      error: "服务重启，运行已中断",
    })
    .run();
}

describe("PATCH /api/runs/:id（重命名）", () => {
  it("改名后列表与详情都带上了这个名字", async () => {
    const { app, db } = await setup();
    seedRun(db, "run_a");

    const res = await patch(app, "/api/runs/run_a", { name: "第 12 期 · 记忆系统" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as RunMeta).name).toBe("第 12 期 · 记忆系统");

    const list = (await (await app.request("/api/runs?projectId=p1")).json()) as { items: RunMeta[] };
    expect(list.items.find((item) => item.id === "run_a")?.name).toBe("第 12 期 · 记忆系统");
  });

  it("首尾空白不算名字内容", async () => {
    const { app, db } = await setup();
    seedRun(db, "run_a");

    const res = await patch(app, "/api/runs/run_a", { name: "  记忆系统  " });
    expect(((await res.json()) as RunMeta).name).toBe("记忆系统");
  });

  it("传空串或 null 是「清掉名字」，回落到时间与状态", async () => {
    const { app, db } = await setup();
    seedRun(db, "run_a");
    await patch(app, "/api/runs/run_a", { name: "先起个名" });

    for (const cleared of ["", "   ", null]) {
      const res = await patch(app, "/api/runs/run_a", { name: cleared });
      expect(res.status).toBe(200);
      expect(((await res.json()) as RunMeta).name).toBeUndefined();
    }
  });

  it("改名只动名字，状态、摘要、错误一个字不改", async () => {
    const { app, db } = await setup();
    seedRun(db, "run_a");

    const meta = (await (await patch(app, "/api/runs/run_a", { name: "记忆系统" })).json()) as RunMeta;
    expect(meta).toMatchObject({ status: "interrupted", summary: "2 个节点已完成", error: "服务重启，运行已中断" });
  });

  it("超过 80 个字被拒，且名字保持原样", async () => {
    const { app, db } = await setup();
    seedRun(db, "run_a");
    await patch(app, "/api/runs/run_a", { name: "短名字" });

    const res = await patch(app, "/api/runs/run_a", { name: "字".repeat(81) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("80");

    const list = (await (await app.request("/api/runs?projectId=p1")).json()) as { items: RunMeta[] };
    expect(list.items.find((item) => item.id === "run_a")?.name).toBe("短名字");
  });

  it("请求体缺 name 或不是字符串时拒绝，不静默清名", async () => {
    const { app, db } = await setup();
    seedRun(db, "run_a");
    await patch(app, "/api/runs/run_a", { name: "短名字" });

    for (const body of [{}, { name: 12 }]) {
      expect((await patch(app, "/api/runs/run_a", body)).status).toBe(400);
    }

    const list = (await (await app.request("/api/runs?projectId=p1")).json()) as { items: RunMeta[] };
    expect(list.items.find((item) => item.id === "run_a")?.name).toBe("短名字");
  });

  it("运行不存在返回 404", async () => {
    const { app } = await setup();
    expect((await patch(app, "/api/runs/run_missing", { name: "x" })).status).toBe(404);
  });
});
