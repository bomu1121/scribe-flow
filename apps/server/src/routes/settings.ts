import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { GENERAL_LIMITS, MAX_EXTRACT_FIELDS, NODE_TYPE_ORDER, PRUNE_TARGETS } from "@scribe-flow/shared";
import type { NodeType, ObsidianFieldsResult, ObsidianTagUsageResult, ObsidianVaultCheck } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { chatCompletion, listAiModels, transcribeAudio } from "../lib/ai";
import { detectBalanceProvider, fetchBalance } from "../lib/balance";
import { lookupReferencePrice } from "../lib/price-lookup";
import { getAiConfig, getAsrConfig, getNutstoreConfig, getSearchConfig, getSettings, updateSettings, withResolvedPaths } from "../lib/settings";
import { badRequest } from "../lib/bad-request";
import { runFfmpeg } from "../lib/media";
import { collectFrontMatterFieldNames, collectTagUsage, countMarkdownFiles } from "../lib/note-markdown";
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
      // 单价上限给得宽松但有限：挡住手抖多打几个 0 之后折出来的天文数字。
      inputPricePerMillion: z.number().min(0).max(1_000_000).optional(),
      outputPricePerMillion: z.number().min(0).max(1_000_000).optional(),
      cachedInputPricePerMillion: z.number().min(0).max(1_000_000).optional(),
      priceCurrency: z.enum(["CNY", "USD"]).optional(),
    })
    .optional(),
  asr: z
    .object({
      engine: z.enum(["mimo", "openai-compatible"]).optional(),
      baseUrl: z.string().trim().max(500).optional(),
      model: z.string().trim().max(200).optional(),
      apiKey: z.string().max(500).optional(),
      pricePerMinute: z.number().min(0).max(100_000).optional(),
    })
    .optional(),
  search: z
    .object({
      provider: z.enum(["zhipu", "tavily", "deepseek"]).optional(),
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
      traceFolder: z.string().trim().max(200).optional(),
      tagTaxonomy: z.record(z.string(), z.array(z.string())).optional(),
      tagView: z.enum(["color", "plain", "list"]).optional(),
      autoTagEnabled: z.boolean().optional(),
      sourceTagEnabled: z.boolean().optional(),
      upTagEnabled: z.boolean().optional(),
      tagTraceNotes: z.boolean().optional(),
      allowNewTags: z.boolean().optional(),
      extractFields: z.array(z.string()).max(MAX_EXTRACT_FIELDS).optional(),
      tagMinCount: z.number().int().min(1).max(20).optional(),
      tagMaxCount: z.number().int().min(1).max(30).optional(),
      autoLinkEnabled: z.boolean().optional(),
      autoLinkMax: z.number().int().min(0).max(20).optional(),
    })
    .optional(),
  nutstore: z
    .object({
      serverUrl: z.string().trim().max(500).optional(),
      account: z.string().trim().max(300).optional(),
      password: z.string().max(500).optional(),
      backupDir: z.string().trim().max(500).optional(),
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
  provider: z.enum(["zhipu", "tavily", "deepseek"]).optional(),
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
      const result = await chatCompletion(config, "你是连接测试助手，只回复“连接正常”。", "测试连接");
      const content = result.content;
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

  /**
   * 参考价目：按模型名从一份公开价目表里查一条，供设置页「一键填入」输入框。
   *
   * **不写设置、不参与算账**——查到的价只是填进输入框的初始值，仍由用户确认后随表单保存。
   * 为什么不直接拿它算账：聚合表的价不等于用户实际付的价（OpenRouter 是转售价、DeepSeek 分峰谷、
   * 智谱与 Moonshot 分缓存 TTL 档）。理由与逐条对比见 `lib/price-lookup.ts` 顶部。
   */
  api.post("/ai/price-lookup", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = aiTestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const config = resolveAiTestConfig(db, parsed.data ?? {});
    if (!config.model.trim()) return c.json({ error: "先填模型名再查参考价" }, 400);
    try {
      const reference = await lookupReferencePrice(config.model, config.provider);
      if (!reference) {
        // 不编一个默认价——调研的七家成熟项目里没有一家这么做（见研究文档 §4.3）。
        return c.json({ error: `参考价目里没有「${config.model}」这一条，请按账单手填` }, 404);
      }
      return c.json({ ok: true, reference });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "参考价目拉取失败" }, 400);
    }
  });

  /**
   * 余额对账：查一次账户余额，与本地累计估算并排看，回答「我们估的准不准」。
   *
   * 粒度是**账户级**的，不能分摊到某一次运行——界面文案必须写明，否则会被当成"每次运行的账单"。
   * 渠道不支持时返回一段说明而不是通用报错，因为「哪几家有」这件事本身就是有用的信息。
   */
  api.post("/ai/balance", async (c) => {
    const saved = getSettings(db);
    const provider = detectBalanceProvider(saved.ai.baseUrl);
    if (!provider) {
      return c.json(
        {
          error: `暂无「${saved.ai.provider}」的余额接口。有余额查询的是 DeepSeek、Moonshot、OpenRouter 三家；OpenAI / Anthropic 的账单接口要 Admin Key，智谱官方没有接口。`,
        },
        400,
      );
    }
    const config = getAiConfig(db);
    try {
      return c.json({ ok: true, balance: await fetchBalance(provider, config.baseUrl, config.apiKey) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "余额查询失败" }, 400);
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
      return c.json({ ok: true, content: text.text });
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

  /**
   * 词库里每个标签被多少篇笔记用过——设置页那一块「N 篇用过」的来源。
   *
   * 与 `/obsidian/fields` 同一套口径与代价（本地扫、不花钱、到上限说 capped）：
   * 它的用途是**判断该不该删**，所以宁可给"至少 N 篇"也不给一个假装精确的数。
   */
  api.get("/obsidian/tags", async (c) => {
    const settings = getSettings(db);
    if (settings.nutstore.obsidianMode && settings.nutstore.hasPassword) {
      return c.json({ items: [], scanned: 0, capped: false } satisfies ObsidianTagUsageResult);
    }
    const vaultPath = settings.obsidian.vaultPath.trim();
    if (!vaultPath) return c.json({ items: [], scanned: 0, capped: false } satisfies ObsidianTagUsageResult);
    return c.json((await collectTagUsage(vaultPath)) satisfies ObsidianTagUsageResult);
  });

  /**
   * 库里用过的属性名——「抽取哪些属性」下拉的建议来源。
   *
   * 为什么不复用 `/obsidian/folders` 那种"每次现扫"的轻量扫法：这一步要读每篇笔记的正文才能拿到
   * front matter，比只列目录贵，所以带上限（`collectFrontMatterFieldNames` 的 cap）并如实回报 `capped`。
   * 云端（坚果云）模式不做这件事：那要把库拉下来，代价和收益不成比例，返回空列表由界面照常解释。
   */
  api.get("/obsidian/fields", async (c) => {
    const settings = getSettings(db);
    if (settings.nutstore.obsidianMode && settings.nutstore.hasPassword) {
      return c.json({ items: [], scanned: 0, capped: false } satisfies ObsidianFieldsResult);
    }
    const vaultPath = settings.obsidian.vaultPath.trim();
    if (!vaultPath) return c.json({ items: [], scanned: 0, capped: false } satisfies ObsidianFieldsResult);
    const result = await collectFrontMatterFieldNames(vaultPath);
    return c.json(result satisfies ObsidianFieldsResult);
  });

  /**
   * 检查 Obsidian 库：这一页最重要的反馈。
   *
   * 「填了一个路径」和「笔记真能写进去」是两件事，之前只有前者可见——路径写错要等到运行到该节点才失败。
   * 这里纯本地检查（数文件、看权限），不联网不花钱，界面据此给出结论卡而不是让用户自己猜。
   */
  api.get("/obsidian/check", async (c) => {
    const settings = getSettings(db);
    const input = (c.req.query("vaultPath") ?? settings.obsidian.vaultPath).trim();
    const folder = (c.req.query("folder") ?? settings.obsidian.folder).trim();
    const segments = folder.split(/[\\/]+/).filter((segment) => segment && segment !== ".");
    const resolved = input ? resolve(input) : "";
    const targetDir = resolved ? join(resolved, ...segments) : "";

    const base: ObsidianVaultCheck = {
      input,
      resolved,
      exists: false,
      isDirectory: false,
      noteCount: 0,
      noteCountCapped: false,
      targetDir,
      writable: false,
      syncFolder: /nutstore|坚果云/i.test(resolved) ? "nutstore" : "unknown",
      insideDataDir: resolved ? isInsideDataDir(dataDir, resolved) : false,
    };

    if (!input) {
      return c.json({ ...base, problem: "还没填库文件夹。运行到「Obsidian 笔记」节点时会失败——先填这一项。" });
    }
    const info = await stat(resolved).catch(() => null);
    if (!info?.isDirectory()) {
      return c.json({ ...base, problem: `找不到这个文件夹：${resolved}。检查一下路径，或者先在资源管理器里把它建出来。` });
    }
    // 目标文件夹可能还不存在（节点会 mkdir），所以用「最近的存在祖先」判可写。
    let ancestor = targetDir;
    let ancestorInfo = await stat(ancestor).catch(() => null);
    while (!ancestorInfo && ancestor !== dirname(ancestor)) {
      ancestor = dirname(ancestor);
      ancestorInfo = await stat(ancestor).catch(() => null);
    }
    const writable = ancestorInfo ? await access(ancestor, constants.W_OK).then(() => true, () => false) : false;
    const { count, capped } = await countMarkdownFiles(resolved);

    const problem = !writable
      ? `这个文件夹目前不可写（${ancestor}），笔记会写不进去。`
      : base.insideDataDir
        ? "库放在了应用自己的数据目录里。清理数据时容易连带受影响，建议挪到别处。"
        : undefined;
    return c.json({ ...base, exists: true, isDirectory: true, noteCount: count, noteCountCapped: capped, writable, problem } satisfies ObsidianVaultCheck);
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
