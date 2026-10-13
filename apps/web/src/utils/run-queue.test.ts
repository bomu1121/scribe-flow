import { describe, expect, it } from "vitest";
import { dropQueueItem, pushQueueItem, queuedToast, queueTitle, runQueueKey, runQueueLabel, type RunQueueItem } from "./run-queue";

function item(scope: RunQueueItem["scope"], nodeId: string | undefined, label: string): RunQueueItem {
  return { key: runQueueKey(scope, nodeId), scope, nodeId, label };
}

describe("runQueueKey", () => {
  it("按范围+节点去重：同一个节点跑两次算一条，不同节点各算一条", () => {
    expect(runQueueKey("node", "n1")).toBe("node:n1");
    expect(runQueueKey("fromNode", "n1")).toBe("fromNode:n1");
    expect(runQueueKey("all")).toBe("all:");
    expect(runQueueKey("node", "n1")).not.toBe(runQueueKey("fromNode", "n1"));
  });
});

describe("pushQueueItem", () => {
  it("追加到队尾，保持先来先跑的顺序", () => {
    const first = pushQueueItem([], item("node", "n1", "「加工 A」"));
    expect(first).not.toBeNull();
    const second = pushQueueItem(first!, item("node", "n2", "「加工 B」"));
    expect(second?.map((i) => i.label)).toEqual(["「加工 A」", "「加工 B」"]);
  });

  it("重复项不排第二条：连点两下同一个节点只跑一次", () => {
    const first = pushQueueItem([], item("node", "n1", "「加工 A」"))!;
    expect(pushQueueItem(first, item("node", "n1", "「加工 A」"))).toBeNull();
  });

  it("「从此节点运行」与「运行此节点」是两条：范围不同、跑的东西不同", () => {
    const first = pushQueueItem([], item("node", "n1", "「加工 A」"))!;
    expect(pushQueueItem(first, item("fromNode", "n1", "从「加工 A」开始"))).not.toBeNull();
  });

  it("不改原数组：入队失败时调用方手里的队列保持原样", () => {
    const original = [item("node", "n1", "「加工 A」")];
    pushQueueItem(original, item("node", "n2", "「加工 B」"));
    expect(original).toHaveLength(1);
  });
});

describe("dropQueueItem", () => {
  it("按 key 出队，其余顺序不变", () => {
    const queue = [item("node", "n1", "「A」"), item("node", "n2", "「B」"), item("all", undefined, "整个工程")];
    expect(dropQueueItem(queue, "node:n2").map((i) => i.key)).toEqual(["node:n1", "all:"]);
  });

  it("key 不在队列里时原样返回", () => {
    const queue = [item("node", "n1", "「A」")];
    expect(dropQueueItem(queue, "node:n9")).toHaveLength(1);
  });
});

describe("queuedToast", () => {
  it("第一个说清「结束后自动开始」，后面的说清前面还有几条", () => {
    expect(queuedToast(1)).toBe("已加入排队，当前运行结束后自动开始");
    expect(queuedToast(3)).toBe("已加入排队（第 3 个），前面跑完依次开始");
  });
});

describe("runQueueLabel", () => {
  it("三种范围各自说清跑的是什么", () => {
    expect(runQueueLabel("all", "视频转笔记")).toBe("整个工程");
    expect(runQueueLabel("fromNode", "AI 校对")).toBe("从「AI 校对」开始");
    expect(runQueueLabel("node", "AI 加工")).toBe("「AI 加工」");
  });
});

describe("queueTitle", () => {
  it("列出排的是哪些、什么时候开始、怎么取消", () => {
    const title = queueTitle([item("node", "n1", "「加工 A」"), item("node", "n2", "「加工 B」")]);
    expect(title).toBe("已排队 2 个：「加工 A」、「加工 B」（当前运行结束后依次开始，点击清空）");
  });

  it("空队列没有提示可显示", () => {
    expect(queueTitle([])).toBe("");
  });
});
