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
export function ensureSchema(sqlite: Database.Database) {
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
      attempts INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS run_node_inputs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT,
      result_text TEXT,
      path TEXT,
      size INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 幂等迁移：旧库 runs 表没有 graph_json 时补列。
  const runColumns = sqlite.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  if (!runColumns.some((col) => col.name === "graph_json")) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN graph_json TEXT");
  }
  if (!runColumns.some((col) => col.name === "node_id")) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN node_id TEXT");
  }

  // 幂等迁移：M7 工程文件夹 —— projects 增加 folder_id，并建索引。
  const projectColumns = sqlite.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!projectColumns.some((col) => col.name === "folder_id")) {
    sqlite.exec("ALTER TABLE projects ADD COLUMN folder_id TEXT");
  }
  if (!projectColumns.some((col) => col.name === "position")) {
    sqlite.exec("ALTER TABLE projects ADD COLUMN position INTEGER");
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_projects_folder ON projects(folder_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)");

  // 幂等迁移：工程文件夹手动排序字段。
  const folderColumns = sqlite.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
  if (!folderColumns.some((col) => col.name === "position")) {
    sqlite.exec("ALTER TABLE folders ADD COLUMN position INTEGER");
  }

  // 旧数据 position 全为 0/NULL 时，按当前名称顺序初始化一次，让“手动排序”立即可用。
  const initPositions = (table: "projects" | "folders", parentCol: string) => {
    const nonZero = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE position IS NOT NULL AND position != 0`)
      .get() as { c: number };
    if (nonZero.c > 0) return;
    const parents = sqlite.prepare(`SELECT DISTINCT ${parentCol} AS pid FROM ${table}`).all() as Array<{ pid: string | null }>;
    const update = sqlite.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
    for (const parent of parents) {
      const pid = parent.pid;
      const rows = (pid == null
        ? sqlite.prepare(`SELECT id FROM ${table} WHERE ${parentCol} IS NULL ORDER BY name COLLATE NOCASE ASC, created_at ASC`).all()
        : sqlite.prepare(`SELECT id FROM ${table} WHERE ${parentCol} = ? ORDER BY name COLLATE NOCASE ASC, created_at ASC`).all(pid)) as Array<{ id: string }>;
      rows.forEach((row, index) => update.run(index + 1, row.id));
    }
  };
  initPositions("projects", "folder_id");
  initPositions("folders", "parent_id");

  // M8：运行库 —— runs 增加 folder_id（分类文件夹），旧 projects.folder_id 不再使用。
  const runColumnsM8 = sqlite.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  if (!runColumnsM8.some((col) => col.name === "folder_id")) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN folder_id TEXT");
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_runs_folder ON runs(folder_id)");

  // 幂等迁移：旧库 run_node_inputs 表没有 result_text 时补列。
  const inputColumns = sqlite.prepare("PRAGMA table_info(run_node_inputs)").all() as Array<{ name: string }>;
  if (!inputColumns.some((col) => col.name === "result_text")) {
    sqlite.exec("ALTER TABLE run_node_inputs ADD COLUMN result_text TEXT");
  }

  // M6：run_node_results 增加 attempts 列（失败重试次数记录）。
  const resultColumns = sqlite.prepare("PRAGMA table_info(run_node_results)").all() as Array<{ name: string }>;
  if (!resultColumns.some((col) => col.name === "attempts")) {
    sqlite.exec("ALTER TABLE run_node_results ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1");
  }
}
