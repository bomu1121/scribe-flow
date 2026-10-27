import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataOverview, PruneOutcome } from "@scribe-flow/shared";
import { createApp } from "../app";
import { createDatabase } from "../db/client";
import { sleep } from "../lib/sleep";
import { UPLOAD_ORPHAN_MIN_AGE_MS } from "../lib/storage";

const cleanupDirs: string[] = [];

afterEach(async () => {
  // Windows 上 sqlite 句柄可能短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-settings-api-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, dataDir, db };
}

type App = ReturnType<typeof createApp>;

async function post(app: App, path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function put(app: App, path: string, body: unknown) {
  return app.request(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** 只关心 general 分段的响应形状。 */
async function generalOf(app: App): Promise<Record<string, unknown>> {
  const body = (await (await app.request("/api/settings")).json()) as { general: Record<string, unknown> };
  return body.general;
}

const textGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "数据账本验收文稿" } },
    { id: "n_merge", type: "process.merge", position: { x: 200, y: 0 }, data: { label: "合并", title: "账本验收" } },
    { id: "n_out", type: "process.output", position: { x: 400, y: 0 }, data: { label: "输出", fileName: "ledger.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
    { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

async function overviewOf(app: App): Promise<DataOverview> {
  return (await app.request("/api/settings/data")).json();
}

/** 跑一次真实的文本链路，返回 runId（等待到结束）。 */
async function runTextPipeline(app: App, name: string): Promise<string> {
  const project = await post(app, "/api/projects", { name });
  const projectId = (await project.json()).id;
  await app.request(`/api/projects/${projectId}/graph`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: textGraph }),
  });
  const started = await post(app, `/api/projects/${projectId}/runs`, { scope: "all" });
  const runId = (await started.json()).id;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const detail = await (await app.request(`/api/runs/${runId}`)).json();
    if (detail.status !== "running") return runId;
    await sleep(100);
  }
  throw new Error(`运行超时：${runId}`);
}

describe("GET /api/settings/data", () => {
  it("账本反映真实产物：跑完一次文本链路后输出分区有文件", async () => {
    const { app } = await setup();
    await runTextPipeline(app, "账本验收");
    const overview = await overviewOf(app);

    expect(overview.areas.map((area) => area.key)).toEqual(["database", "media", "uploads", "runs", "outputs", "graphBackups"]);
    expect(overview.areas.find((area) => area.key === "outputs")).toMatchObject({ files: 1, present: true });
    expect(overview.runs).toEqual({ total: 1, running: 0, finished: 1 });
    expect(overview.projects).toMatchObject({ total: 1, withRuns: 1 });
    expect(overview.reclaimableBytes).toBeGreaterThan(0);
  });
});

describe("「常规」分组设置", () => {
  it("给出各项默认值，并回显解析后的产物目录绝对路径", async () => {
    const { app, dataDir } = await setup();
    const general = await generalOf(app);

    expect(general).toMatchObject({
      concurrency: 2,
      outputDir: "outputs",
      fileNameTemplate: "{project}",
      maxRetries: 2,
      retryBackoffSec: 3,
      runEndNotify: true,
      runEndSound: false,
    });
    expect(general.resolvedOutputDir).toBe(join(dataDir, "outputs"));
  });

  it("产物目录可以填数据目录之外的绝对路径，账本会标出这一点", async () => {
    const { app, dataDir } = await setup();
    const external = join(dirname(dataDir), "我的笔记");

    const response = await put(app, "/api/settings", { general: { outputDir: external } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { general: Record<string, unknown> }).general.resolvedOutputDir).toBe(external);

    const area = (await overviewOf(app)).areas.find((item) => item.key === "outputs");
    expect(area?.label).toContain("数据目录之外");
  });

  it("相对路径用 .. 爬到数据目录之外时被拒绝，并说清该怎么改", async () => {
    const { app } = await setup();
    const response = await put(app, "/api/settings", { general: { outputDir: "../../outside" } });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("绝对路径");
    // 被拒的这次不能顺手把别的字段写进去。
    expect((await generalOf(app)).outputDir).toBe("outputs");
  });

  it("清空产物目录等于用回默认目录，而不是留着旧值", async () => {
    const { app } = await setup();
    await put(app, "/api/settings", { general: { outputDir: "notes" } });
    expect((await generalOf(app)).outputDir).toBe("notes");

    await put(app, "/api/settings", { general: { outputDir: "" } });
    expect((await generalOf(app)).outputDir).toBe("outputs");
  });

  it("重试次数 0 是合法值，不能被当成「没传」丢掉", async () => {
    const { app } = await setup();
    await put(app, "/api/settings", { general: { maxRetries: 0, retryBackoffSec: 1 } });
    expect(await generalOf(app)).toMatchObject({ maxRetries: 0, retryBackoffSec: 1 });
  });
});

describe("「Obsidian」分组设置", () => {
  /** 只关心 obsidian 分段的响应形状。 */
  async function obsidianOf(app: App): Promise<Record<string, unknown>> {
    const body = (await (await app.request("/api/settings")).json()) as { obsidian: Record<string, unknown> };
    return body.obsidian;
  }

  // 与「重试次数 0」同一类坑，而且是同一个写法栽的：读取时用 `Number(...) || 5` 兜底，
  // 把合法的 0（＝不关联）悄悄变成 5 —— 用户调到 0、保存、看着成功了，保存时却还在连笔记。
  it("每篇最多关联几篇：0 是合法值，不能被当成「没传」丢掉", async () => {
    const { app } = await setup();
    await put(app, "/api/settings", { obsidian: { autoLinkMax: 0 } });
    expect(await obsidianOf(app)).toMatchObject({ autoLinkMax: 0 });
  });

  it("给溯源笔记打标签默认关，打开后能读回来", async () => {
    const { app } = await setup();
    expect((await obsidianOf(app)).tagTraceNotes).toBe(false);
    await put(app, "/api/settings", { obsidian: { tagTraceNotes: true } });
    expect((await obsidianOf(app)).tagTraceNotes).toBe(true);
    await put(app, "/api/settings", { obsidian: { tagTraceNotes: false } });
    expect((await obsidianOf(app)).tagTraceNotes).toBe(false);
  });

  it("溯源默认目录：默认空（跟随普通目录），保存后能读回，清空能回到空", async () => {
    const { app } = await setup();
    expect((await obsidianOf(app)).traceFolder).toBe("");
    // 存进去时去掉首尾斜杠，避免设置页整表回写把「/99-溯源/」当成另一个目录。
    await put(app, "/api/settings", { obsidian: { traceFolder: "/99-溯源/" } });
    expect((await obsidianOf(app)).traceFolder).toBe("99-溯源");
    // 空串是合法值（＝跟随普通目录），不能被 set() 跳过而留下旧值。
    await put(app, "/api/settings", { obsidian: { traceFolder: "" } });
    expect((await obsidianOf(app)).traceFolder).toBe("");
  });

  /**
   * 属性名建议的来源接口。
   *
   * 这里要钉住的是"没配库 / 库是空的"这两种正常情况：它们**不是错误**，必须回一个结构完整的空结果，
   * 界面才能照常把下拉渲染出来——回 4xx/5xx 会让设置页那一段整体变成一句报错。
   */
  describe("GET /api/settings/obsidian/fields", () => {
    it("没配库路径时回空结果，不是报错", async () => {
      const { app } = await setup();
      const response = await app.request("/api/settings/obsidian/fields");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], scanned: 0, capped: false });
    });

    it("配了库就按篇数回报用过的属性名，并排掉我们自己写的固定字段", async () => {
      const { app } = await setup();
      const vault = await mkdtemp(join(tmpdir(), "sf-vault-fields-"));
      cleanupDirs.push(vault);
      await writeFile(
        join(vault, "第一篇.md"),
        "---\n标题: 不该进候选\ntags:\n  - 话题/AI\n人物:\n  - 张三\n时期: 唐朝\n---\n\n正文\n",
        "utf8",
      );
      await writeFile(join(vault, "第二篇.md"), "---\n人物: 李四\n---\n\n正文\n", "utf8");
      await put(app, "/api/settings", { obsidian: { vaultPath: vault } });

      const body = (await (await app.request("/api/settings/obsidian/fields")).json()) as {
        items: Array<{ name: string; count: number }>;
        scanned: number;
        capped: boolean;
      };
      expect(body.items).toEqual([
        { name: "人物", count: 2 },
        { name: "时期", count: 1 },
      ]);
      expect(body.scanned).toBe(2);
      expect(body.capped).toBe(false);
    });

    it("库路径指向不存在的地方也回空结果（用户可能刚填错）", async () => {
      const { app } = await setup();
      await put(app, "/api/settings", { obsidian: { vaultPath: join(tmpdir(), `sf-no-such-vault-${Date.now()}`) } });
      expect(await (await app.request("/api/settings/obsidian/fields")).json()).toEqual({ items: [], scanned: 0, capped: false });
    });
  });

  describe("GET /api/settings/obsidian/tags", () => {
    it("没配库路径时回空结果，不是报错", async () => {
      const { app } = await setup();
      const response = await app.request("/api/settings/obsidian/tags");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], scanned: 0, capped: false });
    });

    it("按「多少篇用过」统计标签，front matter 与行内都算", async () => {
      const { app } = await setup();
      const vault = await mkdtemp(join(tmpdir(), "sf-vault-tags-"));
      cleanupDirs.push(vault);
      await writeFile(join(vault, "第一篇.md"), "---\ntags:\n  - 来源/B站\n  - 话题/平台抽成\n---\n\n正文。\n", "utf8");
      await writeFile(join(vault, "第二篇.md"), "---\ntags:\n  - 来源/B站\n---\n\n这里又提到 #话题/平台抽成。\n", "utf8");
      await put(app, "/api/settings", { obsidian: { vaultPath: vault } });

      const body = (await (await app.request("/api/settings/obsidian/tags")).json()) as {
        items: Array<{ tag: string; count: number }>;
        scanned: number;
      };
      // 篇数相同按中文拼音序（话题 < 来源），列表顺序因此是稳定的
      expect(body.items).toEqual([
        { tag: "话题/平台抽成", count: 2 },
        { tag: "来源/B站", count: 2 },
      ]);
      expect(body.scanned).toBe(2);
    });
  });

  /**
   * 词库编辑器的显示样式：三选一，纯展示。
   * 这里要钉住的是**坏值必须被丢掉**——手改过库、或将来删掉某个模式之后，
   * 这一格不该让设置页打不开（回落默认就行）。
   */
  /**
   * 词库的出厂值与两个自动标签开关。
   *
   * 这里的重点是**老安装**：`obsidian.tagTaxonomy` 早就整表保存过一次，
   * 所以改出厂值对它不生效，只能靠读取时收口。
   */
  describe("词库出厂值与自动标签开关", () => {
    const obsidianOf = async (app: App): Promise<Record<string, unknown>> => {
      const body = (await (await app.request("/api/settings")).json()) as { obsidian: Record<string, unknown> };
      return body.obsidian;
    };

    it("新装：词库里只有用户维护的话题分组，两个自动标签开关默认开", async () => {
      const { app } = await setup();
      const obsidian = await obsidianOf(app);
      expect(Object.keys(obsidian.tagTaxonomy as Record<string, string[]>).sort()).toEqual(["类型", "领域"]);
      expect(obsidian.sourceTagEnabled).toBe(true);
      expect(obsidian.upTagEnabled).toBe(true);
      expect(obsidian.autoTagEnabled).toBe(true); // 话题标签的 AI 开关是另一件事，没被动
    });

    it("老安装：自动分组与「还是出厂那套」的退休分组被摘掉，用户自己改过的留着", async () => {
      const { app } = await setup();
      // 模拟老版本存过的整份词库：来源/概念/状态/UP主名称 都还在，另有一个用户自建的分组
      await put(app, "/api/settings", {
        obsidian: {
          tagTaxonomy: {
            来源: ["B站", "文稿", "本地视频", "网页", "播客"],
            UP主名称: [],
            状态: ["未整理", "已整理"],
            概念: ["Obsidian", "PARA", "Zettelkasten", "RAG", "双链", "Templater", "Dataview"],
            领域: ["AI", "历史"],
            读书笔记: ["技术书"],
          },
        },
      });

      const taxonomy = (await obsidianOf(app)).tagTaxonomy as Record<string, string[]>;
      // 自动分组：无条件摘掉（它们改由元数据写，只留开关）
      expect(taxonomy["来源"]).toBeUndefined();
      expect(taxonomy["UP主名称"]).toBeUndefined();
      // 状态：内容还是出厂那套 → 摘掉
      expect(taxonomy["状态"]).toBeUndefined();
      // 概念：也被摘掉（内容与出厂一致）
      expect(taxonomy["概念"]).toBeUndefined();
      // 用户维护的两组原样留着
      expect(taxonomy["领域"]).toEqual(["AI", "历史"]);
      expect(taxonomy["读书笔记"]).toEqual(["技术书"]);
    });

    it("退休分组只要用户动过就保留（不删用户的东西）", async () => {
      const { app } = await setup();
      await put(app, "/api/settings", { obsidian: { tagTaxonomy: { 状态: ["未整理", "已整理", "我的状态"] } } });
      const taxonomy = (await obsidianOf(app)).tagTaxonomy as Record<string, string[]>;
      expect(taxonomy["状态"]).toEqual(["未整理", "已整理", "我的状态"]);
    });

    it("两个开关能存能取", async () => {
      const { app } = await setup();
      await put(app, "/api/settings", { obsidian: { sourceTagEnabled: false, upTagEnabled: false } });
      const obsidian = await obsidianOf(app);
      expect(obsidian.sourceTagEnabled).toBe(false);
      expect(obsidian.upTagEnabled).toBe(false);
    });
  });

  describe("词库显示样式 tagView", () => {
    it("默认是 plain（单色），保存后按选中的回显", async () => {
      const { app } = await setup();
      expect(await obsidianOf(app)).toMatchObject({ tagView: "plain" });
      await put(app, "/api/settings", { obsidian: { tagView: "list" } });
      expect(await obsidianOf(app)).toMatchObject({ tagView: "list" });
    });

    it("不认识的值会被丢掉，回落到已保存的那个", async () => {
      const { app } = await setup();
      await put(app, "/api/settings", { obsidian: { tagView: "plain" } });
      const response = await put(app, "/api/settings", { obsidian: { tagView: "rainbow" } });
      // 校验层就该拦住它：整条请求 400，而不是写进库里
      expect(response.status).toBe(400);
      expect(await obsidianOf(app)).toMatchObject({ tagView: "plain" });
    });
  });
});

