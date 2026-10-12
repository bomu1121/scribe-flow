import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { parseGraph } from "@scribe-flow/shared";
import { createDatabase, type AppDatabase } from "../db/client";
import { projects, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";
import { updateSettings } from "./settings";
import { sleep } from "./sleep";

/**
 * Obsidian 笔记节点：保存目录里已有同名笔记时，是覆盖它还是退让成 `标题 (2).md`。
 *
 * 走真实引擎与真实磁盘：这个开关的价值就在「最后落在文件系统上的那个名字」，
 * 只调纯函数测不出引擎有没有真的用上它。全程离线——不配 AI 密钥，标签判定与属性抽取两条模型路径都不会触发。
 */

const tmpDirs: string[] = [];
const TITLE = "第1期";
const BODY = "这是本次运行的正文。";
/** 笔记节点写进去的子目录：节点没填 folder 时用设置页的默认值。 */
const FOLDER = "00-Inbox";

afterEach(async () => {
  // sqlite 句柄可能在 Windows 上短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface NoteRunResult {
  status: string | undefined;
  summary: string | null | undefined;
}

/** 跑一次「文本 → Obsidian 笔记」，返回笔记节点那一次的落库结果。 */
async function runNote(vaultPath: string, data: Record<string, unknown>, tag: string): Promise<NoteRunResult> {
  const dataDir = await tempDir(`scribe-obsidian-${tag}-`);
  const db = createDatabase(dataDir);
  // 只留「写到本地库」这一条路：关联与属性抽取关掉，测试不碰网络也不依赖模型。
  updateSettings(db, { obsidian: { vaultPath, autoLinkEnabled: false, extractFields: [] } });
  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [
      { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: BODY } },
      { id: "n_note", type: "process.obsidian", position: { x: 320, y: 0 }, data: { label: "Obsidian 笔记", title: TITLE, ...data } },
    ],
    edges: [{ id: "e1", source: "n_src", target: "n_note", sourceHandle: "transcript", targetHandle: "in" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  // 前置断言：工程图校验不能把这个开关吃掉。少了它，下面的用例会静默退化成"覆盖模式"，
  // 看起来是绿的实际什么都没验到。
  if (data.overwrite !== undefined) {
    const kept = (graph.nodes.find((node) => node.id === "n_note")?.data as Record<string, unknown> | undefined)?.overwrite;
    expect(kept, "parseGraph 丢掉了 overwrite").toBe(data.overwrite);
  }

  const projectId = `prj_${tag}`;
  const runId = `run_${tag}`;
  const now = Date.now();
  db.insert(projects)
    .values({ id: projectId, name: tag, description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  db.insert(runs).values({ id: runId, projectId, status: "running", scope: "all", createdAt: now, graphJson: JSON.stringify(graph) }).run();
  new RunEngine(db, dataDir).start(runId, projectId, graph, "all");

  await waitUntilFinished(db, runId, tag);
  const row = db.select().from(runNodeResults).where(and(eq(runNodeResults.runId, runId), eq(runNodeResults.nodeId, "n_note"))).get();
  return { status: row?.status, summary: row?.summary };
}

async function waitUntilFinished(db: AppDatabase, runId: string, tag: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row, `${tag}：运行没有落库`).toBeTruthy();
  expect(row!.status, `${tag}：运行没有在 ${timeoutMs}ms 内结束（${row!.status}）`).not.toBe("running");
}

/** 建一个只装着指定笔记的库，返回库路径与目标子目录。 */
async function makeVault(seed: Record<string, string> = {}): Promise<{ vault: string; dir: string }> {
  const vault = await tempDir("scribe-vault-");
  const dir = join(vault, FOLDER);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(seed)) await writeFile(join(dir, name), content, "utf8");
  return { vault, dir };
}

async function noteFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
}

describe("Obsidian 笔记：同名时覆盖还是退让", () => {
  it("默认覆盖：同名笔记整篇重写，人写的正文被替换、人写的标签留下", async () => {
    const handWritten = "---\ntags:\n  - 我自己打的标签\n---\n\n人手写的正文，这次运行会把它盖掉。\n";
    const { vault, dir } = await makeVault({ [`${TITLE}.md`]: handWritten });

    const first = await runNote(vault, {}, "overwrite-first");
    expect(first.status).toBe("done");

    // 只该有那一篇：覆盖模式下不生成 (2)。
    expect(await noteFiles(dir)).toEqual([`${TITLE}.md`]);
    const content = await readFile(join(dir, `${TITLE}.md`), "utf8");
    expect(content).toContain("我自己打的标签");
    expect(content).toContain(BODY);
    expect(content).not.toContain("人手写的正文");
  });

  it("关掉覆盖：已有同名笔记时另写 (2)，那篇人手写的原样不动", async () => {
    const handWritten = "---\ntags:\n  - 我自己打的标签\n---\n\n人手写的正文，关掉覆盖后不该被动。\n";
    const { vault, dir } = await makeVault({ [`${TITLE}.md`]: handWritten });

    const result = await runNote(vault, { overwrite: false }, "keep-hand");
    expect(result.status).toBe("done");
    // 摘要里报的就是实际落盘的那个名字，用户不用去猜写哪儿了。
    expect(result.summary).toContain(`${TITLE} (2).md`);

    expect(await noteFiles(dir)).toEqual([`${TITLE} (2).md`, `${TITLE}.md`]);
    // 一个字节都不该动。
    expect(await readFile(join(dir, `${TITLE}.md`), "utf8")).toBe(handWritten);
    expect(await readFile(join(dir, `${TITLE} (2).md`), "utf8")).toContain(BODY);
  });

  it("关掉覆盖：重复运行接着排 (3)、(4)", async () => {
    const { vault, dir } = await makeVault();

    await runNote(vault, { overwrite: false }, "seq-1");
    await runNote(vault, { overwrite: false }, "seq-2");
    await runNote(vault, { overwrite: false }, "seq-3");

    expect(await noteFiles(dir)).toEqual([`${TITLE} (2).md`, `${TITLE} (3).md`, `${TITLE}.md`]);
  });
});
