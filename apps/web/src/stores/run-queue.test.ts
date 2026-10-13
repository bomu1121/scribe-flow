import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunMeta, RunStatus } from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useProjectsStore } from "@/stores/projects";
import { useRunQueueStore } from "@/stores/run-queue";
import { useRunsStore } from "@/stores/runs";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn(), put: vi.fn(), upload: vi.fn() } }));

function makeRun(id: string, status: RunStatus, overrides: Partial<RunMeta> = {}): RunMeta {
  return { id, projectId: "p1", status, scope: "node", nodeId: "n1", createdAt: 1, ...overrides };
}

/** 让 watch 与排空的微任务链跑完（nextTick 只保证 watcher 触发，drain 里还有一次 await）。 */
async function settle(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

function setup() {
  setActivePinia(createPinia());
  const runsStore = useRunsStore();
  const projectsStore = useProjectsStore();
  const queue = useRunQueueStore();
  queue.init();
  // 排空失败时会把「工程是否还在」也查一遍，这里放一个存在的工程。
  projectsStore.list = [{ id: "p1", name: "某期视频" } as (typeof projectsStore.list)[number]];
  return { runsStore, projectsStore, queue };
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockReset();
});

describe("入队", () => {
  it("没有运行在跑：入队即开始，不在队列里停留", async () => {
    const { queue, runsStore } = setup();
    vi.mocked(api.post).mockResolvedValue(makeRun("run_b", "running", { scope: "node", nodeId: "n2" }));

    const outcome = queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    expect(outcome).toEqual({ result: "queued", position: 1 });
    await settle();

    expect(api.post).toHaveBeenCalledWith("/api/projects/p1/runs", { scope: "node", nodeId: "n2" });
    expect(queue.pendingCount("p1")).toBe(0);
    expect(runsStore.runs.map((r) => r.id)).toContain("run_b");
  });

  it("有运行在跑：先排队，不发起第二次请求", async () => {
    const { queue, runsStore } = setup();
    runsStore.runs = [makeRun("run_a", "running")];

    queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    queue.enqueue("p1", { scope: "fromNode", nodeId: "n3", label: "从「加工 C」开始" });
    await settle();

    expect(api.post).not.toHaveBeenCalled();
    expect(queue.pendingCount("p1")).toBe(2);
  });

  it("同一条重复点：只排一个", async () => {
    const { queue, runsStore } = setup();
    runsStore.runs = [makeRun("run_a", "running")];

    expect(queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" })).toEqual({ result: "queued", position: 1 });
    expect(queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" })).toEqual({ result: "duplicate" });
    expect(queue.pendingCount("p1")).toBe(1);
  });
});

describe("排空", () => {
  it("当前运行跑完 → 队首自动开始，按入队顺序", async () => {
    const { queue, runsStore } = setup();
    runsStore.runs = [makeRun("run_a", "running")];
    queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    queue.enqueue("p1", { scope: "node", nodeId: "n3", label: "「加工 C」" });
    await settle();
    expect(queue.pendingCount("p1")).toBe(2);

    vi.mocked(api.post).mockResolvedValue(makeRun("run_b", "running", { scope: "node", nodeId: "n2" }));
    runsStore.runs = [makeRun("run_a", "success")];
    await settle();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toEqual({ scope: "node", nodeId: "n2" });
    // run_b 已经在跑，所以第三条继续等——不会连着把队列排空。
    expect(queue.pendingCount("p1")).toBe(1);

    vi.mocked(api.post).mockResolvedValue(makeRun("run_c", "running", { scope: "node", nodeId: "n3" }));
    runsStore.runs = [makeRun("run_b", "success"), makeRun("run_a", "success")];
    await settle();

    expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual({ scope: "node", nodeId: "n3" });
    expect(queue.pendingCount("p1")).toBe(0);
  });

  it("画布正在发起运行（POST 往返期间）不抢跑：等那一次落进运行列表", async () => {
    const { queue, runsStore } = setup();
    queue.beginStart("p1");

    queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    await settle();
    expect(api.post).not.toHaveBeenCalled();

    queue.endStart("p1");
    vi.mocked(api.post).mockResolvedValue(makeRun("run_b", "running", { scope: "node", nodeId: "n2" }));
    runsStore.runs = [makeRun("run_a", "running")];
    await settle();
    // run_a 还在跑，所以继续等它的下一次状态变化
    expect(api.post).not.toHaveBeenCalled();
  });

  it("启动失败且没有别的运行在跑 → 出队并报错，后面那条接着来", async () => {
    const { queue, runsStore } = setup();
    runsStore.runs = [makeRun("run_a", "running")];
    queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    queue.enqueue("p1", { scope: "node", nodeId: "n3", label: "「加工 C」" });
    await settle();

    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => 0);
    vi.mocked(api.post).mockRejectedValueOnce(new Error("节点「加工 B」的链接为空")).mockResolvedValueOnce(makeRun("run_c", "running", { scope: "node", nodeId: "n3" }));
    runsStore.runs = [makeRun("run_a", "error")];
    await settle();

    expect(errorToast).toHaveBeenCalledWith("节点「加工 B」的链接为空");
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual({ scope: "node", nodeId: "n3" });
    expect(queue.pendingCount("p1")).toBe(0);
    errorToast.mockRestore();
  });

  it("失败其实是「别处已经起了运行」→ 队首留住，不报错、不丢条目", async () => {
    const { queue, runsStore } = setup();
    runsStore.runs = [makeRun("run_a", "running")];
    queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    await settle();

    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => 0);
    // 服务端拒绝（另一个标签页已经在跑），而列表刷新后确实有一条 running
    vi.mocked(api.post).mockRejectedValueOnce(new Error("该工程已有运行正在进行，请先等待或停止"));
    vi.mocked(api.get).mockResolvedValue({ items: [makeRun("run_x", "running")] });
    runsStore.runs = [makeRun("run_a", "success")];
    await settle();

    expect(errorToast).not.toHaveBeenCalled();
    expect(queue.pendingCount("p1")).toBe(1);
    errorToast.mockRestore();
  });
});

describe("清空", () => {
  it("停止运行清空队列：返回清掉几条，之后不再自动开始", async () => {
    const { queue, runsStore } = setup();
    runsStore.runs = [makeRun("run_a", "running")];
    queue.enqueue("p1", { scope: "node", nodeId: "n2", label: "「加工 B」" });
    queue.enqueue("p1", { scope: "node", nodeId: "n3", label: "「加工 C」" });
    await settle();

    expect(queue.clear("p1")).toBe(2);
    expect(queue.pendingCount("p1")).toBe(0);

    runsStore.runs = [makeRun("run_a", "cancelled")];
    await settle();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("没有排队时清空返回 0", () => {
    const { queue } = setup();
    expect(queue.clear("p1")).toBe(0);
  });
});
