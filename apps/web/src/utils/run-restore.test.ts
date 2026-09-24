import { describe, expect, it } from "vitest";
import type { RunNodeResult } from "@scribe-flow/shared";
import { backfillFromRun, canBackfillFromStatus, snapshotIsComplete } from "./run-restore";

function result(nodeId: string, status: RunNodeResult["status"]): RunNodeResult {
  return { nodeId, nodeType: "process.prompt", status, elapsedMs: 0 };
}

describe("回填来源的运行状态", () => {
  it("失败与取消的运行同样可以回填，只有仍在跑的跳过", () => {
    expect(canBackfillFromStatus("success")).toBe(true);
    expect(canBackfillFromStatus("error")).toBe(true);
    expect(canBackfillFromStatus("cancelled")).toBe(true);
    expect(canBackfillFromStatus("running")).toBe(false);
  });
});

describe("合并更早运行的结果", () => {
  const graphIds = new Set(["n_src", "n_asr", "n_prompt", "n_out"]);

  it("只补缺失的 done 节点，当前运行已有的结果不被覆盖", () => {
    const map = new Map([["n_prompt", result("n_prompt", "done")]]);
    backfillFromRun(
      map,
      [result("n_src", "done"), result("n_prompt", "error"), result("n_asr", "cancelled")],
      graphIds,
    );
    expect([...map.keys()].sort()).toEqual(["n_prompt", "n_src"]);
    expect(map.get("n_prompt")?.status).toBe("done");
  });

  it("非 done 的旧结果不写回，画布上不会出现来路不明的失败标", () => {
    const map = new Map<string, RunNodeResult>();
    backfillFromRun(map, [result("n_asr", "error"), result("n_prompt", "cancelled")], graphIds);
    expect(map.size).toBe(0);
  });

  it("当前画布上已不存在的旧节点不复活", () => {
    const map = new Map<string, RunNodeResult>();
    backfillFromRun(map, [result("n_deleted", "done")], graphIds);
    expect(map.size).toBe(0);
  });

  it("回归：上次整跑失败、本次只跑单节点时，上游卡片的状态要能补回来", () => {
    // 本次运行只覆盖了一个节点
    const map = new Map([["n_prompt", result("n_prompt", "done")]]);
    expect(snapshotIsComplete(map, graphIds)).toBe(false);
    // 上一次运行整体失败，但来源/转写是跑完的
    backfillFromRun(
      map,
      [result("n_src", "done"), result("n_asr", "done"), result("n_prompt", "error")],
      graphIds,
    );
    expect([...map.keys()].sort()).toEqual(["n_asr", "n_prompt", "n_src"]);
    expect(map.get("n_src")?.status).toBe("done");
    expect(map.get("n_asr")?.status).toBe("done");
    expect(map.get("n_prompt")?.status).toBe("done");
  });

  it("凑齐画布上的全部节点即视为完整", () => {
    const complete = new Map([
      ["n_src", result("n_src", "done")],
      ["n_asr", result("n_asr", "done")],
      ["n_prompt", result("n_prompt", "done")],
      ["n_out", result("n_out", "done")],
    ]);
    expect(snapshotIsComplete(complete, graphIds)).toBe(true);
    // 若画布上还有没跑过的节点，则不算完整、需要继续往回翻
    expect(snapshotIsComplete(new Map(), graphIds)).toBe(false);
  });
});
