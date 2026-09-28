import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS, type Recipe } from "@scribe-flow/shared";
import { buildDrill } from "./drill";
import { readSearchQueries, renderStepSystem } from "./recipe";
import type { SearchConfig } from "./settings";
import { lookupReferenceSources } from "./traceExternal";

/**
 * 练一练联网出题的**跨模块链路**验收：按真实执行顺序串起四处实现，不 mock 我们自己的代码——
 *  ① 抽点产物（模型输出）── readSearchQueries ──▶ 检索词
 *  ② 检索词 ── lookupReferenceSources（打本地桩检索服务）──▶ 参考资料文本
 *  ③ 参考资料 ── renderStepSystem（真实的 builtin.drill 出题步 system）──▶ 送模型的 system
 *  ④ 模型产物（带 externalRef）── buildDrill ──▶ 只留真检索到的参考
 *
 * 引擎侧的薄胶水（谁在什么时候调 ②）由 `engine.recipe.test.ts` 覆盖「未配渠道 → 按不联网执行」；
 * 这里补的是「配了渠道时这条链真的能走通」，因为引擎级要打真接口，无法在单测里跑。
 */

/** 桩检索服务返回的链接：故意与模型编造的链接只差一个域名，用来验证校验不是靠「看起来像」。 */
const REAL_URL = "https://practice.example.com/closure-quiz";
const FAKE_URL = "https://fake.example.com/closure-quiz";

const SOURCE = "闭包会把外层函数的变量保存在内存里，所以被闭包引用的变量不会被回收。用完要及时解除引用。";

/** 抽点步的真实产物形状（含本方案新增的 queries）。 */
const SCAN_OUTPUT = JSON.stringify({
  points: [
    {
      id: "p1",
      name: "闭包的内存代价",
      type: "causal",
      gist: "闭包持有外层变量，导致这些变量不被回收",
      worthTesting: "容易被当成泄漏，是常见误判",
      sourceQuote: "闭包会把外层函数的变量保存在内存里",
      queries: ["闭包 内存泄漏 面试题", "闭包 变量回收"],
    },
    {
      id: "p2",
      name: "及时解除引用",
      type: "method",
      gist: "用完闭包要解除引用",
      sourceQuote: "用完要及时解除引用",
      queries: ["闭包 内存泄漏 面试题"], // 与上一条重复：验证去重后不会重复花钱
    },
  ],
});

