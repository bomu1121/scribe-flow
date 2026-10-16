import type { RunMeta, RunScope } from "@scribe-flow/shared";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { ApiError, api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * 起一条运行；服务端要求「按旧素材继续」的确认时问一次再重发。
 *
 * **两条发起路径共用这一个函数**（画布直启、运行中排队），否则行为会分叉——
 * 实测出现过：确认逻辑只加在排队那条路上，直启那条仍把 409 当成普通失败弹「操作失败」，
 * 用户看到的就是一句拒绝理由 + 没有确认入口，而服务端其实在等他拍板。
 *
 * 为什么需要确认：换了来源卡的素材却只重跑下游时，上游会沿用旧素材的产物。
 * 报告与笔记会按**文稿真实的来源**写（归因取产出那份产物时的图快照），所以这不是跑不了，
 * 而是两条路要用户选：按当前文稿继续，或先重跑上游让它按新素材重算。
 *
 * @returns 已启动的运行；`null` 表示用户在确认框里选了「先去重跑上游」（不是失败）
 */
export async function startRunRequest(
  projectId: string,
  input: { scope: RunScope; nodeId?: string },
): Promise<RunMeta | null> {
  const body = { scope: input.scope, nodeId: input.nodeId };
  try {
    return await api.post<RunMeta>(`/api/projects/${projectId}/runs`, body);
  } catch (err) {
    if (!(err instanceof ApiError) || err.detail.needConfirmStaleMaterial !== true) throw err;
    try {
      await ElMessageBox.confirm(err.message, "这条运行会用更换前的素材", {
        confirmButtonText: "按当前文稿继续",
        cancelButtonText: "先去重跑上游",
        type: "warning",
      });
    } catch {
      toast.info("已取消。要让报告对上新素材，请从来源卡的下游第一个节点（转写）开始跑。");
      return null;
    }
    return await api.post<RunMeta>(`/api/projects/${projectId}/runs`, { ...body, confirmStaleMaterial: true });
  }
}
