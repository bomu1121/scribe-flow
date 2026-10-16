import { describe, expect, it } from "vitest";
import { showsRunLogEntry } from "./run-log";

describe("showsRunLogEntry", () => {
  it("中断、失败、用户取消都要给日志入口", () => {
    // 取消也给：取消与中断在数据上是同一个节点状态（cancelled），
    // 在这里区分只会让「服务重启」这一种漏掉入口；而「取消前跑到哪」同样是回头要问的。
    expect(showsRunLogEntry("cancelled")).toBe(true);
    expect(showsRunLogEntry("error")).toBe(true);
  });

  it("成功、运行中、排队、跳过、没跑过都不给：有结果看结果，日志还在写", () => {
    for (const status of ["done", "running", "queued", "skipped", "idle", undefined] as const) {
      expect(showsRunLogEntry(status)).toBe(false);
    }
  });
});
