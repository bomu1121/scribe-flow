import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { CompareAnalysis } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { compareReports } from "../db/schema";
import { badRequest } from "../lib/bad-request";
import { getAiConfig } from "../lib/settings";
import { compareCacheKey, runCompareAnalysis, type CompareRunMeta } from "../lib/compareReport";

/**
 * POST /api/compare：对照视图的「AI 差异分析」。
 *
 * 不是流水线的一步：正文由前端提交（它已经在屏上，服务端不必再解析一遍分段），
 * 服务端只做三件事——按内容指纹查缓存、调一次模型、把结论与事实分开返回。
 * 缓存键含模型名：换模型要重新判读，内容没变则直接读缓存。
 */

const compareBodySchema = z.object({
  left: z.object({ label: z.string().min(1).max(200), text: z.string().min(1) }),
  right: z.object({ label: z.string().min(1).max(200), text: z.string().min(1) }),
  /** 忽略缓存重新判读（用户点了「重新分析」）。 */
  refresh: z.boolean().optional(),
});

export function compareApi(db: AppDatabase) {
  const api = new Hono();

  api.post("/", async (c) => {
    const parsed = compareBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const { left, right, refresh } = parsed.data;
    if (left.text === right.text) {
      return c.json({ error: "两侧内容完全相同，没有可分析的差异" }, 400);
    }

    const config = getAiConfig(db);
    if (!config.apiKey) {
      return c.json({ error: "未配置 AI 模型密钥，请到设置页填写" }, 400);
    }

    const hash = createHash("sha256").update(compareCacheKey(config.model, left, right)).digest("hex");
    if (!refresh) {
      const cached = db.select().from(compareReports).where(eq(compareReports.contentHash, hash)).get();
      if (cached) {
        return c.json({
          analysis: JSON.parse(cached.analysisJson) as CompareAnalysis,
          meta: { ...(JSON.parse(cached.metaJson) as CompareRunMeta), model: cached.model, createdAt: cached.createdAt },
          cached: true,
        });
      }
    }

    const startedAt = Date.now();
    try {
      const result = await runCompareAnalysis(config, left, right, c.req.raw.signal);
      const now = Date.now();
      // 同一份内容重复分析（refresh）时覆盖旧行：键相同，只保留最新一次的结论。
      db.insert(compareReports)
        .values({
          id: `cmp_${randomUUID()}`,
          contentHash: hash,
          model: config.model,
          leftLabel: left.label,
          rightLabel: right.label,
          analysisJson: JSON.stringify(result.analysis),
          metaJson: JSON.stringify(result.meta),
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: compareReports.contentHash,
          set: {
            analysisJson: JSON.stringify(result.analysis),
            metaJson: JSON.stringify(result.meta),
            model: config.model,
            createdAt: now,
          },
        })
        .run();
      return c.json({
        analysis: result.analysis,
        meta: { ...result.meta, model: config.model, createdAt: now, elapsedMs: now - startedAt },
        cached: false,
      });
    } catch (err) {
      // 前端取消/离开页面导致的失败不当成「分析失败」回传（499 不是合法状态码，用 400 加明确文案）。
      if (c.req.raw.signal.aborted) return c.json({ error: "已取消" }, 400);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `差异分析失败：${message}` }, 502);
    }
  });

  /** 只需要「有没有配 AI 密钥」时用它点亮/禁用按钮，不必真跑一次。 */
  api.get("/ready", (c) => c.json({ ready: Boolean(getAiConfig(db).apiKey) }));

  return api;
}

/** 供测试与调试直接读缓存条数（不对外暴露内容）。 */
export function compareCacheCount(db: AppDatabase): number {
  return db.select().from(compareReports).all().length;
}
