import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupLocationOf, joinBackupPath } from "@scribe-flow/shared";
import { createApp } from "../app";
import { createDatabase } from "../db/client";

/**
 * 备份目录现在可以是**本地文件夹**（放坚果云同步文件夹里，由客户端上传），
 * 也可以是云端路径（WebDAV 直连）——按路径形状自动判定，没有模式开关。
 *
 * 这里验的是本地那一条：它必须**在完全没配账号密码**的情况下也能备份/列出/恢复。
 * 走真实 `createApp` + `app.request`，因为「不需要凭据」这件事只有从接口层才测得出来。
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-backup-local-"));
  tmpDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const backupDir = join(root, "同步文件夹", "ScribeFlow", "backups");
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, dataDir, backupDir, db };
}

const settingsPut = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const post = (app: ReturnType<typeof createApp>, path: string, body?: unknown) =>
  app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

describe("备份落点：按路径形状判定", () => {
  it("盘符路径与 UNC 算本地，以 / 开头算云端", () => {
    expect(backupLocationOf("D:\\我的坚果云\\ScribeFlow\\backups")).toBe("local");
    expect(backupLocationOf("c:/Users/x/backups")).toBe("local");
    expect(backupLocationOf("\\\\nas\\share\\backups")).toBe("local");
    expect(backupLocationOf("/我的坚果云/ScribeFlow/backups")).toBe("remote");
    expect(backupLocationOf("ScribeFlow/backups")).toBe("remote");
  });

  it("拼子路径时用对分隔符", () => {
    expect(joinBackupPath("D:\\a\\b", "c")).toBe("D:\\a\\b\\c");
    expect(joinBackupPath("/我的坚果云/ScribeFlow", "c")).toBe("/我的坚果云/ScribeFlow/c");
    expect(joinBackupPath("D:\\a\\", "c")).toBe("D:\\a\\c");
  });
});

describe("备份到本地文件夹（不需要账号密码）", () => {
  it("备份 → 列出 → 恢复全程不碰 WebDAV", async () => {
    const { app, backupDir, db } = await setup();
    // 故意只填备份目录：不配 serverUrl / account / password。
    await settingsPut(app, { nutstore: { backupDir } });

    const status = (await (await app.request("/api/nutstore/status")).json()) as { backupDir: string; backupLocation: string };
    expect(status.backupLocation).toBe("local");
    expect(status.backupDir).toBe(backupDir);

    // 备份
    const backup = (await (await post(app, "/api/nutstore/backup")).json()) as { dir: string; location: string; files: string[] };
    expect(backup.location).toBe("local");
    expect(backup.files).toContain("scribe-flow.sqlite");
    expect(existsSync(join(backup.dir, "scribe-flow.sqlite"))).toBe(true);
    expect(existsSync(join(backup.dir, "backup.json"))).toBe(true);
    const meta = JSON.parse(await readFile(join(backup.dir, "backup.json"), "utf8")) as { app: string; location: string };
    expect(meta.app).toBe("scribe-flow");
    expect(meta.location).toBe("local");

    // 列出
    const listed = (await (await app.request("/api/nutstore/backups")).json()) as { path: string; items: { path: string; name: string }[] };
    expect(listed.path).toBe(backupDir);
    expect(listed.items.map((item) => item.name)).toEqual([backup.dir.split(/[\\/]/).pop()]);

    // 恢复：先制造一处「脏」数据，恢复后应回滚掉
    const raw = (db as unknown as {
      $client: { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown } };
    }).$client;
    const now = Date.now();
    raw
      .prepare(
        "INSERT INTO projects (id, name, description, graph_json, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("p_dirty", "备份之后才建的", "", "{}", 1, now, now);
    const rowCount = () =>
      (raw.prepare("SELECT COUNT(*) AS c FROM projects WHERE id = 'p_dirty'").get() as { c: number }).c;
    expect(rowCount()).toBe(1);

    const restored = (await (await post(app, "/api/nutstore/restore", { path: backup.dir })).json()) as {
      ok: boolean;
      restoredPath: string;
      autoBackupPath: string;
      tables: string[];
    };
    expect(restored.ok).toBe(true);
    expect(restored.restoredPath).toBe(backup.dir);
    expect(restored.tables).toContain("projects");
    expect(rowCount()).toBe(0);
    // 「后悔药」也落在同一个本地目录里
    expect(existsSync(restored.autoBackupPath)).toBe(true);
    expect(backupLocationOf(restored.autoBackupPath)).toBe("local");
    const siblings = await readdir(backupDir);
    expect(siblings.length).toBeGreaterThanOrEqual(2);
  });

  it("本地备份目录不存在时，列出返回空而不是报错（目录还没建是正常状态）", async () => {
    const { app, backupDir } = await setup();
    await settingsPut(app, { nutstore: { backupDir: join(backupDir, "还不存在") } });
    const listed = (await (await app.request("/api/nutstore/backups")).json()) as { items: unknown[] };
    expect(listed.items).toEqual([]);
  });

  it("恢复一个不是备份的目录时明确拒绝，不裸覆盖", async () => {
    const { app, backupDir } = await setup();
    await settingsPut(app, { nutstore: { backupDir } });
    const empty = join(backupDir, "..", "不是备份的目录");
    await mkdir(empty, { recursive: true });
    const res = await post(app, "/api/nutstore/restore", { path: empty });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("不是有效备份");
  });

  it("后悔药写不进去时中止，并说清是哪个目录、为什么", async () => {
    const { app, backupDir } = await setup();
    // 备份目录留成云端默认值（本用例没配账号密码）→ 后悔药写不进去，必须明确中止而不是裸覆盖。
    const res = await post(app, "/api/nutstore/restore", { path: backupDir });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("为安全起见已中止");
    expect(body.error).toContain("/我的坚果云/ScribeFlow/backups");
  });
});
