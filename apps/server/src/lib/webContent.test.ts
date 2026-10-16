import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collapseWhitespace, createPageCache, extractReadable, fetchReadablePage, normalizeForMatch, pickExcerpt, selectorFor, verifyQuote } from "./webContent";

/**
 * 抓正文时绝不真连网：三方兜底一律关掉，直连只打本文件的桩服务。
 * 桩服务只能监听回环地址，所以要显式放行私网目标——这条开关只有测试用。
 */
const NO_FALLBACK = { fallbackHosts: [] as string[], allowPrivateNetwork: true };

describe("逐字比对用的归一化", () => {
  it("忽略空白与零宽字符——网页正文里的换行不该让同一句话对不上", () => {
    expect(normalizeForMatch("第一段\n  第二段")).toBe(normalizeForMatch("第一段第二段"));
    expect(normalizeForMatch("第一段\u200b第二段")).toBe(normalizeForMatch("第一段第二段"));
  });

  it("NFKC 归一全角/半角与括号，避免把排版差异当成引文错", () => {
    expect(normalizeForMatch("（2024）")).toBe(normalizeForMatch("(2024)"));
    expect(normalizeForMatch("ＡＢＣ")).toBe(normalizeForMatch("abc"));
  });

  it("collapseWhitespace 把连续空白压成一个空格并去掉首尾", () => {
    expect(collapseWhitespace("  甲  乙 \n\n 丙 ")).toBe("甲 乙 丙");
  });
});

describe("引文逐字校验（不捏造的机械门）", () => {
  const content = "美国社保税率合计为百分之十二点四，雇员与雇主各缴一半。自雇者全额自付。";

  it("逐字命中的引文通过", () => {
    expect(verifyQuote("雇员与雇主各缴一半", content)).toBe("雇员与雇主各缴一半");
  });

  it("正文里没有的引文不通过", () => {
    expect(verifyQuote("美国社保税率合计为百分之二十", content)).toBeNull();
  });

  it("太短的引文不通过（太容易碰巧命中，等于没有约束）", () => {
    expect(verifyQuote("社保", content)).toBeNull();
  });

  it("空引文不通过", () => {
    expect(verifyQuote("   ", content)).toBeNull();
  });

  it("省略号分段的引文：每段都命中才算通过，并规范成 ` … ` 连接", () => {
    const long = "开头这一段讲了背景与动机。中间是一大段可以省掉的细节。结尾这一段给出了结论与数据。";
    expect(verifyQuote("开头这一段讲了背景与动机。…结尾这一段给出了结论与数据。", long)).toBe(
      "开头这一段讲了背景与动机。 … 结尾这一段给出了结论与数据。",
    );
    // 其中一段是编的，整条作废
    expect(verifyQuote("开头这一段讲了背景与动机。…结尾这一段给出了完全不同的结论。", long)).toBeNull();
  });

  it("跨换行的引文照样命中（正文里的换行不影响校验）", () => {
    expect(verifyQuote("雇员与雇主各缴一半。自雇者全额自付。", "美国社保税率合计为百分之十二点四，\n\n雇员与雇主各缴一半。\n自雇者全额自付。")).toBe(
      "雇员与雇主各缴一半。自雇者全额自付。",
    );
  });
});

describe("正文摘录窗口", () => {
  const long = [
    "导航栏 首页 关于我们 联系方式 版权声明",
    "本文讨论的主题与劳动经济学有关，下面进入正文。",
    "社保税率的官方口径是雇员与雇主各缴百分之六点二，合计百分之十二点四。",
    "广告位招租 相关推荐 猜你喜欢",
  ].join("\n");

  it("以命中段落为中心取窗口，而不是把正文开头整段搬过去", () => {
    const excerpt = pickExcerpt(long, ["社保税率 官方口径"], 90);
    // 命中的那段必须在窗口里
    expect(excerpt).toContain("社保税率");
    // 且窗口不是「正文开头的前 90 字」——否则长文里的关键数据永远进不了模型视野
    expect(excerpt).not.toBe(long.slice(0, 90));
    expect(excerpt.length).toBeLessThanOrEqual(90);
  });

  it("正文短于预算时原样返回", () => {
    expect(pickExcerpt("很短的一段", ["任意"], 100)).toBe("很短的一段");
  });

  it("没有关键词命中时也返回一段（不是空）", () => {
    const excerpt = pickExcerpt(long, ["完全不相关的词"], 60);
    expect(excerpt.length).toBeGreaterThan(0);
    expect(excerpt.length).toBeLessThanOrEqual(60);
  });
});

