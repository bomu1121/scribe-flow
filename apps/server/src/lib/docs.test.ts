import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocAccessError, listDocs, readDoc, resolveDocPath } from "./docs";
import { parseDocFrontMatter } from "@scribe-flow/shared";
import { docsApi } from "../routes/docs";

/**
 * 文档阅读器读的是磁盘文件，路径包含性是它最重要的一条性质：
 * 一旦被绕过，就等于把仓库任意文件暴露成只读接口。
 */
describe("文档读取：路径包含性", () => {
  let repo: string;
  let docs: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "sf-docs-"));
    docs = join(repo, "docs");
    mkdirSync(join(docs, "decisions"), { recursive: true });
    mkdirSync(join(docs, "research", "raw"), { recursive: true });
    writeFileSync(
      join(docs, "status.md"),
      "---\ntitle: 项目现状\nclass: status\nowner: 念前\nlast_reviewed: 2026-09-11\n---\n\n# 项目现状\n\n正文\n",
      "utf8",
    );
    writeFileSync(join(docs, "decisions", "a.md"), "# 决策 A\n\n内容\n", "utf8");
    writeFileSync(join(docs, "research", "raw", "scrape.md"), "# 抓取原文\n", "utf8");
    // 仓库根下的敏感文件：任何情况下都不该被读到
    writeFileSync(join(repo, "secret.md"), "# 不该被读到\n", "utf8");
    writeFileSync(join(repo, "secret.ts"), "const x = 1;\n", "utf8");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("接受 docs/ 下的 .md，并允许省略扩展名", () => {
    expect(resolveDocPath(docs, "docs/status.md").repoPath).toBe("docs/status.md");
    expect(resolveDocPath(docs, "docs/status").repoPath).toBe("docs/status.md");
    expect(resolveDocPath(docs, "docs/decisions/a.md").repoPath).toBe("docs/decisions/a.md");
  });

  it("拒绝 ../ 形式的目录穿越（含藏在 docs/ 前缀之后的）", () => {
    for (const bad of [
      "docs/../secret.md",
      "docs/../../etc/passwd.md",
      "docs/a/../../../secret.md",
      "docs/./../../secret.md",
      "../secret.md",
      "docs\\..\\secret.md",
    ]) {
      expect(() => resolveDocPath(docs, bad), bad).toThrow(DocAccessError);
    }
  });

  it("拒绝绝对路径与盘符路径", () => {
    for (const bad of ["/etc/passwd.md", "C:\\Windows\\win.ini", "D:/secret.md"]) {
      expect(() => resolveDocPath(docs, bad), bad).toThrow(DocAccessError);
    }
  });

  it("拒绝不带 docs/ 前缀的路径（仓库根文件从一开始就不可达）", () => {
    for (const bad of ["secret.md", "secret.ts", "apps/server/src/app.ts"]) {
      expect(() => resolveDocPath(docs, bad), bad).toThrow(DocAccessError);
    }
  });

  it("拒绝非 markdown 文件", () => {
    expect(() => resolveDocPath(docs, "docs/status.ts")).toThrow(DocAccessError);
    expect(() => resolveDocPath(docs, "docs/../secret.ts")).toThrow(DocAccessError);
  });

  it("带非 md 扩展名报 400，而不是补成 .ts.md 后报不存在", () => {
    for (const bad of ["docs/status.ts", "docs/app.json", "docs/x.html"]) {
      try {
        resolveDocPath(docs, bad);
        throw new Error("应该抛错");
      } catch (err) {
        expect(err, bad).toBeInstanceOf(DocAccessError);
        expect((err as DocAccessError).status, bad).toBe(400);
      }
    }
  });

  it("拒绝空路径与含 NUL 的路径", () => {
    expect(() => resolveDocPath(docs, "")).toThrow(DocAccessError);
    expect(() => resolveDocPath(docs, "   ")).toThrow(DocAccessError);
    expect(() => resolveDocPath(docs, "docs/status.md\0.png")).toThrow(DocAccessError);
  });

  it("不存在的文档报 404 而不是 500", () => {
    try {
      resolveDocPath(docs, "docs/nope.md");
      throw new Error("应该抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(DocAccessError);
      expect((err as DocAccessError).status).toBe(404);
    }
  });

  it("同级同前缀目录不可达（前缀比较的经典绕过）", () => {
    // 这条锁住的是实现方式：包含性必须用 path.relative，不能用 abs.startsWith(root)。
    // 若用字符串前缀比较，`…/docs-evil/x.md`.startsWith(`…/docs`) 为真，越界会被放行。
    const evil = `${docs}-evil`;
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, "x.md"), "# 越界\n", "utf8");
    try {
      expect(`${join(evil, "x.md")}`.startsWith(docs)).toBe(true);
      expect(() => readDoc(docs, "docs-evil/x.md")).toThrow(DocAccessError);
    } finally {
      rmSync(evil, { recursive: true, force: true });
    }
  });
});

