import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { ApiError, api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { startRunRequest } from "@/utils/run-start";

vi.mock("element-plus/es/components/message-box/index.mjs", () => ({ ElMessageBox: { confirm: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn(), put: vi.fn(), upload: vi.fn() },
}));

/**
 * 发起运行只有这一个入口（画布直启与排队共用）。
 *
 * 起因是一次真机反馈：确认逻辑只加在排队那条路上，画布直启仍把 409 当普通失败弹「操作失败」——
 * 用户看到一句拒绝理由却没有确认入口，而服务端其实在等他拍板。
 */
const run = { id: "run_x", projectId: "p1", status: "running", scope: "node", nodeId: "n1", createdAt: 1 } as const;

const staleError = () =>
  new ApiError("「AI 加工」要沿用的上游「AI 校对」的产物，是用 BV1DTWw6UE1y 第 1 集/分P 这个素材算的……", 409, {
    needConfirmStaleMaterial: true,
  });

beforeEach(() => {
  vi.mocked(ElMessageBox.confirm).mockReset();
  vi.mocked(api.post).mockReset();
});

describe("startRunRequest", () => {
  it("服务端要求确认时问一次，选「继续」就带标记重发", async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue("confirm" as never);
    vi.mocked(api.post).mockRejectedValueOnce(staleError()).mockResolvedValueOnce(run);

    const started = await startRunRequest("p1", { scope: "node", nodeId: "n1" });

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual({ scope: "node", nodeId: "n1", confirmStaleMaterial: true });
    expect(started).toEqual(run);
  });

  it("选「先去重跑上游」返回 null（不是失败），并告诉用户该从哪起步", async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error("cancel"));
    vi.mocked(api.post).mockRejectedValueOnce(staleError());
    const infoToast = vi.spyOn(toast, "info").mockImplementation(() => 0);
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => 0);

    const started = await startRunRequest("p1", { scope: "node", nodeId: "n1" });

    expect(started).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(errorToast).not.toHaveBeenCalled();
    expect(infoToast.mock.calls.some(([message]) => String(message).includes("转写"))).toBe(true);
    infoToast.mockRestore();
    errorToast.mockRestore();
  });

  it("其他错误照常抛出（不能把真失败也当成要确认）", async () => {
    const boom = new ApiError("节点「加工 B」的链接为空", 400, {});
    vi.mocked(api.post).mockRejectedValueOnce(boom);

    await expect(startRunRequest("p1", { scope: "node", nodeId: "n1" })).rejects.toThrow("链接为空");
    expect(ElMessageBox.confirm).not.toHaveBeenCalled();
  });

  it("普通 Error（不是 ApiError）同样照常抛出", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("网络断了"));
    await expect(startRunRequest("p1", { scope: "node", nodeId: "n1" })).rejects.toThrow("网络断了");
    expect(ElMessageBox.confirm).not.toHaveBeenCalled();
  });

  it("一切正常时不弹任何框", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(run);
    const started = await startRunRequest("p1", { scope: "all" });
    expect(started).toEqual(run);
    expect(ElMessageBox.confirm).not.toHaveBeenCalled();
  });
});