describe("「展示范围」分组设置", () => {
  it("默认什么都不隐藏，保存后按列表回显（只留认识的节点类型）", async () => {
    const { app } = await setup();
    const before = (await (await app.request("/api/settings")).json()) as { visibility: { hiddenNodes: string[] } };
    expect(before.visibility.hiddenNodes).toEqual([]);

    const saved = (await (
      await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: { hiddenNodes: ["process.gameguide", "process.gameguide", "process.drill"] } }),
      })
    ).json()) as { visibility: { hiddenNodes: string[] } };
    // 去重后落库，顺序按提交顺序。
    expect(saved.visibility.hiddenNodes).toEqual(["process.gameguide", "process.drill"]);

    const again = (await (await app.request("/api/settings")).json()) as { visibility: { hiddenNodes: string[] } };
    expect(again.visibility.hiddenNodes).toEqual(["process.gameguide", "process.drill"]);
  });

  it("传了不存在的节点类型时 400，不悄悄写进库", async () => {
    const { app } = await setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: { hiddenNodes: ["process.not-a-node"] } }),
    });
    expect(res.status).toBe(400);
    const after = (await (await app.request("/api/settings")).json()) as { visibility: { hiddenNodes: string[] } };
    expect(after.visibility.hiddenNodes).toEqual([]);
  });

  it("库里存了坏数据（手改过）时当作什么都没隐藏，不让设置页打不开", async () => {
    const { app, db } = await setup();
    const { appSettings } = await import("../db/schema");
    db.insert(appSettings).values({ key: "visibility.hiddenNodes", value: "{坏 JSON", updatedAt: Date.now() }).run();
    const res = (await (await app.request("/api/settings")).json()) as { visibility: { hiddenNodes: string[] } };
    expect(res.visibility.hiddenNodes).toEqual([]);

    db.update(appSettings).set({ value: '["process.gameguide","不存在的老类型"]' }).run();
    const second = (await (await app.request("/api/settings")).json()) as { visibility: { hiddenNodes: string[] } };
    expect(second.visibility.hiddenNodes).toEqual(["process.gameguide"]);
  });
});

