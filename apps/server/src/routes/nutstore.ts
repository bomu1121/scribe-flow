import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import type { NutstoreBackupItem, NutstoreSyncDirection, NutstoreSyncResult } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { listRemoteDirectory, listRemoteDirectories, listRemoteMarkdown, readRemoteBuffer, readRemoteFile, testNutstoreConnection, writeRemoteBuffer, writeRemoteFile } from "../lib/nutstore";
import type { NutstoreConfig } from "../lib/nutstore";
import { liveSqlite, prepareRestoreDatabase, swapDatabaseLive } from "../lib/restore";
import type { RunEngine } from "../lib/engine";
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

function normalizeRemote(path: string): string {
  const cleaned = path.replace(/\\/g, "/").trim();
  return cleaned.startsWith("/") ? cleaned.replace(/\/+$/, "") || "/" : `/${cleaned.replace(/\/+$/, "")}`;
}

function joinRemote(base: string, rel: string): string {
  const basePath = normalizeRemote(base).replace(/\/+$/, "");
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
  const root = normalizeRemote(remoteRoot).replace(/\/+$/, "");
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
    remotePath: normalizeRemote((body.remotePath ?? "").trim() || settings.nutstore.remoteRoot || "/我的坚果云/ScribeFlow"),
  };
}

async function runSync(db: AppDatabase, direction: NutstoreSyncDirection, localPath: string, remotePath: string): Promise<NutstoreSyncResult> {
  const config = getNutstoreConfig(db);
  const result: NutstoreSyncResult = {
    direction,
    localRoot: localPath,
    remotePath: normalizeRemote(remotePath),
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

/** 把当前 SQLite 库在线备份并上传到坚果云 backups/ 下（POST /backup 与恢复前自动备份共用）。 */
async function uploadCurrentBackup(db: AppDatabase, config: NutstoreConfig, dataDir: string, remoteRoot: string): Promise<{ remotePath: string; files: string[] }> {
  const stamp = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const remoteDir = normalizeRemote(`${remoteRoot || "/我的坚果云/ScribeFlow"}/backups/scribe-flow-${stamp}`);
  const tmp = await mkdtemp(join(tmpdir(), "scribe-nutstore-backup-"));
  try {
    const dbFile = join(tmp, "scribe-flow.sqlite");
    await backupSqlite(db, dbFile);
    const files = ["scribe-flow.sqlite"];
    await writeRemoteBuffer(config, joinRemote(remoteDir, "scribe-flow.sqlite"), await readFile(dbFile));
    const meta = JSON.stringify({ app: "scribe-flow", createdAt: new Date().toISOString(), dataDir, files }, null, 2);
    await writeRemoteFile(config, joinRemote(remoteDir, "backup.json"), meta);
    files.push("backup.json");
    return { remotePath: remoteDir, files };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
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
      remoteRoot: settings.nutstore.remoteRoot,
      obsidianRemotePath: settings.nutstore.obsidianRemotePath,
      obsidianMode: settings.nutstore.obsidianMode,
    });
  });

  api.post("/test", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = testSchema.safeParse(raw ?? {});
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
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
    if (!query.success) return c.json({ error: query.error.issues[0]?.message ?? "参数不正确" }, 400);
    const settings = getSettings(db);
    const config = getNutstoreConfig(db);
    const path = normalizeRemote(query.data.path || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian");
    try {
      const result = await listRemoteDirectory(config, path);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取坚果云目录失败" }, 400);
    }
  });

  api.get("/folders", async (c) => {
    const query = readQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: query.error.issues[0]?.message ?? "参数不正确" }, 400);
    const settings = getSettings(db);
    const config = getNutstoreConfig(db);
    const path = normalizeRemote(query.data.path || settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian");
    const maxDepth = query.data.maxDepth ?? 3;
    try {
      const dirs = await listRemoteDirectories(config, path, maxDepth);
      const root = normalizeRemote(path).replace(/\/+$/, "");
      const prefix = root === "/" ? "" : `${root}/`;
      return c.json({ path, items: dirs.map((dir) => dir.startsWith(prefix) ? dir.slice(prefix.length) : dir.replace(/^\/+/, "")).filter(Boolean) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取坚果云目录失败" }, 400);
    }
  });

  api.get("/read", async (c) => {
    const query = readQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: query.error.issues[0]?.message ?? "参数不正确" }, 400);
    const path = normalizeRemote(query.data.path || "");
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
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
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
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
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
    const config = getNutstoreConfig(db);
    const backupsPath = normalizeRemote(`${settings.nutstore.remoteRoot || "/我的坚果云/ScribeFlow"}/backups`);
    try {
      const listing = await listRemoteDirectory(config, backupsPath);
      const items: NutstoreBackupItem[] = listing.items
        .filter((item) => item.type === "folder")
        .map((item) => ({ path: item.path, name: item.name, size: item.size, lastModified: item.lastModified }));
      return c.json({ path: backupsPath, items });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "读取备份列表失败" }, 400);
    }
  });

  api.post("/backup", async (c) => {
    const settings = getSettings(db);
    try {
      const result = await uploadCurrentBackup(db, getNutstoreConfig(db), dataDir, settings.nutstore.remoteRoot || "/我的坚果云/ScribeFlow");
      return c.json({ ...result, uploadedAt: Date.now() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "备份到坚果云失败" }, 400);
    }
  });

  api.post("/restore", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = restoreSchema.safeParse(raw ?? {});
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    const settings = getSettings(db);
    const config = getNutstoreConfig(db);
    if (!config.account || !config.password) return c.json({ error: "未配置坚果云账号或应用密码，请到设置页填写" }, 400);
    const refuse = (runIds: string[]) =>
      c.json({ error: `有 ${runIds.length} 个流程正在运行，请先停止后再恢复`, runIds }, 409);
    const firstActive = engine.activeRunIds;
    if (firstActive.length > 0) return refuse(firstActive);
    const remoteDir = normalizeRemote(parsed.data.path);
    const work = await mkdtemp(join(tmpdir(), "scribe-nutstore-restore-"));
    try {
      const listing = await listRemoteDirectory(config, remoteDir);
      const hasDb = listing.items.some((item) => item.type === "file" && item.name === "scribe-flow.sqlite");
      if (!hasDb) return c.json({ error: `该目录不是有效备份（缺少 scribe-flow.sqlite）：${remoteDir}` }, 400);
      // 后悔药：恢复前先把当前库自动备份到坚果云；失败即中止，绝不裸覆盖。
      const autoBackup = await uploadCurrentBackup(db, config, dataDir, settings.nutstore.remoteRoot || "/我的坚果云/ScribeFlow");
      const download = await readRemoteBuffer(config, joinRemote(remoteDir, "scribe-flow.sqlite"));
      const sourcePath = join(work, "scribe-flow.sqlite");
      const migratedPath = join(work, "scribe-flow.migrated.sqlite");
      await writeFile(sourcePath, download.data);
      await prepareRestoreDatabase(sourcePath, migratedPath);
      // 下载/校验期间可能又有新运行开始：紧贴热替换再做一次原子性复查（检查与替换之间无 await，不可能再插入新运行）。
      const secondActive = engine.activeRunIds;
      if (secondActive.length > 0) return refuse(secondActive);
      const tables = swapDatabaseLive(liveSqlite(db), migratedPath);
      return c.json({ ok: true, remotePath: remoteDir, autoBackupPath: autoBackup.remotePath, restoredAt: Date.now(), tables });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "从坚果云恢复失败" }, 400);
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return api;
}
