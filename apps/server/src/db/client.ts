import { join } from "node:path";
import Database from "better-sqlite3";
import { and, eq, notInArray } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** 创建数据库连接；数据目录由 env.loadEnv 保证存在。 */
export function createDatabase(dataDir: string): AppDatabase {
  const sqlite = new Database(join(dataDir, "scribe-flow.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  ensureSchema(sqlite);
  return drizzle(sqlite, { schema });
}

/** 服务启动时恢复上次异常中断的运行：把残留 running 状态标记为 cancelled。 */
export function recoverInterruptedRuns(db: AppDatabase) {
  const now = Date.now();
  const running = db.select().from(schema.runs).where(eq(schema.runs.status, "running")).all();
  for (const row of running) {
    db.update(schema.runs)
      .set({ status: "cancelled", finishedAt: now, elapsedMs: now - row.createdAt, error: "服务重启，运行已中断" })
      .where(eq(schema.runs.id, row.id))
      .run();
    db.update(schema.runNodeResults)
      .set({ status: "cancelled", error: "服务重启，运行已中断", updatedAt: now })
      .where(and(eq(schema.runNodeResults.runId, row.id), notInArray(schema.runNodeResults.status, ["done", "error", "cancelled", "skipped"])))
      .run();
  }
}

/**
 * M0/M1 无迁移工具，先以幂等 SQL 建表。
 * M5 前换成 drizzle-kit 迁移并保留本函数兼容。
 */
function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      graph_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bili_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bili_cookies (
      id INTEGER PRIMARY KEY,
      cookie TEXT NOT NULL,
      mid INTEGER NOT NULL,
      uname TEXT NOT NULL,
      face TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      elapsed_ms INTEGER,
      summary TEXT,
      error TEXT,
      graph_json TEXT
    );

    CREATE TABLE IF NOT EXISTS run_node_results (
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

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_blocks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_node_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // 幂等迁移：旧库 runs 表没有 graph_json 时补列。
  const runColumns = sqlite.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  if (!runColumns.some((col) => col.name === "graph_json")) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN graph_json TEXT");
  }
}