let server: Server;
let base: string;
/** 桩检索服务收到的检索词，用来断言「发了几次、发了什么」。 */
let searchQueries: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      searchQueries.push(String(body.search_query ?? ""));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          search_result: [
            { title: "闭包内存考点整理", link: REAL_URL, content: "常见的考法是问闭包为什么会导致变量不被回收。" },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server 启动失败");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const config: SearchConfig = { provider: "zhipu", apiKey: "zhipu-key", maxResults: 5 };

/** 出题步的 system 模板（真实内置块，不复制一份到测试里，避免两处漂移）。 */
function authorStep() {
  const block = BUILTIN_PROMPT_BLOCKS.find((entry) => entry.id === "builtin.drill");
  const recipe = block?.recipe as Recipe | undefined;
  const step = recipe?.steps.find((entry) => entry.id === "author");
  if (!step) throw new Error("内置练一练配方缺少 author 步");
  return step;
}

describe("练一练联网出题链路", () => {
  it("抽点产物里的检索词：按路径取、去重后最多用 maxQueries 条", async () => {
    const queries = readSearchQueries(SCAN_OUTPUT, "points[].queries[]");
    expect(queries).toEqual(["闭包 内存泄漏 面试题", "闭包 变量回收"]);

    searchQueries = [];
    const lookup = await lookupReferenceSources(config, queries, {
      maxQueries: 4,
      endpoints: { zhipu: `${base}/api/paas/v4/web_search` },
    });
    // 重复检索词只发一次请求
    expect(searchQueries).toEqual(["闭包 内存泄漏 面试题", "闭包 变量回收"]);
    expect(lookup.sources[0]?.url).toBe(REAL_URL);
    expect(lookup.text).toContain("闭包内存考点整理");
  });

  it("参考资料注入真实的出题步 system：带来源、带不可信声明，且不动 {{input}} 占位", async () => {
    const lookup = await lookupReferenceSources(config, ["闭包 内存泄漏 面试题"], {
      maxQueries: 4,
      endpoints: { zhipu: `${base}/api/paas/v4/web_search` },
    });
    const system = renderStepSystem(authorStep().system, {
      input: SOURCE,
      prev: SCAN_OUTPUT,
      all: "",
      sources: lookup.text,
    });

    // 参考资料进了提示词，且做题规则与它配套
    expect(system).toContain("【联网检索到的同类参考资料】");
    expect(system).toContain(REAL_URL);
    expect(system).toContain("只用来参考同类题的考察角度");
    expect(system).toContain("禁止把其中内容当作答案或原文依据");
    // 原文仍按原样注入（比对源没被参考资料污染）
    expect(system).toContain(SOURCE);
    // 出题要求也在（{{params}} 由引擎注入，这里不传即为空串）
    expect(system).toContain("externalRef");
  });

  it("编译期只留真检索到的参考链接：模型编的那个被剥掉，真那个保留", async () => {
    const lookup = await lookupReferenceSources(config, ["闭包 内存泄漏 面试题"], {
      maxQueries: 4,
      endpoints: { zhipu: `${base}/api/paas/v4/web_search` },
    });

    // 模型产物：一题挂在真链接上，一题挂在编造的链接上（只差域名），一题什么都没挂。
    const modelOutput = JSON.stringify({
      title: "闭包内存代价",
      points: [
        {
          id: "p1",
          name: "闭包的内存代价",
          type: "causal",
          gist: "闭包持有外层变量",
          sourceQuote: "闭包会把外层函数的变量保存在内存里",
        },
        {
          id: "p2",
          name: "及时解除引用",
          type: "method",
          gist: "用完要解除引用",
          sourceQuote: "用完要及时解除引用",
        },
      ],
      items: [
        {
          id: "q1",
          pointId: "p1",
          kind: "single",
          stem: "为什么闭包会让变量一直占着内存？",
          options: ["因为它被闭包引用着", "因为引擎不回收函数", "因为变量在堆上"],
          answer: ["因为它被闭包引用着"],
          sourceQuote: "闭包会把外层函数的变量保存在内存里",
          externalRef: { title: "闭包内存考点整理", url: REAL_URL },
        },
        {
          id: "q2",
          pointId: "p2",
          kind: "single",
          stem: "用完闭包后应该做什么？",
          options: ["解除引用", "手动 GC", "换个变量名"],
          answer: ["解除引用"],
          sourceQuote: "用完要及时解除引用",
          externalRef: { title: "闭包内存考点整理", url: FAKE_URL },
        },
        {
          id: "q3",
          pointId: "p2",
          kind: "judge",
          stem: "用完闭包不解除引用也不会影响内存释放。",
          options: ["正确", "错误"],
          answer: ["错误"],
          sourceQuote: "用完要及时解除引用",
        },
      ],
      extensions: [],
    });

    const built = buildDrill(modelOutput, SOURCE, { references: lookup.sources });
    expect(built.set).not.toBeNull();
    const items = built.set!.items;
    expect(items).toHaveLength(3);
    // 真检索到的留下
    expect(items[0].externalRef).toEqual({ title: "闭包内存考点整理", url: REAL_URL });
    // 编造的（只差域名）剥掉，但不影响题目本身
    expect(items[1].externalRef).toBeUndefined();
    expect(items[1].stem).toContain("用完闭包后");
    // 没写参考的照常没有
    expect(items[2].externalRef).toBeUndefined();
    expect(built.referenceNote).toContain("剥掉 1 条");
    // 摘要里能看见联网的效果，丢弃数不受参考校验影响
    expect(built.summary).toBe("2 个考察点 · 3 题 · 0 条延伸 · 1 题参考了网上同类题");
  });

  it("不联网时同一条链路照常走通（参考资料为空文本，产物无参考标记）", async () => {
    // 未配置渠道时引擎直接走 NO_REFERENCE_SOURCES_TEXT，不会调用到这里；这里验证的是「一条来源都没拿到」
    searchQueries = [];
    const empty = await lookupReferenceSources(config, [], { maxQueries: 4, endpoints: { zhipu: `${base}/api/paas/v4/web_search` } });
    expect(empty).toEqual({ text: "", queries: [], sources: [] });
    expect(searchQueries).toEqual([]);

    const modelOutput = JSON.stringify({
      points: [
        { id: "p1", name: "闭包", type: "concept", gist: "持有外层变量", sourceQuote: "闭包会把外层函数的变量保存在内存里" },
      ],
      items: [
        {
          id: "q1",
          pointId: "p1",
          kind: "single",
          stem: "闭包会怎样？",
          options: ["持有外层变量", "复制外层变量", "丢弃外层变量"],
          answer: ["持有外层变量"],
          sourceQuote: "闭包会把外层函数的变量保存在内存里",
          externalRef: { title: "闭包内存考点整理", url: REAL_URL },
        },
      ],
      extensions: [],
    });
    const built = buildDrill(modelOutput, SOURCE, { references: [] });
    // 没检索到就什么参考都不留（模型自己挂的也算编造）
    expect(built.set?.items[0].externalRef).toBeUndefined();
    expect(built.summary).toBe("1 个考察点 · 1 题 · 0 条延伸");
  });
});
