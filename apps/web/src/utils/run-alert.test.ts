import { afterEach, describe, expect, it } from "vitest";
import { notifyRunFinished, resetRunAlertMemory, runAlertBody, runAlertTitle, shouldAlertRunEnd } from "./run-alert";

afterEach(() => resetRunAlertMemory());

describe("runAlertBody", () => {
  it("带上工程名与状态", () => {
    expect(runAlertBody({ runId: "r1", status: "success", projectName: "某期视频" })).toBe("某期视频：已完成");
    expect(runAlertBody({ runId: "r2", status: "error", projectName: "某期视频" })).toBe("某期视频：失败");
    expect(runAlertBody({ runId: "r3", status: "cancelled", projectName: "某期视频" })).toBe("某期视频：已取消");
    expect(runAlertBody({ runId: "r4", status: "interrupted", projectName: "某期视频" })).toBe("某期视频：已中断");
  });

  it("有失败原因时接在后面，人不在电脑前也说得清发生了什么", () => {
    expect(runAlertBody({ runId: "r1", status: "error", projectName: "某期视频", error: "转写 失败：请求超时" })).toBe(
      "某期视频：失败 —— 转写 失败：请求超时",
    );
  });

  it("拿不到工程名时只报状态", () => {
    expect(runAlertBody({ runId: "r1", status: "success", projectName: "" })).toBe("已完成");
  });
});

describe("runAlertTitle", () => {
  it("成功与失败用不同标题", () => {
    expect(runAlertTitle("success")).toBe("运行完成");
    expect(runAlertTitle("error")).toBe("运行结束");
    expect(runAlertTitle("cancelled")).toBe("运行结束");
  });
});

describe("shouldAlertRunEnd", () => {
  it("从运行中翻到成功或失败 → 提醒", () => {
    expect(shouldAlertRunEnd("running", "success")).toBe(true);
    expect(shouldAlertRunEnd("running", "error")).toBe(true);
  });

  it("首屏加载时早已跑完的历史运行（上一次没状态）→ 不提醒", () => {
    expect(shouldAlertRunEnd(undefined, "success")).toBe(false);
    expect(shouldAlertRunEnd(undefined, "error")).toBe(false);
  });

  it("自己点的停止 → 不提醒", () => {
    expect(shouldAlertRunEnd("running", "cancelled")).toBe(false);
  });

  it("但服务重启掐断的运行 → 要提醒：那不是用户点的，而且有一半产物在", () => {
    expect(shouldAlertRunEnd("running", "interrupted")).toBe(true);
  });

  it("还在运行中、或终态没变 → 不提醒", () => {
    expect(shouldAlertRunEnd("running", "running")).toBe(false);
    expect(shouldAlertRunEnd("success", "success")).toBe(false);
    expect(shouldAlertRunEnd("error", "success")).toBe(false);
  });
});

describe("notifyRunFinished", () => {
  it("同一个运行只提醒一次：画布页与全局轮询都会看到它结束", () => {
    const payload = { runId: "run_1", status: "success" as const, projectName: "某期视频" };
    expect(notifyRunFinished(payload, { notify: true, sound: true })).toBe(true);
    expect(notifyRunFinished(payload, { notify: true, sound: true })).toBe(false);
  });

  it("两个开关都关掉时不再提醒，但仍然记下这个运行已处理过", () => {
    const payload = { runId: "run_2", status: "error" as const, projectName: "某期视频" };
    expect(notifyRunFinished(payload, { notify: false, sound: false })).toBe(true);
    expect(notifyRunFinished(payload, { notify: false, sound: false })).toBe(false);
  });

  it("不同的运行互不影响", () => {
    expect(notifyRunFinished({ runId: "run_3", status: "success", projectName: "甲" }, { notify: true, sound: false })).toBe(true);
    expect(notifyRunFinished({ runId: "run_4", status: "success", projectName: "乙" }, { notify: true, sound: false })).toBe(true);
  });
});