describe("POST /api/settings/prune", () => {
  it("清运行记录：运行、产物文件与中间文件一起回收，再查账本归零", async () => {
    const { app, dataDir } = await setup();
    await runTextPipeline(app, "清理验收");
    const before = await overviewOf(app);
    const planned = before.cleanup.find((item) => item.target === "runs");
    expect(planned?.count).toBe(1);

    const response = await post(app, "/api/settings/prune", { targets: ["runs"] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { outcomes: PruneOutcome[]; removed: number; bytes: number; errors: string[] };
    expect(result.removed).toBe(1);
    expect(result.errors).toEqual([]);
    // 释放的字节数必须落在「计划值」附近：计划算的是删除前实测，执行后不允许凭空多出或少算。
    expect(result.bytes).toBe(planned?.bytes);

    const after = await overviewOf(app);
    expect(after.runs).toEqual({ total: 0, running: 0, finished: 0 });
    expect(after.areas.find((area) => area.key === "outputs")).toMatchObject({ files: 0, bytes: 0 });
    expect(after.areas.find((area) => area.key === "runs")).toMatchObject({ files: 0, bytes: 0 });
    expect(after.reclaimableBytes).toBe(0);
    // 文本链路本来就不写 runs/，目录可能压根没被创建——这里只要求「不剩任何运行目录」。
    await expect(readdir(join(dataDir, "runs")).catch(() => [] as string[])).resolves.toEqual([]);
  });

  it("清孤立上传原件：只删超期那份", async () => {
    const { app, dataDir } = await setup();
    const stalePath = join(dataDir, "uploads", "stale.mp4");
    await mkdir(dirname(stalePath), { recursive: true });
    await writeFile(stalePath, "stale-bytes");
    await writeFile(join(dataDir, "uploads", "fresh.mp4"), "fresh-bytes");
    const old = new Date(Date.now() - UPLOAD_ORPHAN_MIN_AGE_MS - 60_000);
    await utimes(stalePath, old, old);

    const response = await post(app, "/api/settings/prune", { targets: ["uploadOrphans"] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { removed: number; bytes: number };
    expect(result).toMatchObject({ removed: 1, bytes: 11 });
    await expect(readdir(join(dataDir, "uploads"))).resolves.toEqual(["fresh.mp4"]);
  });

  it("目标列表非法时返回 400 且不清理任何东西", async () => {
    const { app } = await setup();
    expect((await post(app, "/api/settings/prune", {})).status).toBe(400);
    expect((await post(app, "/api/settings/prune", { targets: [] })).status).toBe(400);
    expect((await post(app, "/api/settings/prune", { targets: ["全部"] })).status).toBe(400);
  });
});