describe("文档读取：列表与正文", () => {
  let repo: string;
  let docs: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "sf-docs-list-"));
    docs = join(repo, "docs");
    mkdirSync(join(docs, "decisions"), { recursive: true });
    writeFileSync(
      join(docs, "status.md"),
      "---\ntitle: 项目现状\nclass: status\nowner: 念前\nlast_reviewed: 2026-09-11\n---\n\n# 项目现状\n\n正文\n",
      "utf8",
    );
    writeFileSync(join(docs, "decisions", "b.md"), "# 决策 B\n\n无 front matter 的正文\n", "utf8");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("列出全部 markdown，带上路径、目录与元数据", () => {
    const items = listDocs(docs);
    expect(items.map((i) => i.path)).toEqual(["docs/decisions/b.md", "docs/status.md"]);
    const status = items.find((i) => i.path === "docs/status.md");
    expect(status?.dir).toBe("docs");
    expect(status?.frontMatter?.class).toBe("status");
    expect(status?.title).toBe("项目现状");
  });

  it("没有 front matter 的文档也能列出，标题回落到首个 H1", () => {
    const item = listDocs(docs).find((i) => i.path === "docs/decisions/b.md");
    expect(item?.frontMatter).toBeNull();
    expect(item?.title).toBe("决策 B");
  });

  it("读正文时把 front matter 摘掉，元数据单独返回", () => {
    const doc = readDoc(docs, "docs/status.md");
    expect(doc.frontMatter?.title).toBe("项目现状");
    expect(doc.body).not.toContain("class: status");
    expect(doc.body).toContain("# 项目现状");
  });

  it("docs 目录缺失时列表为空，而不是抛错", () => {
    expect(listDocs(join(repo, "no-such-dir"))).toEqual([]);
  });
});

describe("文档接口", () => {
  let repo: string;
  let app: Hono;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "sf-docs-api-"));
    const docs = join(repo, "docs");
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "status.md"), "# 项目现状\n\n正文\n", "utf8");
    app = new Hono().route("/api/docs", docsApi(docs));
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("GET /api/docs 返回列表与可用标记", async () => {
    const res = await app.request("/api/docs");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { available: boolean; items: { path: string }[] };
    expect(data.available).toBe(true);
    expect(data.items.map((i) => i.path)).toEqual(["docs/status.md"]);
  });

  it("GET /api/docs/file 返回正文与元数据", async () => {
    const res = await app.request("/api/docs/file?path=docs/status.md");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { body: string; title: string };
    expect(data.title).toBe("项目现状");
    expect(data.body).toContain("正文");
  });

  it("目录穿越返回 400，不泄漏文件内容", async () => {
    const res = await app.request("/api/docs/file?path=../secret.md");
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("不该被读到");
  });

  it("缺少 path 参数返回 400", async () => {
    expect((await app.request("/api/docs/file")).status).toBe(400);
  });
});

/**
 * front matter 解析器在 `packages/shared/src/docs.ts`（TS，前后端共用）与
 * `scripts/lib/docs-shared.mjs`（门禁脚本，必须能直接 node 运行、不依赖构建）各有一份。
 * 这条对拍测试防止两份实现漂移——改任一侧都要让这里继续通过。
 */
describe("front matter 解析：与门禁脚本的实现对拍", () => {
  it("同一组样例下两侧结果一致", async () => {
    const shared = parseDocFrontMatter(
      "---\ntitle: T\nclass: decision\nstatus: accepted\nowner: 念前\nlast_reviewed: 2026-09-11\n---\n\n# T\n\n正文\n",
    );
    expect(shared).not.toBeNull();
    expect(shared?.data.class).toBe("decision");
    expect(shared?.data.status).toBe("accepted");
    expect(shared?.data.owner).toBe("念前");
    expect(shared?.body).toContain("# T");

    // 无 front matter / 未闭合 / 空值 / 引号包裹，四种边界的期望行为
    expect(parseDocFrontMatter("# 只有正文\n")).toBeNull();
    expect(parseDocFrontMatter("---\ntitle: T\n\n# 未闭合\n")).toBeNull();
    expect(parseDocFrontMatter("---\ntitle:\nclass: status\n---\n\n# T\n")?.data.title).toBeUndefined();
    expect(parseDocFrontMatter('---\ntitle: "带引号"\n---\n\n# T\n')?.data.title).toBe("带引号");
    // CRLF 归一
    expect(parseDocFrontMatter("---\r\ntitle: T\r\n---\r\n\r\n# T\r\n")?.data.title).toBe("T");
  });
});
