import { describe, expect, it } from "vitest";
import type { RunMeta } from "@scribe-flow/shared";
import { RUN_STATUS_META, formatRunTime, resolveRenameRequest, runDisplayName, runRowTooltip } from "./run-meta";

function run(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "run_3b007bff-aa65-435c-ad82-c9f4fb1791f9",
    projectId: "p1",
    status: "success",
    scope: "all",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("运行状态文案", () => {
  it("已中断与已取消是两个不同的状态，不能共用一个词", () => {
    // 这条断言是这个改动存在的理由：中断是服务没了，取消是人点的停止，
    // 混在一起就会出现「我明明没取消，它却写着已取消」。
    expect(RUN_STATUS_META.interrupted.label).toBe("已中断");
    expect(RUN_STATUS_META.cancelled.label).toBe("已取消");
    expect(RUN_STATUS_META.interrupted.color).not.toBe(RUN_STATUS_META.cancelled.color);
  });
});

describe("runDisplayName", () => {
  it("没起过名就是空串——不拿「文件名 · 字数」占位（同工程跑十次那串字一模一样）", () => {
    expect(runDisplayName(run({ summary: "视频转笔记(单线).md · 6753 字" }))).toBe("");
  });

  it("左侧栏的行标题绝不回落到状态词：任何状态都返回空串", () => {
    // 这条钉的是一个被否掉过的实现：行标题曾经回落到 RUN_STATUS_META 的文案，
    // 于是列表变成一列「成功 / 成功 / 已中断」——成功每行重复等于没说，
    // 而「已中断」会把一条其实产出了 2 份提炼结果的运行说成空手而归。
    for (const status of ["running", "success", "error", "cancelled", "interrupted"] as const) {
      expect(runDisplayName(run({ status }))).toBe("");
    }
  });

  it("只有用户写的名字算标题，首尾空白不算内容", () => {
    expect(runDisplayName(run({ name: "  第 12 期 · 记忆系统  " }))).toBe("第 12 期 · 记忆系统");
    expect(runDisplayName(run({ name: "   " }))).toBe("");
  });
});

describe("runRowTooltip", () => {
  it("列表省掉的产物摘要收进提示里，历史仍然查得到", () => {
    const text = runRowTooltip(run({ summary: "视频转笔记(单线).md · 6753 字", elapsedMs: 193_876 }));
    expect(text).toContain("视频转笔记(单线).md · 6753 字");
    expect(text).toContain("耗时 3m 13s");
    expect(text).toContain("#1791f9");
  });

  it("中断的运行读得出「服务重启」，不再假装是用户取消", () => {
    const text = runRowTooltip(run({ status: "interrupted", error: "服务重启，运行已中断", summary: "2 个节点已完成" }));
    expect(text).toContain("已中断：");
    expect(text).toContain("2 个节点已完成");
    expect(text).toContain("服务重启，运行已中断");
    expect(text).not.toContain("已取消");
  });

  it("没起名也没摘要时至少报出状态，不会是一条空提示", () => {
    expect(runRowTooltip(run({ status: "running" }))).toContain("运行中：");
  });

  it("起了名就以名字开头", () => {
    expect(runRowTooltip(run({ name: "记忆系统" })).startsWith("记忆系统：")).toBe(true);
  });
});

describe("resolveRenameRequest", () => {
  it("没改动就不发请求——失焦、Esc 都会走到这里，不能因此写一遍库", () => {
    expect(resolveRenameRequest("记忆系统", "记忆系统")).toBeUndefined();
    expect(resolveRenameRequest("记忆系统", "  记忆系统  ")).toBeUndefined();
    expect(resolveRenameRequest("", "")).toBeUndefined();
    expect(resolveRenameRequest("", "   ")).toBeUndefined();
  });

  it("改了名就发新名字，首尾空白不算内容", () => {
    expect(resolveRenameRequest("", "  记忆系统  ")).toEqual({ name: "记忆系统" });
    expect(resolveRenameRequest("旧名", "新名")).toEqual({ name: "新名" });
  });

  it("清空是「把这行交回给时间」——这一点与文件夹不同，文件夹名必填所以空值只能放弃", () => {
    expect(resolveRenameRequest("记忆系统", "")).toEqual({ name: null });
    expect(resolveRenameRequest("记忆系统", "   ")).toEqual({ name: null });
  });
});

describe("formatRunTime", () => {
  it("今天只给时分，跨年给完整日期（侧栏要能扫出先后顺序）", () => {
    const now = new Date();
    expect(formatRunTime(now.getTime())).toBe(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    expect(formatRunTime(new Date(2000, 0, 2, 3, 4).getTime())).toBe("2000-01-02");
  });
});
