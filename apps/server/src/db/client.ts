import { join } from "node:path";
import Database from "better-sqlite3";
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
  `);
}