describe("站点选择器表", () => {
  it("微信公众号命中 #js_content（实测通用算法只出 25-45 字，选择器出 700+ 字）", () => {
    expect(selectorFor("https://mp.weixin.qq.com/s/abc")?.selector).toBe("#js_content");
  });

  it("知乎、B 站各自命中", () => {
    expect(selectorFor("https://www.zhihu.com/question/1")?.selector).toContain("RichContent");
    expect(selectorFor("https://www.bilibili.com/video/BV1xx411c7mD")?.selector).toContain("desc-info-text");
  });

  it("没有专用选择器的站点返回 null（走通用算法）", () => {
    expect(selectorFor("https://www.nobelprize.org/prizes/physics/1921/summary/")).toBeNull();
    expect(selectorFor("不是链接")).toBeNull();
  });
});

const ARTICLE = `<html><head><title>测试文章标题</title></head><body>
    <nav>首页 导航 无关内容</nav>
    <article><h1>测试文章标题</h1>
      <p>第一段：本文要说明的是社保税率的计算口径，以及它为什么容易被误读。理解这个口径，需要先把强制与自愿的分界讲清楚，否则后面所有对比都会失去参照。</p>
      <p>第二段：美国社保税率合计为百分之十二点四，雇员与雇主各缴一半，自雇者全额自付。这条数字来自官方说明，任何二手转述都应当回到原始文本核对。</p>
      <p>第三段：这些数字来自官方说明，引用时应当写明出处与年份，避免断章取义。引用外文材料时，还应当保留原文用词，不要让翻译掩盖了口径差异。</p>
    </article>
  <footer>版权所有</footer></body></html>`;

const WECHAT = `<html><head><title>公众号文章</title></head><body>
    <div class="rich_media_area_primary"><div id="js_content">
      <p>公众号正文第一段：这里是被通用算法丢掉的正文，只在 #js_content 容器里。实测三个样本，通用算法分别只抽出 25、40、45 个字，换成选择器之后拿到的是 717、1037、781 个字。</p>
      <p>公众号正文第二段：微信页面的 HTML 体积约 3.5 MB，而正文不足 1 KB，剩下的体量都是图片与内联样式，所以按 token 预算截断是必需品而不是优化项。</p>
  </div></div></body></html>`;

