import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { RunMeta, RunScope } from "@scribe-flow/shared";
import { ApiError, api } from "@/lib/api";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { toast } from "@/lib/toast";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import { dropQueueItem, pushQueueItem, runQueueKey, type RunQueueItem } from "@/utils/run-queue";

export type EnqueueResult = { result: "queued"; position: number } | { result: "duplicate" };

/**
 * 排队运行的执行侧：谁在排、什么时候轮到下一个。
 *
 * 服务端只允许同一工程同时跑一个运行（`createRun` 会拒第二次），所以画布上的运行入口
 * 在运行期间改成「加入排队」，当前运行结束后依次自动开始。纯逻辑与文案在
 * `utils/run-queue.ts`，这里管副作用：入队、POST、清空、以及「什么时候该排下一个」。
 *
 * 三点刻意的取舍：
 *
 * 1. **队列在内存里，刷新页面即失**。落 localStorage 会在刷新后自动把 AI 运行接着跑起来——
 *    花了钱、用户还未必记得点过，这种"惊喜"比丢队列更糟。判断是：人还在用这个页面，队列就在。
 * 2. **排空挂在工作台外壳（AppLayout）上，与页面无关**。点完「排队运行」人就会切到结果页、
 *    切到别的工程甚至别的页面去看；排在 store 里（跟着 pinia 活得比视图久）+ 外壳常驻的
 *    轮询一起，队列照排，不会因为离开画布就停住。
 * 3. **停止运行会清空队列**。否则停掉当前这条、下一条立刻自己跑起来，看起来像是"停止没生效"。
 */
export const useRunQueueStore = defineStore("run-queue", () => {
  const runsStore = useRunsStore();
  const projectsStore = useProjectsStore();

  /** 按工程分组的等待队列。 */
  const queues = ref<Record<string, RunQueueItem[]>>({});
  /** 正在发起 POST 的工程。 */
  const starting = ref<string[]>([]);
  let inited = false;

  function itemsOf(projectId: string): RunQueueItem[] {
    return queues.value[projectId] ?? [];
  }

  function pendingCount(projectId: string): number {
    return itemsOf(projectId).length;
  }

  /** 该工程正在发起运行请求（画布直启或队列排空）：这期间画布也要保持只读。 */
  function isStarting(projectId: string): boolean {
    return starting.value.includes(projectId);
  }

  function setItems(projectId: string, items: RunQueueItem[]): void {
    queues.value = { ...queues.value, [projectId]: items };
  }

  function hasRunningRun(projectId: string): boolean {
    return runsStore.runs.some((run) => run.projectId === projectId && run.status === "running");
  }

  function beginStart(projectId: string): void {
    if (starting.value.includes(projectId)) return;
    starting.value = [...starting.value, projectId];
  }

  function endStart(projectId: string): void {
    starting.value = starting.value.filter((id) => id !== projectId);
  }

  /**
   * 入队，并立刻试着排空一次。
   *
   * 没有运行在跑时（画布上的直启已经先拦了一道），这一次尝试就是「立刻开始」，
   * 所以正常路径不会在队列里留下停留的条目。
   */
  function enqueue(projectId: string, input: { scope: RunScope; nodeId?: string; label: string }): EnqueueResult {
    const item: RunQueueItem = { key: runQueueKey(input.scope, input.nodeId), scope: input.scope, nodeId: input.nodeId, label: input.label };
    const next = pushQueueItem(itemsOf(projectId), item);
    if (!next) return { result: "duplicate" };
    setItems(projectId, next);
    void drain(projectId);
    return { result: "queued", position: next.length };
  }

  /** 清空该工程的等待队列，返回清掉几条（给提示用）。 */
  function clear(projectId: string): number {
    const count = itemsOf(projectId).length;
    if (count > 0) setItems(projectId, []);
    return count;
  }

  /**
   * 排空：队首那条现在能不能跑。
   *
   * 不能跑的情况有三种，都不算失败：该工程已经有运行在跑（等它结束，由 watch 再叫一次）、
   * 正在发起另一次请求、队列是空的。
   */
  async function drain(projectId: string): Promise<void> {
    if (isStarting(projectId) || hasRunningRun(projectId)) return;
    const head = itemsOf(projectId)[0];
    if (!head) return;

    beginStart(projectId);
    let nextInLine = false;
    try {
      const run = await startRun(projectId, head);
      if (!run) {
        // 用户在确认框里选了「不跑」：这不是失败，安静出队
        setItems(projectId, dropQueueItem(itemsOf(projectId), head.key));
        return;
      }
      runsStore.upsert(run);
      setItems(projectId, dropQueueItem(itemsOf(projectId), head.key));
      toast.info(`已开始排队中的「${head.label}」`);
    } catch (err) {
      // 失败可能是「别处已经起了运行」（另一个标签页、或用户刚在画布上点了运行，服务端拒绝了这一次），
      // 那不是这条队列的错。拉一次真实状态再判断：确实有运行在跑就把队首留住，等它结束再排。
      await runsStore.load();
      if (hasRunningRun(projectId)) return;
      setItems(projectId, dropQueueItem(itemsOf(projectId), head.key));
      if (!projectsStore.list.some((project) => project.id === projectId)) {
        // 工程已经删掉了：整条队列都没有意义，静默作废——否则会为每一条各弹一次错。
        setItems(projectId, []);
        return;
      }
      nextInLine = true;
      toast.error(err instanceof Error ? err.message : "启动排队中的运行失败");
    } finally {
      endStart(projectId);
    }
    // 这一步失败出队了，后面还有就接着排（真失败通常连着几条一起失败，各自报自己的原因）。
    if (nextInLine) void drain(projectId);
  }

  /**
   * 起一条运行；服务端要求「按旧素材继续」的确认时问一次再重发。
   *
   * 为什么要有这一步：换了来源卡的素材却只重跑下游时，上游会沿用旧素材的产物。
   * 报告会按**文稿真实的来源**写（归因取产出时的图快照），所以这不是跑不了，而是两条路要用户选：
   * 按当前文稿继续，或先重跑上游让它按新素材重算。返回 `null` 表示用户选了不跑。
   */
  async function startRun(projectId: string, head: RunQueueItem): Promise<RunMeta | null> {
    const body = { scope: head.scope, nodeId: head.nodeId };
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

  /**
   * 安装排空触发器。由工作台外壳调用一次（幂等）。
   *
   * 触发点是「运行列表变了」：某次运行跑完，画布页由 SSE 立刻刷新列表，
   * 人不在画布页时由外壳的轮询兜底（最快 5 秒）——两者都会让这里重排一次。
   */
  function init(): void {
    if (inited) return;
    inited = true;
    watch(
      () => runsStore.runs,
      () => {
        for (const projectId of Object.keys(queues.value)) void drain(projectId);
      },
      { deep: true },
    );
  }

  return { itemsOf, pendingCount, isStarting, enqueue, clear, beginStart, endStart, init };
});
