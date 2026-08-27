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
  return drizzle(sqlite, { schema });
}
