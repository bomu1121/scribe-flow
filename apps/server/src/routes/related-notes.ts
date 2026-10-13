import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { RelatedJobView, RelatedPlanView, RelatedReportView } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import type { RunEngine } from "../lib/engine";
import { getSettings } from "../lib/settings";
import { assertVaultPath } from "../lib/tagging";
import {
  planRelatedBackfill,
  runRelatedBackfill,
  type RelatedPlan,
  type RelatedProgress,
  type RelatedReport,
} from "../lib/related-notes";

/** 预估里回多少条样例路径：够看清"要动哪些"，又不至于把上千条塞进响应。 */
const SAMPLE_LIMIT = 30;

interface RelatedJob extends RelatedJobView {
  report?: RelatedReportView;
}

function toPlanView(plan: RelatedPlan): RelatedPlanView {
  return {
    vaultPath: plan.vaultPath,
    totalNotes: plan.totalNotes,
    willUpdate: plan.willUpdate,
    unchanged: plan.unchanged,
    noFields: plan.noFields,
    plannedLinks: plan.plannedLinks,
    samples: plan.samples,
  };
}

function toReportView(report: RelatedReport): RelatedReportView {
  return {
    totalNotes: report.totalNotes,
    written: report.written,
    unchanged: report.unchanged,
    failed: report.failed,
    linksWritten: report.linksWritten,
  };
}

/**
 * 「相关笔记」的全库回补。
 *
 * 与 `/api/taxonomy` 分开而不是塞进去：这条链路**不调模型**，代价从"钱"降成"IO"，
 * 所以界面可以做得比重打标轻（不必先看清楚再发车），两件事的语义也不同。
 * 沿用 `media.ts` 那套 jobId 轮询，不新开 SSE 通道。
 */
export function relatedNotesApi(db: AppDatabase, engine: RunEngine) {
  const api = new Hono();
  const jobs = new Map<string, RelatedJob>();

  /**
   * 读一次配置并校验。回补是"把当前的配置补到旧笔记上"，所以配置本身就是前置条件：
   * 缺哪一项就明确说缺哪一项，而不是跑出一个空结果让人以为"库里没有相关笔记"。
   */
  function readConfig(): { ok: true; vaultPath: string; fields: string[]; max: number } | { ok: false; error: string } {
    const { obsidian } = getSettings(db);
    const vaultPath = obsidian.vaultPath.trim();
    if (!vaultPath) return { ok: false, error: "未配置 Obsidian 库路径，请先到设置页填写" };
    if (!obsidian.autoLinkEnabled) {
      return { ok: false, error: "「让同题材的旧笔记互相链接」是关着的——回补只是把这条规则补到旧笔记上，先打开它" };
    }
    if (obsidian.extractFields.length === 0) {
      return { ok: false, error: "没有配置「抽取哪些属性」——相关笔记靠这些属性在库里比对，先在上面填一组试试" };
    }
    if (obsidian.autoLinkMax <= 0) {
      return { ok: false, error: "「每篇最多关联几篇」是 0，这一轮写不出任何链接；先把它调成大于 0" };
    }
    return { ok: true, vaultPath, fields: obsidian.extractFields, max: obsidian.autoLinkMax };
  }

  api.post("/plan", async (c) => {
    const config = readConfig();
    if (!config.ok) return c.json({ error: config.error }, 400);
    try {
      await assertVaultPath(config.vaultPath);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "库路径不可用" }, 400);
    }
    const plan = await planRelatedBackfill(config.vaultPath, config.fields, config.max, SAMPLE_LIMIT);
    return c.json(toPlanView(plan));
  });

  api.post("/run", async (c) => {
    const config = readConfig();
    if (!config.ok) return c.json({ error: config.error }, 400);
    try {
      await assertVaultPath(config.vaultPath);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "库路径不可用" }, 400);
    }
    // 运行期间引擎也在写笔记，两边同时改同一个文件会互相覆盖。
    const active = engine.activeRunIds;
    if (active.length > 0) return c.json({ error: `有 ${active.length} 个运行正在进行，等结束再回补` }, 409);
    for (const job of jobs.values()) {
      if (job.status === "running") return c.json({ jobId: job.id });
    }

    const jobId = `related_${randomUUID()}`;
    const job: RelatedJob = { id: jobId, status: "running", stage: "scan", processed: 0, total: 0, message: "准备中…" };
    jobs.set(jobId, job);

    const onProgress = (progress: RelatedProgress) => {
      job.stage = progress.stage;
      job.processed = progress.processed;
      job.total = progress.total;
      job.message = progress.message;
    };

    void runRelatedBackfill(config.vaultPath, config.fields, config.max, { onProgress }).then(
      (report) => {
        job.status = "done";
        job.stage = "done";
        job.message = `写入 ${report.written} 篇 · ${report.linksWritten} 条链接`;
        job.report = toReportView(report);
      },
      (error: unknown) => {
        job.status = "error";
        job.error = error instanceof Error ? error.message : String(error);
        job.message = "回补失败";
      },
    );

    return c.json({ jobId }, 202);
  });

  api.get("/jobs/:jobId", (c) => {
    const job = jobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "回补任务不存在" }, 404);
    return c.json(job satisfies RelatedJobView);
  });

  return api;
}
