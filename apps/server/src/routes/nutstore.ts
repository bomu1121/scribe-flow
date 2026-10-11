import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { backupLocationOf, joinBackupPath } from "@scribe-flow/shared";
import type { BackupLocation, NutstoreBackupItem, NutstoreSyncDirection, NutstoreSyncResult } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { listRemoteDirectory, listRemoteDirectories, listRemoteMarkdown, normalizeRemotePath, readRemoteBuffer, readRemoteFile, testNutstoreConnection, writeRemoteBuffer, writeRemoteFile } from "../lib/nutstore";
import type { NutstoreConfig } from "../lib/nutstore";
import { liveSqlite, prepareRestoreDatabase, swapDatabaseLive } from "../lib/restore";
import type { RunEngine } from "../lib/engine";
import { badRequest } from "../lib/bad-request";
import { getNutstoreConfig, getSettings } from "../lib/settings";

interface LocalMarkdownFile {
  absPath: string;
  relPath: string;
  name: string;
  size: number;
  mtimeMs: number;
}

interface RemoteMarkdownFileLite {
  path: string;
  relPath: string;
  name: string;
  size?: number;
  etag?: string;
  lastModified?: number;
}

function joinRemote(base: string, rel: string): string {
  const basePath = normalizeRemotePath(base).replace(/\/+$/, "");
  const relPath = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return relPath ? `${basePath}/${relPath}` : basePath || "/";
}

async function listLocalMarkdown(root: string): Promise<LocalMarkdownFile[]> {
  const results: LocalMarkdownFile[] = [];
  const walk = async (dir: string, rel: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const abs = join(dir, entry.name);
        const info = await stat(abs).catch(() => null);
        if (!info) continue;
        results.push({
          absPath: abs,
          relPath: rel ? `${rel}/${entry.name}` : entry.name,
          name: entry.name,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      }
    }
  };
  await walk(root, "");
  results.sort((a, b) => a.relPath.localeCompare(b.relPath, "zh-CN"));
  return results;
}

async function listRemoteMarkdownLite(config: NutstoreConfig, remoteRoot: string): Promise<RemoteMarkdownFileLite[]> {
  const files = await listRemoteMarkdown(config, remoteRoot);
  const root = normalizeRemotePath(remoteRoot).replace(/\/+$/, "");
  const prefix = root === "/" ? "" : `${root}/`;
  return files.map((file) => ({
    path: file.path,
    relPath: file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path.replace(/^\/+/, ""),
    name: file.name,
    size: file.size,
    etag: file.etag,
    lastModified: file.lastModified,
  }));
}

const testSchema = z.object({
  serverUrl: z.string().trim().max(500).optional(),
  account: z.string().trim().max(300).optional(),
  password: z.string().max(500).optional(),
  remotePath: z.string().trim().max(500).optional(),
});

const syncSchema = z.object({
  localPath: z.string().trim().max(1000).optional(),
  remotePath: z.string().trim().max(500).optional(),
});

const readQuery = z.object({
  path: z.string().trim().max(1000).optional(),
  maxDepth: z.coerce.number().int().min(1).max(6).optional(),
});

