import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createDatabase } from "../db/client";
import { liveSqlite, prepareRestoreDatabase, swapDatabaseLive, userTableNames } from "./restore";

const tmpDirs: string[] = [];

async function newDataDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `scribe-restore-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

function closeDb(raw: Database.Database): void {
  try {
    raw.close();
  } catch {
    // Windows 上句柄可能被短暂占用；忽略并交由临时目录清理逻辑兜底。
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

describe("坚果云恢复：数据库整库热替换", () => {
  it("备份 → 篡改主库 → 恢复后数据回到备份状态，且连接仍可用", async () => {
    const dataDir = await newDataDir("swap");
    const db = createDatabase(dataDir);
    const raw = liveSqlite(db);
    const now = Date.now();

    raw
      .prepare(
        "INSERT INTO projects (id, name, description, graph_json, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("p1", "原名", "", "{}", 1, now, now);
    raw
      .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("nutstore.account", "a@b.c", now);
    raw
      .prepare("INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)")
      .run("f1", "原文件夹", now, now);
    raw.prepare("INSERT INTO runs (id, project_id, status, scope, created_at) VALUES (?, ?, ?, ?, ?)").run("r1", "p1", "done", "project", now);

    const backupFile = join(dataDir, "backup.sqlite");
    await raw.backup(backupFile);

    // 篡改主库：改名、删文件夹、改设置、删运行。
    raw.prepare("UPDATE projects SET name = ? WHERE id = ?").run("被篡改", "p1");
    raw.prepare("DELETE FROM folders WHERE id = ?").run("f1");
    raw.prepare("UPDATE app_settings SET value = ? WHERE key = ?").run("x@y.z", "nutstore.account");
    raw.prepare("DELETE FROM runs WHERE id = ?").run("r1");

    const migrated = join(dataDir, "migrated.sqlite");
    await prepareRestoreDatabase(backupFile, migrated);
    const tables = swapDatabaseLive(raw, migrated);

    expect(tables).toEqual(expect.arrayContaining(["projects", "folders", "runs", "app_settings"]));
    expect(tables).not.toContain("restore_src");

    const project = raw.prepare("SELECT name FROM projects WHERE id = ?").get("p1") as { name: string };
    expect(project.name).toBe("原名");
    const folder = raw.prepare("SELECT COUNT(*) AS c FROM folders").get() as { c: number };
    expect(folder.c).toBe(1);
    const setting = raw.prepare("SELECT value FROM app_settings WHERE key = ?").get("nutstore.account") as { value: string };
    expect(setting.value).toBe("a@b.c");
    const run = raw.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number };
    expect(run.c).toBe(1);

    // 热替换后同一连接仍可正常读写（进程未重启的关键验证）。
    raw
      .prepare(
        "INSERT INTO projects (id, name, description, graph_json, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("p2", "恢复后新工程", "", "{}", 1, now, now);
    const afterWrite = raw.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number };
    expect(afterWrite.c).toBe(2);

    closeDb(raw);
  });

  it("旧版本结构的备份可被自动迁移后恢复（补列/补表/收尾残留 running）", async () => {
    const dataDir = await newDataDir("upgrade");
    // 手工构造“旧版本”备份：缺 folder_id/position/attempts/folder_id(runs) 等列与多张表，且残留 running。
    const oldFile = join(dataDir, "old-backup.sqlite");
    const oldRaw = new Database(oldFile);
    oldRaw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        graph_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        elapsed_ms INTEGER,
        summary TEXT,
        error TEXT
      );
      CREATE TABLE run_node_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        node_label TEXT,
        status TEXT NOT NULL,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        error TEXT,
        output_kind TEXT,
        output_text TEXT,
        output_path TEXT,
        output_size INTEGER,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO projects (id, name, description, graph_json, schema_version, created_at, updated_at)
        VALUES ('p_old', '旧版工程', '', '{}', 1, 100, 100);
      INSERT INTO runs (id, project_id, status, scope, created_at)
        VALUES ('r_old', 'p_old', 'running', 'project', 100);
      INSERT INTO run_node_results (id, run_id, node_id, node_type, node_label, status, elapsed_ms, updated_at)
        VALUES ('n_old', 'r_old', 'n1', 'process.output', '旧输出', 'running', 0, 100);
    `);
    oldRaw.close();

    const mainDataDir = await newDataDir("upgrade-main");
    const db = createDatabase(mainDataDir);
    const raw = liveSqlite(db);

    const migrated = join(dataDir, "old-migrated.sqlite");
    await prepareRestoreDatabase(oldFile, migrated);
    const tables = swapDatabaseLive(raw, migrated);

    const projectCols = raw.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    expect(projectCols.map((col) => col.name)).toEqual(expect.arrayContaining(["folder_id", "position"]));
    expect(tables).toEqual(expect.arrayContaining(["prompt_blocks", "run_node_logs", "run_node_inputs"]));

    const project = raw.prepare("SELECT name, folder_id FROM projects WHERE id = ?").get("p_old") as { name: string; folder_id: string | null };
    expect(project.name).toBe("旧版工程");
    expect(project.folder_id).toBeNull();

    // 备份中残留的 running 被收尾为 cancelled，而不是“复活”成永远无法结束的运行。
    const run = raw.prepare("SELECT status, error FROM runs WHERE id = ?").get("r_old") as { status: string; error: string | null };
    expect(run.status).toBe("cancelled");
    expect(run.error).toContain("服务重启");
    const node = raw.prepare("SELECT status, attempts FROM run_node_results WHERE id = ?").get("n_old") as { status: string; attempts: number };
    expect(node.status).toBe("cancelled");
    expect(node.attempts).toBe(1);

    closeDb(raw);
  });

  it("损坏文件被拒绝且主库保持原状（事务不生效）", async () => {
    const dataDir = await newDataDir("corrupt");
    const db = createDatabase(dataDir);
    const raw = liveSqlite(db);
    const now = Date.now();
    raw
      .prepare(
        "INSERT INTO projects (id, name, description, graph_json, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("p_keep", "保留工程", "", "{}", 1, now, now);

    const badFile = join(dataDir, "bad.sqlite");
    await writeFile(badFile, "这不是 SQLite 数据库");

    await expect(prepareRestoreDatabase(badFile, join(dataDir, "bad-migrated.sqlite"))).rejects.toThrow();
    const count = raw.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number };
    expect(count.c).toBe(1);
    const kept = raw.prepare("SELECT name FROM projects WHERE id = ?").get("p_keep") as { name: string };
    expect(kept.name).toBe("保留工程");

    closeDb(raw);
  });

  it("userTableNames 只列业务表，不包含 sqlite 内部表", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE demo (id INTEGER PRIMARY KEY);");
    const tables = userTableNames(sqlite);
    expect(tables).toContain("demo");
    expect(tables.some((name) => name.startsWith("sqlite_"))).toBe(false);
    sqlite.close();
  });
});
