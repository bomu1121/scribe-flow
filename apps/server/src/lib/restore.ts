import { copyFile, rm } from "node:fs/promises";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureSchema, recoverInterruptedRuns, type AppDatabase } from "../db/client";
import * as schema from "../db/schema";

/** 取主连接底层的 better-sqlite3 实例（与现有备份逻辑同一通道）。 */
export function liveSqlite(db: AppDatabase): Database.Database {
  return (db as unknown as { $client: Database.Database }).$client;
}

/** 本应用的业务表：排除 sqlite_* 内部表。 */
export function userTableNames(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * 把从云端下载的备份文件准备成可恢复的临时库：
 * 1. 完整性校验（integrity_check）；
 * 2. 幂等迁移：旧版本备份自动补齐当前代码的表/列（复用 ensureSchema）；
 * 3. 把备份里残留的 running 运行标记为 cancelled（复用 recoverInterruptedRuns）。
 * 返回迁移完成、已关闭、可被主连接 ATTACH 的文件路径；调用方负责清理临时目录。
 */
export async function prepareRestoreDatabase(sourcePath: string, targetPath: string): Promise<string> {
  await copyFile(sourcePath, targetPath);
  const sqlite = new Database(targetPath);
  try {
    const integrity = sqlite.pragma("integrity_check") as unknown;
    const lines = Array.isArray(integrity)
      ? (integrity as Array<{ integrity_check: string }>)
      : [{ integrity_check: String(integrity) }];
    if (lines.length === 0 || lines.some((row) => row.integrity_check !== "ok")) {
      throw new Error("备份文件不是有效的 SQLite 数据库（完整性校验未通过）");
    }
    ensureSchema(sqlite);
    recoverInterruptedRuns(drizzle(sqlite, { schema }));
  } catch (err) {
    try {
      sqlite.close();
    } catch {
      // 连接可能未成功建立，忽略。
    }
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw err instanceof Error ? err : new Error("备份文件校验或迁移失败");
  }
  sqlite.close();
  return targetPath;
}

/**
 * 主连接内整库热替换：ATTACH 迁移后的备份 → 单事务内逐表清空并拷入 → COMMIT。
 * - 不替换磁盘文件、不更换连接、不重启进程；事务同步执行，不会与其它请求交错；
 * - 失败自动回滚，主库保持恢复前状态；
 * - 返回被替换的业务表列表。
 */
export function swapDatabaseLive(sqlite: Database.Database, migratedBackupPath: string): string[] {
  sqlite.prepare("ATTACH DATABASE ? AS restore_src").run(migratedBackupPath);
  try {
    const tables = userTableNames(sqlite);
    const swap = sqlite.transaction(() => {
      // 事务内延迟外键检查：先清空后拷入，最终提交时外键一致即可。
      sqlite.pragma("defer_foreign_keys = ON");
      for (const table of tables) {
        const mainCols = sqlite.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
        const srcCols = sqlite.prepare(`PRAGMA restore_src.table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
        const srcNames = new Set(srcCols.map((col) => col.name));
        const cols = mainCols.map((col) => col.name).filter((name) => srcNames.has(name));
        sqlite.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
        if (cols.length === 0) continue;
        const colList = cols.map(quoteIdent).join(", ");
        sqlite
          .prepare(`INSERT INTO ${quoteIdent(table)} (${colList}) SELECT ${colList} FROM restore_src.${quoteIdent(table)}`)
          .run();
      }
    });
    swap();
    return tables;
  } finally {
    try {
      sqlite.exec("DETACH DATABASE restore_src");
    } catch {
      // 事务失败回滚后 DETACH 仍应成功；极端失败也继续向上抛原始错误。
    }
  }
}
