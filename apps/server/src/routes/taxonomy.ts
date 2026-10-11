import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { RetagJobView, RetagPlanView, RetagReportView } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import type { RunEngine } from "../lib/engine";
import { getAiConfig, getSettings, updateSettings } from "../lib/settings";
import { assertVaultPath, planRetag, runRetag, type RetagPlan, type RetagProgress, type RetagReport } from "../lib/tagging";

/** 预估里回多少条样例路径：够看清"要动哪些"，又不至于把上千条塞进响应。 */
const SAMPLE_LIMIT = 30;

interface RetagJob extends RetagJobView {
  report?: RetagReportView;
}

function toPlanView(plan: RetagPlan): RetagPlanView {
  const samples = [
    ...plan.fullNotes.map((relPath) => ({ relPath, mode: "full" as const })),
    ...plan.incrementalNotes.map((relPath) => ({ relPath, mode: "incremental" as const })),
    ...plan.cleanupNotes.map((relPath) => ({ relPath, mode: "cleanup" as const })),
  ].slice(0, SAMPLE_LIMIT);
  return {
    vaultPath: plan.vaultPath,
    totalNotes: plan.totalNotes,
    fullCount: plan.fullNotes.length,
    incrementalCount: plan.incrementalNotes.length,
    cleanupCount: plan.cleanupNotes.length,
    unchanged: plan.unchanged,
    estimatedCalls: plan.estimatedCalls,
    addedTags: plan.addedTags,
    removedTags: plan.removedTags,
    unparsable: plan.unparsable,
    samples,
  };
}

function toReportView(report: RetagReport): RetagReportView {
  return {
    totalNotes: report.totalNotes,
    written: report.written,
    unchanged: report.unchanged,
    failed: report.failed,
    addedTags: report.addedTags,
    removedTags: report.removedTags,
    learnedTags: report.learnedTags,
    calls: report.calls,
    usage: report.usage,
  };
}

/**
 * 全库重打标。
 *
 * 刻意做成「先 plan、再 run」两步：plan 完全是本地计算（不调模型），界面把
 * "要动多少篇、大约几次调用"摆出来，用户点了才真的花钱。
 *
 * 进度走轮询而不是 SSE：仓库里 `RunEvent` 是运行专用的，为这个任务新开一条 SSE 通道
 * 不划算；`media.ts` 的 jobId 轮询是现成且已验证的形态。
 */
export function taxonomyApi(db: AppDatabase, engine: RunEngine) {
  const api = new Hono();
  const jobs = new Map<string, RetagJob>();

  api.post("/plan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { deep?: boolean };
    const { obsidian } = getSettings(db);
    const vaultPath = obsidian.vaultPath.trim();
    if (!vaultPath) return c.json({ error: "未配置 Obsidian 库路径，请先到设置页填写" }, 400);
    try {
      await assertVaultPath(vaultPath);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "库路径不可用" }, 400);
    }
    const plan = await planRetag(db, vaultPath, obsidian.tagTaxonomy, { deep: Boolean(body.deep) });
    return c.json(toPlanView(plan));
  });

  api.post("/run", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { deep?: boolean };
    const settings = getSettings(db);
    const vaultPath = settings.obsidian.vaultPath.trim();
    if (!vaultPath) return c.json({ error: "未配置 Obsidian 库路径，请先到设置页填写" }, 400);
    try {
      await assertVaultPath(vaultPath);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "库路径不可用" }, 400);
    }
    const aiConfig = getAiConfig(db);
    if (!aiConfig.apiKey) return c.json({ error: "未配置 AI 模型密钥，请先到设置页填写" }, 400);
    // 运行期间也在写笔记，两边同时改同一个文件会互相覆盖。
    const active = engine.activeRunIds;
    if (active.length > 0) return c.json({ error: `有 ${active.length} 个运行正在进行，等结束再重打标` }, 409);
    for (const job of jobs.values()) {
      if (job.status === "running") return c.json({ jobId: job.id });
    }

    const jobId = `retag_${randomUUID()}`;
    const job: RetagJob = { id: jobId, status: "running", stage: "scan", processed: 0, total: 0, message: "准备中…" };
    jobs.set(jobId, job);

    const onProgress = (progress: RetagProgress) => {
      job.stage = progress.stage;
      job.processed = progress.processed;
      job.total = progress.total;
      job.message = progress.message;
    };

    void runRetag(db, aiConfig, vaultPath, settings.obsidian.tagTaxonomy, {
      allowNewTags: settings.obsidian.allowNewTags,
      deep: Boolean(body.deep),
      onProgress,
    }).then(
      (report) => {
        // AI 补出来的新叶子要落库，否则下一轮会被当成"已删除的标签"从笔记里清掉。
        if (report.taxonomyChanged) updateSettings(db, { obsidian: { tagTaxonomy: report.taxonomy } });
        job.status = "done";
        job.stage = "done";
        job.message = `写入 ${report.written} 篇 · 调用 ${report.calls} 次`;
        job.report = toReportView(report);
      },
      (error: unknown) => {
        job.status = "error";
        job.error = error instanceof Error ? error.message : String(error);
        job.message = "重打标失败";
      },
    );

    return c.json({ jobId }, 202);
  });

  api.get("/jobs/:jobId", (c) => {
    const job = jobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "重打标任务不存在" }, 404);
    return c.json(job satisfies RetagJobView);
  });

  return api;
}
