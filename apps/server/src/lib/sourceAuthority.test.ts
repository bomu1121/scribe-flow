import { describe, expect, it } from "vitest";
import { authorityOf, normalizeSourceUrl, rankSources } from "./sourceAuthority";

describe("来源权威度判定", () => {
  it("命名分档（gov/edu/ac）判为权威，但 .cn 本身不代表权威", () => {
    expect(authorityOf("https://www.gov.cn/zhengce/content/1.htm")).toBe("authoritative");
    expect(authorityOf("https://www.tsinghua.edu.cn/info/1")).toBe("authoritative");
    expect(authorityOf("https://www.cas.cn/x")).toBe("authoritative"); // 中科院在主机清单里
    expect(authorityOf("https://www.example.cn/x")).toBe("unknown"); // 只有 .cn 后缀不下结论
  });

  it("学术出版、国际组织与官方媒体判为权威", () => {
    expect(authorityOf("https://www.nobelprize.org/prizes/physics/1921/summary/")).toBe("authoritative");
    expect(authorityOf("https://arxiv.org/abs/1706.03762")).toBe("authoritative");
    expect(authorityOf("https://www.nature.com/articles/1")).toBe("authoritative");
    expect(authorityOf("https://www.who.int/news/item/1")).toBe("authoritative");
  });

  it("百科、标准与官方文档判为参考", () => {
    expect(authorityOf("https://zh.wikipedia.org/wiki/Transformer")).toBe("reference");
    expect(authorityOf("https://developer.mozilla.org/zh-CN/docs/Web")).toBe("reference");
    expect(authorityOf("https://github.com/x/y")).toBe("reference");
  });

  it("自媒体、问答、文库与聚合站判为自媒体（含子域命中）", () => {
    expect(authorityOf("https://blog.csdn.net/x/article/details/1")).toBe("self-media");
    expect(authorityOf("https://wenku.csdn.net/doc/abc")).toBe("self-media");
    expect(authorityOf("https://zhuanlan.zhihu.com/p/1")).toBe("self-media");
    expect(authorityOf("https://www.sohu.com/a/1_2")).toBe("self-media");
    expect(authorityOf("https://cloud.tencent.com/developer/article/1")).toBe("self-media");
  });

  it("判不出来的给 unknown，不假装权威；非法链接同样是 unknown", () => {
    expect(authorityOf("https://some-random-blog.xyz/post")).toBe("unknown");
    expect(authorityOf("")).toBe("unknown");
    expect(authorityOf(undefined)).toBe("unknown");
    expect(authorityOf("这不是链接")).toBe("unknown");
    expect(authorityOf("ftp://example.com/x")).toBe("unknown");
  });

  it("域名缺失时按站点名兜底，两边都判不出来才是 unknown", () => {
    expect(authorityOf(undefined, "新华网")).toBe("authoritative");
    expect(authorityOf(undefined, "百度百科")).toBe("reference");
    expect(authorityOf(undefined, "知乎")).toBe("self-media");
    expect(authorityOf(undefined, "某个没听过的站")).toBe("unknown");
    expect(authorityOf(undefined, "")).toBe("unknown");
  });
});

describe("候选来源重排", () => {
  it("无链接的结果保留（判为未判定档），只有连标题都没有的才丢", () => {
    // 检索接口对相当一部分查询只返回标题+正文。全丢掉会清空候选池，
    // 把「拿不到链接」误报成「找不到出处」——那是本文件最容易犯的错。
    const { selected, counts } = rankSources(
      [
        { title: "无链接", url: "" },
        { title: "非法链接", url: "not-a-url" },
        { title: "", url: "" },
        { title: "有链接", url: "https://example.com/a" },
      ],
      10,
    );
    expect(selected.map((source) => source.title)).toEqual(["无链接", "非法链接", "有链接"]);
    expect(selected.every((source) => source.authority === "unknown")).toBe(true);
    expect(counts.unknown).toBe(3);
  });

  it("没有域名但有站点名时按站点名兜底判档", () => {
    const { selected } = rankSources(
      [
        { title: "a", url: "", publisher: "人民网" },
        { title: "b", url: "", publisher: "CSDN博客" },
        { title: "c", url: "", publisher: "维基百科" },
      ],
      5,
    );
    expect(selected.map((source) => source.authority)).toEqual(["authoritative", "reference", "self-media"]);
  });

  it("按权威度重排：权威来源即使排在输入后面也优先", () => {
    const { selected } = rankSources(
      [
        { title: "自媒体", url: "https://blog.csdn.net/a" },
        { title: "未知站", url: "https://random-blog.xyz/a" },
        { title: "权威", url: "https://www.nobelprize.org/a" },
        { title: "参考", url: "https://zh.wikipedia.org/a" },
      ],
      5,
    );
    expect(selected.map((source) => source.title)).toEqual(["权威", "参考", "自媒体", "未知站"]);
    expect(selected.map((source) => source.authority)).toEqual(["authoritative", "reference", "self-media", "unknown"]);
  });

  it("同主机最多两条，避免单一站点挤掉其它来源", () => {
    const { selected } = rankSources(
      [
        { title: "c1", url: "https://example.com/1" },
        { title: "c2", url: "https://example.com/2" },
        { title: "c3", url: "https://example.com/3" },
        { title: "other", url: "https://other.com/1" },
      ],
      5,
    );
    expect(selected.filter((source) => source.url?.includes("example.com"))).toHaveLength(2);
    expect(selected).toHaveLength(3);
  });

  it("按归一化链接去重（忽略 www、末尾斜杠与锚点）", () => {
    const { selected } = rankSources(
      [
        { title: "a1", url: "https://example.com/a" },
        { title: "a2", url: "https://www.example.com/a/" },
        { title: "a3", url: "https://example.com/a#section" },
      ],
      5,
    );
    expect(selected).toHaveLength(1);
  });

  it("数量上限与档位统计针对整池而非选出的几条", () => {
    const { selected, counts } = rankSources(
      [
        { title: "权威1", url: "https://www.nobelprize.org/1" },
        { title: "权威2", url: "https://arxiv.org/2" },
        { title: "自媒体", url: "https://blog.csdn.net/3" },
      ],
      1,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.authority).toBe("authoritative");
    expect(counts).toEqual({ authoritative: 2, "self-media": 1 });
  });
});

describe("链接归一化", () => {
  it("忽略协议、www、末尾斜杠与锚点", () => {
    expect(normalizeSourceUrl("https://www.Example.com/a/#x")).toBe("example.com/a");
    expect(normalizeSourceUrl("http://example.com/a")).toBe("example.com/a");
  });
});
