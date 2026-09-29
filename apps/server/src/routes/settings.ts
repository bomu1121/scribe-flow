import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { GENERAL_LIMITS, NODE_TYPE_ORDER, PRUNE_TARGETS } from "@scribe-flow/shared";
import type { NodeType } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { chatCompletion, listAiModels, transcribeAudio } from "../lib/ai";
import { getAiConfig, getAsrConfig, getNutstoreConfig, getSearchConfig, getSettings, updateSettings, withResolvedPaths } from "../lib/settings";
import { badRequest } from "../lib/bad-request";
import { runFfmpeg } from "../lib/media";
import { listRemoteDirectories } from "../lib/nutstore";
import { buildDataOverview, fileManagerCommand, isInsideDataDir, pruneStorage, resolveOutputRoot, type StorageDeps } from "../lib/storage";
import { collectSources } from "../lib/traceExternal";
import type { RunEngine } from "../lib/engine";

const updateSchema = z.object({
  ai: z
    .object({
      provider: z.enum(["deepseek", "openai", "custom"]).optional(),
      baseUrl: z.string().trim().max(500).optional(),
      model: z.string().trim().max(200).optional(),
      apiKey: z.string().max(500).optional(),
    })
    .optional(),
  asr: z
    .object({
      engine: z.enum(["mimo", "openai-compatible"]).optional(),
      baseUrl: z.string().trim().max(500).optional(),
      model: z.string().trim().max(200).optional(),
      apiKey: z.string().max(500).optional(),
    })
    .optional(),
  search: z
    .object({
      provider: z.enum(["zhipu", "tavily"]).optional(),
      apiKey: z.string().max(500).optional(),
      maxResults: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
  general: z
    .object({
      concurrency: z.number().int().min(GENERAL_LIMITS.concurrency.min).max(GENERAL_LIMITS.concurrency.max).optional(),
      outputDir: z.string().trim().max(500).optional(),
      fileNameTemplate: z.string().trim().max(200).optional(),
      maxRetries: z.number().int().min(GENERAL_LIMITS.maxRetries.min).max(GENERAL_LIMITS.maxRetries.max).optional(),
      retryBackoffSec: z.number().int().min(GENERAL_LIMITS.retryBackoffSec.min).max(GENERAL_LIMITS.retryBackoffSec.max).optional(),
      runEndNotify: z.boolean().optional(),
      runEndSound: z.boolean().optional(),
    })
    .optional(),
  visibility: z
    .object({
      // 只认得出 NodeType 里的值：其余一律 400，别把拼错的类型悄悄写进库。
      hiddenNodes: z.array(z.enum(NODE_TYPE_ORDER as [NodeType, ...NodeType[]])).max(64).optional(),
    })
    .optional(),
  obsidian: z
    .object({
      vaultPath: z.string().trim().max(500).optional(),
      folder: z.string().trim().max(200).optional(),
      tagTaxonomy: z.record(z.string(), z.array(z.string())).optional(),
      autoTagEnabled: z.boolean().optional(),
      tagMinCount: z.number().int().min(1).max(20).optional(),
      tagMaxCount: z.number().int().min(1).max(30).optional(),
      autoLinkEnabled: z.boolean().optional(),
      autoLinkMax: z.number().int().min(0).max(20).optional(),
      autoLinkBidirectional: z.boolean().optional(),
    })
    .optional(),
  nutstore: z
    .object({
      serverUrl: z.string().trim().max(500).optional(),
      account: z.string().trim().max(300).optional(),
      password: z.string().max(500).optional(),
      remoteRoot: z.string().trim().max(500).optional(),
      obsidianRemotePath: z.string().trim().max(500).optional(),
      obsidianMode: z.boolean().optional(),
    })
    .optional(),
});

const aiTestSchema = z.object({
  provider: z.enum(["deepseek", "openai", "custom"]).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().max(500).optional(),
});

const asrTestSchema = z.object({
  engine: z.enum(["mimo", "openai-compatible"]).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().max(500).optional(),
});

const searchTestSchema = z.object({
  provider: z.enum(["zhipu", "tavily"]).optional(),
  apiKey: z.string().max(500).optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});

const pruneSchema = z.object({
  targets: z.array(z.enum(PRUNE_TARGETS)).min(1),
});

function resolveAiTestConfig(db: AppDatabase, body: z.infer<typeof aiTestSchema>) {
  const saved = getAiConfig(db);
  return {
    provider: body.provider ?? saved.provider,
    baseUrl: (body.baseUrl ?? "").trim().replace(/\/+$/, "") || saved.baseUrl,
    model: (body.model ?? "").trim() || saved.model,
    apiKey: (body.apiKey ?? "").trim() || saved.apiKey,
  };
}

function resolveAsrTestConfig(db: AppDatabase, body: z.infer<typeof asrTestSchema>) {
  const saved = getAsrConfig(db);
  return {
    engine: body.engine ?? saved.engine,
    baseUrl: (body.baseUrl ?? "").trim().replace(/\/+$/, "") || saved.baseUrl,
    model: (body.model ?? "").trim() || saved.model,
    apiKey: (body.apiKey ?? "").trim() || saved.apiKey,
  };
}

function resolveSearchTestConfig(db: AppDatabase, body: z.infer<typeof searchTestSchema>) {
  const saved = getSearchConfig(db);
  return {
    provider: body.provider ?? saved.provider,
    apiKey: (body.apiKey ?? "").trim() || saved.apiKey,
    maxResults: body.maxResults ?? saved.maxResults,
  };
}

export function settingsApi(db: AppDatabase, engine: RunEngine, dataDir: string) {
  const api = new Hono();

  api.get("/", (c) => c.json(withResolvedPaths(getSettings(db), dataDir)));

  api.put("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const nextOutputDir = parsed.data.general?.outputDir?.trim();
    if (nextOutputDir && !isAbsolute(nextOutputDir) && !isInsideDataDir(dataDir, resolve(dataDir, nextOutputDir))) {
      // 相对路径用 .. 爬到数据目录之外会让清理作用域失控；想写到别处请直接填绝对路径。
      return c.json({ error: "输出目录填相对路径时不能爬到数据目录之外；想写到别的地方请直接填绝对路径（如 D:\\笔记）。" }, 400);
    }
    updateSettings(db, parsed.data);
    return c.json(withResolvedPaths(getSettings(db), dataDir));
  });

  api.post("/test/ai", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = aiTestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const config = resolveAiTestConfig(db, parsed.data ?? {});
    if (!config.apiKey) return c.json({ error: "请先填写 AI 模型密钥" }, 400);
    try {
      const content = await chatCompletion(config, "你是连接测试助手，只回复“连接正常”。", "测试连接");
      let models: string[] = [];
      let modelsError: string | undefined;
      try {
        models = await listAiModels(config);
      } catch (err) {
        modelsError = err instanceof Error ? err.message : "获取模型列表失败";
      }
      return c.json({ ok: true, content, models, modelsError });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "AI 连接失败" }, 400);
    }
  });

  api.post("/ai/models", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = aiTestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const config = resolveAiTestConfig(db, parsed.data ?? {});
    if (!config.apiKey) return c.json({ error: "请先填写 AI 模型密钥" }, 400);
    try {
      const models = await listAiModels(config);
      return c.json({ ok: true, models });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "获取模型列表失败" }, 400);
    }
  });

  api.post("/test/asr", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = asrTestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const config = resolveAsrTestConfig(db, parsed.data ?? {});
    if (!config.apiKey) return c.json({ error: "请先填写语音识别密钥" }, 400);
    const dir = await mkdtemp(join(tmpdir(), "scribe-asr-test-"));
    const wav = join(dir, "test.wav");
    try {
      await runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", "-c:a", "pcm_s16le", wav, "-y"]);
      const text = await transcribeAudio(config, wav);
      return c.json({ ok: true, content: text });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "ASR 连接失败" }, 400);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  api.post("/test/search", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = searchTestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const config = resolveSearchTestConfig(db, parsed.data ?? {});
    if (!config.apiKey) return c.json({ error: "请先填写检索密钥" }, 400);
    try {
      const collected = await collectSources(config, ["人工智能"]);
      if (collected.sources.length === 0) {
        return c.json({ error: "检索已连通，但没有返回可引用的结果（链接为空），请检查余额或用量配额" }, 400);
      }
      return c.json({
        ok: true,
        count: collected.sources.length,
        sample: collected.sources[0]?.title,
        sampleUrl: collected.sources[0]?.url,
        authorityCounts: collected.authorityCounts,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "检索失败" }, 400);
    }
  });

  api.get("/obsidian/folders", async (c) => {
    const settings = getSettings(db);
    // 云端模式：读取坚果云远程目录树；否则读取本地 Obsidian 库目录树。
    if (settings.nutstore.obsidianMode && settings.nutstore.hasPassword) {
      try {
        const config = getNutstoreConfig(db);
        const remotePath = settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian";
        const remoteDirs = await listRemoteDirectories(config, remotePath, 3);
        const rootRel = remotePath.replace(/^\/+|\/+$/g, "");
        const items = remoteDirs.map((dir) => {
          const rel = dir.replace(/^\/+/, "").replace(new RegExp(`^${rootRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`), "");
          return rel || "";
        }).filter(Boolean);
        return c.json({ items });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "读取坚果云目录失败" }, 400);
      }
    }
    const vaultPath = settings.obsidian.vaultPath.trim();
    if (!vaultPath) return c.json({ items: [] });
    const items: string[] = [];
    const walk = async (dir: string, rel: string, depth: number) => {
      if (depth > 3) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        items.push(childRel);
        await walk(join(dir, entry.name), childRel, depth + 1);
      }
    };
    await walk(vaultPath, "", 0);
    items.sort((a, b) => a.localeCompare(b, "zh-CN"));
    return c.json({ items });
  });

  api.get("/data", async (c) => c.json(await buildDataOverview(storageDeps())));

  /**
   * 统一清理入口：targets 逐项执行，逐项回报「清掉几项、释放多少字节、哪些失败」。
   * 与 GET /data 用的是同一份判定，界面上的数字与实际删掉的东西不会漂移。
   */
  api.post("/prune", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = pruneSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const outcomes = await pruneStorage(storageDeps(), parsed.data.targets);
    return c.json({
      outcomes,
      removed: outcomes.reduce((acc, outcome) => acc + outcome.removed, 0),
      bytes: outcomes.reduce((acc, outcome) => acc + outcome.bytes, 0),
      errors: outcomes.flatMap((outcome) => outcome.errors),
    });
  });

  api.post("/reveal-data-dir", async (c) => {
    return reveal(c, dataDir);
  });

  /**
   * 打开产物目录（不是数据目录）——「常规」里刚配的就是它，配完能立刻看一眼才算闭环。
   * 目录还不存在时先建出来，否则第一次点会因为目录不存在而失败。
   */
  api.post("/reveal-output-dir", async (c) => {
    const root = resolveOutputRoot(dataDir, getSettings(db).general.outputDir);
    await mkdir(root, { recursive: true }).catch(() => undefined);
    return reveal(c, root);
  });

  async function reveal(c: Context, target: string) {
    const [command, args] = fileManagerCommand(process.platform, target);
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: "ignore", detached: true });
        child.once("error", reject);
        // explorer.exe 即使成功也可能返回非 0，因此能 spawn 出来就算成功。
        child.once("spawn", () => {
          child.unref();
          resolvePromise();
        });
      });
    } catch (err) {
      return c.json({ error: `无法打开文件管理器（服务端可能运行在容器里）：${err instanceof Error ? err.message : "未知错误"}` }, 400);
    }
    return c.json({ ok: true, path: target });
  }

  function storageDeps(): StorageDeps {
    return {
      db,
      dataDir,
      outputRoot: resolveOutputRoot(dataDir, getSettings(db).general.outputDir),
      deleteRun: (runId) => engine.deleteRun(runId),
    };
  }

  return api;
}
