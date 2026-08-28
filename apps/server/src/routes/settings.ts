import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ne } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/client";
import { runs } from "../db/schema";
import { chatCompletion, transcribeAudio } from "../lib/ai";
import { getAiConfig, getAsrConfig, getSettings, updateSettings } from "../lib/settings";
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
  general: z
    .object({
      concurrency: z.number().int().min(1).max(4).optional(),
      outputDir: z.string().trim().max(200).optional(),
    })
    .optional(),
});

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });
}

export function settingsApi(db: AppDatabase, engine: RunEngine, dataDir: string) {
  const api = new Hono();

  api.get("/", (c) => c.json(getSettings(db)));

  api.put("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    updateSettings(db, parsed.data);
    return c.json(getSettings(db));
  });

  api.post("/test/ai", async (c) => {
    const config = getAiConfig(db);
    if (!config.apiKey) return c.json({ error: "请先填写 AI 模型密钥" }, 400);
    try {
      const content = await chatCompletion(config, "你是连接测试助手，只回复“连接正常”。", "测试连接");
      return c.json({ ok: true, content });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "AI 连接失败" }, 400);
    }
  });

  api.post("/test/asr", async (c) => {
    const config = getAsrConfig(db);
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

  api.get("/data", async (c) => {
    const rows = db.select().from(runs).all();
    const finished = rows.filter((r) => r.status !== "running").length;
    const outputDir = join(dataDir, getSettings(db).general.outputDir || "outputs");
    let outputFiles = 0;
    let outputBytes = 0;
    try {
      const runDirs = (await readdir(outputDir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory());
      for (const dir of runDirs) {
        const files = await readdir(join(outputDir, dir.name)).catch(() => []);
        outputFiles += files.length;
        for (const file of files) {
          outputBytes += (await stat(join(outputDir, dir.name, file)).catch(() => ({ size: 0 }))).size;
        }
      }
    } catch {
      // 输出目录不存在
    }
    return c.json({ dataDir, runCount: rows.length, finishedRunCount: finished, outputFiles, outputBytes });
  });

  api.post("/clear-runs", async (c) => {
    const rows = db.select().from(runs).where(ne(runs.status, "running")).all();
    for (const row of rows) {
      await engine.deleteRun(row.id);
    }
    return c.json({ deleted: rows.length });
  });

  return api;
}