describe("抓取一页正文", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/article")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(ARTICLE);
        return;
      }
      if (req.url?.startsWith("/wechat")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(WECHAT);
        return;
      }
      if (req.url?.startsWith("/missing")) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      if (req.url?.startsWith("/slow")) {
        // 慢站点：5 秒后才回，用来验证单请求超时确实生效
        setTimeout(() => {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(ARTICLE);
        }, 5000);
        return;
      }
      if (req.url?.startsWith("/image")) {
        res.setHeader("Content-Type", "image/png");
        res.end("binary");
        return;
      }
      res.statusCode = 404;
      res.end("nope");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("桩服务启动失败");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("普通文章走通用算法，抽出正文并拿到标题", async () => {
    const page = await fetchReadablePage(`${base}/article`, undefined, NO_FALLBACK);
    // 断言带上原因：偶发失败（实测出现过一次、未能复现）时，报错里得有它为什么失败
    expect(page.ok, page.error ?? "").toBe(true);
    expect(page.via).toBe("readability");
    expect(page.text).toContain("美国社保税率合计为百分之十二点四");
    expect(page.title).toContain("测试文章标题");
  });

  it("命中站点选择器的页面优先用选择器（微信正文只在 #js_content 里，通用算法会丢掉）", async () => {
    const extracted = await extractReadable(WECHAT, "https://mp.weixin.qq.com/s/abc");
    expect(extracted?.via).toBe("selector");
    expect(extracted?.text).toContain("这里是被通用算法丢掉的正文");
  });

  it("没有选择器的站点落到通用算法，且不把导航/页脚算进正文", async () => {
    const extracted = await extractReadable(ARTICLE, "https://www.nobelprize.org/prizes/physics/1921/summary/");
    expect(extracted?.via).toBe("readability");
    expect(extracted?.text).toContain("美国社保税率合计为百分之十二点四");
    expect(extracted?.text).not.toContain("首页 导航 无关内容");
  });

  it("页面里没有可读正文时返回 null（不拿导航文字充当正文）", async () => {
    expect(await extractReadable("<html><body><nav>首页</nav></body></html>", "https://example.com/x")).toBeNull();
  });

  it("HTTP 404 时 ok:false，并写明状态码", async () => {
    const page = await fetchReadablePage(`${base}/missing`, undefined, NO_FALLBACK);
    expect(page.ok, page.title ?? "").toBe(false);
    expect(page.error).toContain("404");
  });

  it("非网页内容不当作正文（图片/二进制直接判失败）", async () => {
    const page = await fetchReadablePage(`${base}/image`, undefined, NO_FALLBACK);
    expect(page.ok, page.title ?? "").toBe(false);
    expect(page.error).toContain("非网页内容");
  });

  it("私网与回环地址一律拦截（检索结果是第三方数据，不能让服务端代取内网目标）", async () => {
    // 这里刻意用**关闭**放行的默认配置来断言拦截生效
    for (const target of ["http://127.0.0.1:9/secret", "http://10.0.0.5/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "file:///etc/passwd"]) {
      const page = await fetchReadablePage(target, undefined, { fallbackHosts: [] });
      expect(page.ok).toBe(false);
      expect(page.error).toMatch(/私网\/回环地址|非法链接/);
    }
  });

  it("连不上时把原因写清楚，而不是抛异常给调用方", async () => {
    const page = await fetchReadablePage("http://127.0.0.1:1/nothing", undefined, {
      fallbackHosts: ["http://127.0.0.1:1"],
      allowPrivateNetwork: true,
    });
    expect(page.ok).toBe(false);
    expect(page.error).toBeTruthy();
  });

  it("慢站点按单请求超时失败——**调用方传了 signal 也不能把超时关掉**", async () => {
    // 这条守的是一个真实缺陷：写成 `signal ?? AbortSignal.timeout(ms)` 时，
    // 引擎传进来的运行级 signal 会让单页超时整个失效，慢站点把抓取拖到运行结束。
    const controller = new AbortController();
    const t0 = Date.now();
    const page = await fetchReadablePage(`${base}/slow`, controller.signal, {
      ...NO_FALLBACK,
      timeoutMs: 300,
    });
    const elapsed = Date.now() - t0;
    expect(page.ok, page.title ?? "").toBe(false);
    expect(page.error).toMatch(/timeout/i);
    expect(elapsed).toBeLessThan(3000);
    // signal 本身没被触发，说明失败确实来自超时而不是外部取消
    expect(controller.signal.aborted).toBe(false);
  });

  it("调用方取消时立刻退出（超时与取消两个都要生效）", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const t0 = Date.now();
    const page = await fetchReadablePage(`${base}/slow`, controller.signal, NO_FALLBACK);
    expect(page.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("一轮抓取内的正文缓存", () => {
  it("同一 URL 只抓一次，has 能区分新页面（抓取预算按新页面算）", async () => {
    let calls = 0;
    const cache = createPageCache(async (url) => {
      calls += 1;
      return { url, ok: true, text: "正文".repeat(100), via: "readability" as const };
    });
    expect(cache.has("https://example.com/a")).toBe(false);
    await cache.get("https://example.com/a");
    await cache.get("https://example.com/a");
    expect(calls).toBe(1);
    expect(cache.has("https://example.com/a")).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it("抓取抛错时转成 ok:false 的结果，不让整轮核查炸掉", async () => {
    const cache = createPageCache(async () => {
      throw new Error("连接被重置");
    });
    const page = await cache.get("https://example.com/b");
    expect(page.ok).toBe(false);
    expect(page.error).toContain("连接被重置");
  });
});
