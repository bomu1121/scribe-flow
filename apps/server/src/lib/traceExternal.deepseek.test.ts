import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SearchConfig } from "./settings";
import { deepseekSearch, lookupReferenceSources } from "./traceExternal";

/**
 * DeepSeek Search API 的适配层验收：请求形状、字段映射、超长截断，以及 429 重试。
 *
 * 与 `drill-web-search.test.ts` 一样打本地桩服务，不 mock 我们自己的代码——
 * 要验的是「真实请求体发出去之后，响应能不能被翻译成统一的 TraceExternalSource」。
 */

let server: Server;
let base: string;
let requests: { auth: string; body: Record<string, unknown> }[] = [];
let responses: { status: number; body: unknown }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({
        auth: String(req.headers.authorization ?? ""),
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      const next = responses.shift() ?? { status: 200, body: { results: [] } };
      res.statusCode = next.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(next.body));
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

beforeEach(() => {
  requests = [];
  responses = [];
});

const config: SearchConfig = { provider: "deepseek", apiKey: "ds-key", maxResults: 5 };
const endpoint = () => `${base}/v1/tools/search`;

describe("DeepSeek 检索适配", () => {
  it("按 DeepSeek 的请求形状发请求，并把 results 映射成统一来源", async () => {
    responses = [
      {
        status: 200,
        body: {
          results: [
            {
              title: "闭包内存考点整理",
              url: "https://example.com/closure",
              summary: "面向模型的长摘要，通常比 snippet 长很多。",
              snippet: "给界面看的短摘要",
              site_name: "示例站点",
            },
            {
              title: "只有短摘要",
              url: "https://example.com/short",
              summary: "",
              snippet: "短摘要兜底",
              site_name: null,
            },
          ],
        },
      },
    ];

    const sources = await deepseekSearch(config, "闭包 内存泄漏", endpoint());

    expect(requests).toHaveLength(1);
    expect(requests[0]?.auth).toBe("Bearer ds-key");
    expect(requests[0]?.body).toMatchObject({ query: "闭包 内存泄漏", count: 20 });
    expect(sources[0]).toMatchObject({
      title: "闭包内存考点整理",
      url: "https://example.com/closure",
      snippet: "面向模型的长摘要，通常比 snippet 长很多。",
      publisher: "示例站点",
    });
    // summary 为空时回落到 snippet，而不是把空串当摘要。
    expect(sources[1]?.snippet).toBe("短摘要兜底");
  });

  it("query 超过 128 字符时按文档上限截断", async () => {
    responses = [{ status: 200, body: { results: [] } }];
    await deepseekSearch(config, "闭".repeat(200), endpoint());
    expect(String(requests[0]?.body.query).length).toBe(128);
  });

  it("429 会重试一次，而不是按普通 4xx 直接放弃", async () => {
    responses = [
      { status: 429, body: { error: { message: "rate limited" } } },
      {
        status: 200,
        body: { results: [{ title: "重试后拿到", url: "https://example.com/retry", summary: "摘要" }] },
      },
    ];

    const lookup = await lookupReferenceSources(config, ["闭包 内存泄漏"], {
      endpoints: { deepseek: endpoint() },
    });

    expect(requests).toHaveLength(2);
    expect(lookup.sources).toHaveLength(1);
    expect(lookup.sources[0]?.url).toBe("https://example.com/retry");
  }, 5_000);
});