function resolveTestConfig(db: AppDatabase, body: z.infer<typeof testSchema>): NutstoreConfig & { remotePath: string } {
  const saved = getNutstoreConfig(db);
  const settings = getSettings(db);
  return {
    serverUrl: (body.serverUrl ?? "").trim().replace(/\/+$/, "") ? `${(body.serverUrl ?? "").trim().replace(/\/+$/, "")}/` : saved.serverUrl,
    account: (body.account ?? "").trim() || saved.account,
    password: (body.password ?? "").trim() || saved.password,
    // 连接测试的默认落点用「笔记云端目录」：备份目录现在可能是本地文件夹，拿它当 WebDAV 测试路径没意义。
    remotePath: normalizeRemotePath((body.remotePath ?? "").trim() || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian"),
  };
}

async function runSync(db: AppDatabase, direction: NutstoreSyncDirection, localPath: string, remotePath: string): Promise<NutstoreSyncResult> {
  const config = getNutstoreConfig(db);
  const result: NutstoreSyncResult = {
    direction,
    localRoot: localPath,
    remotePath: normalizeRemotePath(remotePath),
    transferred: 0,
    skipped: 0,
    skippedItems: [],
    errors: [],
  };
  if (!config.account || !config.password) throw new Error("未配置坚果云账号或应用密码，请到设置页填写");
  if (!localPath.trim()) throw new Error("未配置本地 Obsidian 库路径，请先到 Obsidian 设置页填写");

  if (direction === "push") {
    const localFiles = await listLocalMarkdown(localPath);
    const remoteFiles = new Map<string, RemoteMarkdownFileLite>((await listRemoteMarkdownLite(config, remotePath)).map((file) => [file.relPath, file]));
    for (const local of localFiles) {
      const remote = remoteFiles.get(local.relPath);
      if (remote && remote.lastModified != null && remote.lastModified > local.mtimeMs + 2000) {
        result.skipped += 1;
        result.skippedItems?.push({ path: local.relPath, reason: "云端文件较新，跳过推送以免覆盖" });
        continue;
      }
      try {
        const content = await readFile(local.absPath, "utf8");
        await writeRemoteFile(config, joinRemote(remotePath, local.relPath), content);
        result.transferred += 1;
      } catch (err) {
        result.errors.push({ path: local.relPath, message: err instanceof Error ? err.message : "推送失败" });
      }
    }
  } else {
    const remoteFiles = await listRemoteMarkdownLite(config, remotePath);
    const localFiles = new Map<string, LocalMarkdownFile>((await listLocalMarkdown(localPath)).map((file) => [file.relPath, file]));
    for (const remote of remoteFiles) {
      if (remote.relPath.split("/").includes("..")) {
        result.errors.push({ path: remote.relPath, message: "非法路径（包含 ..），已跳过" });
        continue;
      }
      const local = localFiles.get(remote.relPath);
      if (local && local.mtimeMs > (remote.lastModified ?? 0) + 2000) {
        result.skipped += 1;
        result.skippedItems?.push({ path: remote.relPath, reason: "本地文件较新，跳过拉取以免覆盖" });
        continue;
      }
      try {
        const read = await readRemoteFile(config, remote.path);
        const target = join(localPath, ...remote.relPath.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, read.content, "utf8");
        result.transferred += 1;
      } catch (err) {
        result.errors.push({ path: remote.relPath, message: err instanceof Error ? err.message : "拉取失败" });
      }
    }
  }
  return result;
}

async function backupSqlite(db: AppDatabase, dest: string): Promise<void> {
  const sqlite = (db as unknown as { $client: { backup(destination: string): Promise<unknown> } }).$client;
  await sqlite.backup(dest);
}

/**
 * 把当前 SQLite 库在线备份到「备份目录」（本地文件夹 或 云端）。
 * POST /backup 与恢复前的自动备份共用这一份。
 */
async function uploadCurrentBackup(
  db: AppDatabase,
  config: NutstoreConfig,
  dataDir: string,
  backupDir: string,
): Promise<{ dir: string; location: BackupLocation; files: string[] }> {
  const location = backupLocationOf(backupDir);
  const stamp = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const dirName = `scribe-flow-${stamp}`;
  const tmp = await mkdtemp(join(tmpdir(), "scribe-nutstore-backup-"));
  try {
    const dbFile = join(tmp, "scribe-flow.sqlite");
    await backupSqlite(db, dbFile);
    const files = ["scribe-flow.sqlite"];
    const meta = JSON.stringify({ app: "scribe-flow", createdAt: new Date().toISOString(), dataDir, location, files }, null, 2);

    if (location === "local") {
      const dest = join(backupDir.trim(), dirName);
      await mkdir(dest, { recursive: true });
      await copyFile(dbFile, join(dest, "scribe-flow.sqlite"));
      await writeFile(join(dest, "backup.json"), meta, "utf8");
      files.push("backup.json");
      return { dir: dest, location, files };
    }

    const remoteDir = normalizeRemotePath(joinBackupPath(backupDir, dirName));
    await writeRemoteBuffer(config, joinRemote(remoteDir, "scribe-flow.sqlite"), await readFile(dbFile));
    await writeRemoteFile(config, joinRemote(remoteDir, "backup.json"), meta);
    files.push("backup.json");
    return { dir: remoteDir, location, files };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 列「备份目录」里的备份：本地读磁盘，云端走 WebDAV。 */
async function listBackups(config: NutstoreConfig, backupDir: string): Promise<{ path: string; items: NutstoreBackupItem[] }> {
  if (backupLocationOf(backupDir) === "local") {
    const dir = backupDir.trim();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const items: NutstoreBackupItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const info = await stat(join(dir, entry.name)).catch(() => null);
      items.push({ path: join(dir, entry.name), name: entry.name, lastModified: info?.mtimeMs });
    }
    return { path: dir, items };
  }
  const path = normalizeRemotePath(backupDir.trim());
  const listing = await listRemoteDirectory(config, path);
  return {
    path,
    items: listing.items
      .filter((item) => item.type === "folder")
      .map((item) => ({ path: item.path, name: item.name, size: item.size, lastModified: item.lastModified })),
  };
}

/** 取备份目录里的 SQLite 字节，并确认它确实是一份备份（缺 sqlite 就报错，不裸覆盖）。 */
async function readBackupDb(config: NutstoreConfig, backupPath: string): Promise<{ bytes: Buffer; location: BackupLocation }> {
  if (backupLocationOf(backupPath) === "local") {
    const dir = backupPath.trim();
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`备份目录不存在：${dir}`);
    const dbPath = join(dir, "scribe-flow.sqlite");
    const dbInfo = await stat(dbPath).catch(() => null);
    if (!dbInfo?.isFile()) throw new Error(`该目录不是有效备份（缺少 scribe-flow.sqlite）：${dir}`);
    return { bytes: await readFile(dbPath), location: "local" };
  }
  const remoteDir = normalizeRemotePath(backupPath);
  const listing = await listRemoteDirectory(config, remoteDir);
  if (!listing.items.some((item) => item.type === "file" && item.name === "scribe-flow.sqlite")) {
    throw new Error(`该目录不是有效备份（缺少 scribe-flow.sqlite）：${remoteDir}`);
  }
  const download = await readRemoteBuffer(config, joinRemote(remoteDir, "scribe-flow.sqlite"));
  return { bytes: download.data, location: "remote" };
}

const restoreSchema = z.object({
  path: z.string().trim().min(1).max(1000),
});

export function nutstoreApi(db: AppDatabase, engine: RunEngine, dataDir: string) {
  const api = new Hono();

  api.get("/status", (c) => {
    const settings = getSettings(db);
    return c.json({
      configured: Boolean(settings.nutstore.account && settings.nutstore.hasPassword),
      serverUrl: settings.nutstore.serverUrl,
      account: settings.nutstore.account,
      backupDir: settings.nutstore.backupDir,
      backupLocation: backupLocationOf(settings.nutstore.backupDir),
      obsidianRemotePath: settings.nutstore.obsidianRemotePath,
      obsidianMode: settings.nutstore.obsidianMode,
    });
  });

  api.post("/test", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = testSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest(c, parsed);
    const config = resolveTestConfig(db, parsed.data ?? {});
    try {
      const result = await testNutstoreConnection(config, config.remotePath);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "坚果云连接失败" }, 400);
    }
  });

  api.get("/list", async (c) => {
    const query = readQuery.safeParse(c.req.query());
    if (!query.success) return badRequest(c, query, "参数不正确");
    const settings = getSettings(db);
    const config = getNutstoreConfig(db);
    const path = normalizeRemotePath(query.data.path || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian");
    try {
      const result = await listRemoteDirectory(config, path);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取坚果云目录失败" }, 400);
    }
  });

  api.get("/folders", async (c) => {
    const query = readQuery.safeParse(c.req.query());
    if (!query.success) return badRequest(c, query, "参数不正确");
    const settings = getSettings(db);
    const config = getNutstoreConfig(db);
    const path = normalizeRemotePath(query.data.path || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian");
    const maxDepth = query.data.maxDepth ?? 3;
    try {
      const dirs = await listRemoteDirectories(config, path, maxDepth);
      const root = normalizeRemotePath(path).replace(/\/+$/, "");
      const prefix = root === "/" ? "" : `${root}/`;
      return c.json({ path, items: dirs.map((dir) => dir.startsWith(prefix) ? dir.slice(prefix.length) : dir.replace(/^\/+/, "")).filter(Boolean) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取坚果云目录失败" }, 400);
    }
  });

  api.get("/read", async (c) => {
    const query = readQuery.safeParse(c.req.query());
    if (!query.success) return badRequest(c, query, "参数不正确");
    const path = normalizeRemotePath(query.data.path || "");
    if (!path || path === "/") return c.json({ error: "请指定要读取的远程文件路径" }, 400);
    try {
      const result = await readRemoteFile(getNutstoreConfig(db), path);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取坚果云文件失败" }, 400);
    }
  });

  api.post("/sync/push", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = syncSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest(c, parsed);
    const settings = getSettings(db);
    const localPath = (parsed.data.localPath ?? "").trim() || settings.obsidian.vaultPath.trim();
    const remotePath = (parsed.data.remotePath ?? "").trim() || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian";
    try {
      const result = await runSync(db, "push", localPath, remotePath);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "推送失败" }, 400);
    }
  });

  api.post("/sync/pull", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = syncSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest(c, parsed);
    const settings = getSettings(db);
    const localPath = (parsed.data.localPath ?? "").trim() || settings.obsidian.vaultPath.trim();
    const remotePath = (parsed.data.remotePath ?? "").trim() || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian";
    try {
      const result = await runSync(db, "pull", localPath, remotePath);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "拉取失败" }, 400);
    }
  });

  api.get("/backups", async (c) => {
    const settings = getSettings(db);
    try {
      const result = await listBackups(getNutstoreConfig(db), settings.nutstore.backupDir);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取备份列表失败" }, 400);
    }
  });

  api.post("/backup", async (c) => {
    const settings = getSettings(db);
    try {
      const result = await uploadCurrentBackup(db, getNutstoreConfig(db), dataDir, settings.nutstore.backupDir);
      return c.json({ ...result, uploadedAt: Date.now() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "备份失败" }, 400);
    }
  });

  api.post("/restore", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = restoreSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest(c, parsed);
    const settings = getSettings(db);
    const config = getNutstoreConfig(db);
    const sourcePath = parsed.data.path.trim();
    // 只有云端备份需要账号密码；本地文件夹（客户端同步）不需要。
    if (backupLocationOf(sourcePath) === "remote" && (!config.account || !config.password)) {
      return c.json({ error: "未配置坚果云账号或应用密码，请到设置页填写" }, 400);
    }
    const refuse = (runIds: string[]) =>
      c.json({ error: `有 ${runIds.length} 个流程正在运行，请先停止后再恢复`, runIds }, 409);
    const firstActive = engine.activeRunIds;
    if (firstActive.length > 0) return refuse(firstActive);
    const work = await mkdtemp(join(tmpdir(), "scribe-nutstore-restore-"));
    try {
      // 后悔药：恢复前先把当前库自动备份一份；失败即中止，绝不裸覆盖。
      // 它固定落在「备份目录」，所以失败信息必须说清是哪个目录、以及为什么写不进去——
      // 否则用户会看到"未配置账号密码"这种跟本地恢复毫无关系的提示。
      let autoBackup: Awaited<ReturnType<typeof uploadCurrentBackup>>;
      try {
        autoBackup = await uploadCurrentBackup(db, config, dataDir, settings.nutstore.backupDir);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `恢复前无法把当前数据备份到「${settings.nutstore.backupDir}」，为安全起见已中止：${reason}` }, 400);
      }
      const { bytes } = await readBackupDb(config, sourcePath);
      const localSource = join(work, "scribe-flow.sqlite");
      const migratedPath = join(work, "scribe-flow.migrated.sqlite");
      await writeFile(localSource, bytes);
      await prepareRestoreDatabase(localSource, migratedPath);
      // 下载/校验期间可能又有新运行开始：紧贴热替换再做一次原子性复查（检查与替换之间无 await，不可能再插入新运行）。
      const secondActive = engine.activeRunIds;
      if (secondActive.length > 0) return refuse(secondActive);
      const tables = swapDatabaseLive(liveSqlite(db), migratedPath);
      return c.json({ ok: true, restoredPath: sourcePath, autoBackupPath: autoBackup.dir, restoredAt: Date.now(), tables });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "恢复失败" }, 400);
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return api;
}
