import { describe, expect, it } from "vitest";
import type { VideoPreview } from "@scribe-flow/shared";
import { cachePreview, readCachedPreview } from "./bili-preview-cache";

/**
 * 这几条守的是「拖出视野再拖回」这一条路径的前提：重新挂载时缓存必须给回**同一份**结果。
 * 缓存给歪了不会有任何报错，只会在画布上表现为卡片退回「正在解析」或显示错视频——
 * 所以把键、TTL、条数上限都钉在这里。
 */

const T0 = 1_700_000_000_000;
const TTL = 5 * 60 * 1000;
const MAX = 30;

function preview(bvid: string): VideoPreview {
  return {
    bvid,
    aid: 1,
    cid: 2,
    title: `标题 ${bvid}`,
    description: "",
    duration: 100,
    cover: "https://example.com/cover.jpg",
    uploader: "UP",
    uploaderUid: 3,
    pubdate: 4,
    pages: [{ page: 1, cid: 2, part: "P1", duration: 100 }],
  };
}

describe("bili 预览缓存", () => {
  it("写入后能按原样链接读回同一份对象", () => {
    const url = "https://www.bilibili.com/video/BV1aa411c7mD";
    const data = preview("BV1aa411c7mD");
    cachePreview(url, data, T0);
    expect(readCachedPreview(url, T0 + 1000)).toBe(data);
  });

  it("键会去掉首尾空白（用户粘贴常带空格/换行）", () => {
    const data = preview("BV1bb411c7mD");
    cachePreview("  https://www.bilibili.com/video/BV1bb411c7mD\n", data, T0);
    expect(readCachedPreview("https://www.bilibili.com/video/BV1bb411c7mD", T0)).toBe(data);
  });

  it("空链接既不读也不写", () => {
    expect(readCachedPreview("   ", T0)).toBeNull();
    cachePreview("   ", preview("BV1cc411c7mD"), T0);
    expect(readCachedPreview("", T0)).toBeNull();
  });

  it("超过 5 分钟视为过期（时间上限与后端预览缓存一致）", () => {
    const url = "https://www.bilibili.com/video/BV1dd411c7mD";
    cachePreview(url, preview("BV1dd411c7mD"), T0);
    expect(readCachedPreview(url, T0 + TTL)).not.toBeNull();
    expect(readCachedPreview(url, T0 + TTL + 1)).toBeNull();
  });

  it("过期后再读不会复活，重新解析会覆盖成新的", () => {
    const url = "https://www.bilibili.com/video/BV1ee411c7mD";
    const first = preview("BV1ee411c7mD");
    const second = { ...first, title: "改过的标题" };
    cachePreview(url, first, T0);
    expect(readCachedPreview(url, T0 + TTL + 1)).toBeNull();
    cachePreview(url, second, T0 + TTL + 2);
    expect(readCachedPreview(url, T0 + TTL + 3)).toBe(second);
  });

  it("条数上限 30：写爆之后最早的被淘汰，刚写入的一定还在", () => {
    // 多用例共享同一个模块级缓存，所以这里一次写满上限之上（40 条），
    // 不依赖前面用例留下了几条——靠前的必然被淘汰。
    const first = "https://www.bilibili.com/video/BVbulk000000";
    for (let i = 0; i < 40; i += 1) {
      const url = i === 0 ? first : `https://www.bilibili.com/video/BVbulk${String(i).padStart(6, "0")}`;
      cachePreview(url, preview(`BVbulk${i}`), T0 + i + 1);
    }
    expect(readCachedPreview(first, T0 + 100)).toBeNull();
    expect(readCachedPreview("https://www.bilibili.com/video/BVbulk000039", T0 + 100)).not.toBeNull();
  });

  it("同一个链接重复写入只占一条，且算最新（不会被自己的旧时间戳淘汰）", () => {
    const url = "https://www.bilibili.com/video/BV1ff411c7mD";
    const data = preview("BV1ff411c7mD");
    for (let i = 0; i < MAX + 5; i += 1) {
      cachePreview(url, data, T0 + i);
      cachePreview(`https://www.bilibili.com/video/BVother${i}`, preview(`BVother${i}`), T0 + i);
    }
    expect(readCachedPreview(url, T0 + MAX + 4)).toBe(data);
  });
});
