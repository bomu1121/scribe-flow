# 工作流运行态恢复方案（离开页面后重新进入）

## 问题

ScribeFlow 中运行引擎在服务端执行，SSE 只负责把实时进度推送给当前页面。用户点击「返回工程列表」、切到运行记录页或刷新页面后，前端 `ProjectEditorView` 会销毁并重新创建：

- 服务端运行仍继续（`runs.status = running`，引擎照常推进）；
- 但重新进入工程时，前端只加载工程定义，**没有重新查询正在运行的 Run 并恢复节点状态/订阅 SSE**；
- 于是画布上所有节点回到“未运行”灰色，看起来“进度清空”，实际还在跑。

## 主流平台怎么处理

核心共识：**运行是服务端实体，页面只是运行状态的“视图”**。离开页面不应取消运行；重新进入时通过服务端状态恢复视图，并重新建立实时通道。

| 平台 | 做法 |
|---|---|
| n8n | 执行（Execution）由服务端持久化，编辑器与执行解耦；Workflow 页面有 Executions 列表，可重新打开 running 执行查看实时状态。相关：n8n Execution Data and History、Debug executions |
| Dify | 工作流运行记录（Workflow Logs）由服务端保存，运行中日志不会因 SSE 断开而丢失；可在日志页继续查看/跟踪。相关：Dify Run History and Logs、Workflow Logs API |
| ComfyUI | Prompt Queue 在服务端维护，前端刷新/离开后队列不丢；重新打开页面会恢复当前队列与执行状态。相关：ComfyUI Execution、Queue Manager |
| Windmill | Flow/Job 运行在服务端，Jobs/Logs 页面可随时查看运行中与历史 Job，UI 导航不影响执行。相关：Windmill Jobs、Observability |

这些平台共同遵循几条设计原则：

1. **服务端是唯一事实源**：运行状态、节点结果、日志都落库/存服务端，不依赖浏览器内存。
2. **页面可重挂载（reattach）**：进入页面时先拉取服务端运行快照，再订阅 SSE/WebSocket 增量事件。
3. **离开不销毁运行**：组件卸载只关闭事件订阅，不向服务端发停止/取消。
4. **列表/入口给出“仍在运行”提示**：让用户知道任务还在跑，而不是误以为已清空。
5. **断线自愈**：轮询 + SSE 重连，避免因临时断网导致界面状态与服务端不一致。

## ScribeFlow 落地方案

### 已实现

1. **画布支持运行快照恢复**
   - `FlowCanvas` 新增 `applyRunSnapshot(nodeResults)`：把服务端 `RunNodeResult` 的 `running / done / error / cancelled / skipped` 映射回节点 `status / summary / preview`。
   - 该函数只更新内存态，不写入工程图，符合“运行态不写入工程图”的既有约定。

2. **进入工程页自动恢复运行**
   - `ProjectEditorView` 监听全局 `runsStore.runs`，发现当前工程存在 `status === "running"` 的 Run 时调用 `resumeRun(run)`。
   - `resumeRun` 会：
     - 设置 `activeRun` 与 `running`，让底部控制台重新显示运行中；
     - 请求 `/api/runs/:id` 获取节点结果快照并恢复到画布；
     - 重新订阅该 Run 的 SSE，继续接收 `node.started / progress / done / error / run.done`；
     - 如果快照拉取时运行已结束，则更新为结束态并刷新运行列表。
   - 处理了“运行列表先返回、画布尚未挂载”的竞态：快照先暂存，画布挂载后再应用。

3. **断线/轮询兜底**
   - 全局 `runsStore` 每 5 秒刷新一次；若发现本地仍认为“运行中”但服务端已不在 running 列表，`reconcileActiveRun()` 会主动核对一次详情，避免 SSE 断线导致界面卡在运行中。

4. **工程列表运行中徽标**
   - `ProjectListView` 根据 `runsStore.runs` 给正在运行的工程卡片显示「运行中」Tag，用户回到列表时能立即看到任务仍在进行。

5. **最近一次运行结果可找回**
   - 工程卡片会显示最近一次运行的状态（成功/失败/已取消）和 `#id`，点击直接进入该次运行详情，刷新后也能从列表快速找回。
   - 进入工程页且没有进行中的运行时，会自动载入最近一次运行的节点快照到画布，并在顶栏显示「上次结果」按钮；下次点击运行时 `run.started` 会清空这些旧状态，不会影响新运行。

### 后续可增强

- **多标签页一致性**：目前每个标签页各自订阅 SSE；可在 `runsStore` 层做共享订阅，减少重复连接并统一状态。
- **服务端主动查询接口**：增加 `GET /api/projects/:id/runs?status=running` 或把“当前运行”合入工程详情，减少前端拼接逻辑。
- **服务重启恢复**：目前启动时会把残留 `running` 标记为 `cancelled`；如需真正断点续跑，可把节点级中间产物落库并在重启后恢复队列（工作量较大，可作为远期能力）。

## 相关链接

- [n8n Execution Data and History](https://deepwiki.com/n8n-io/n8n-docs/9.3-course:-weekly-sales-reporting-automation)
- [n8n Debug executions](https://docs.n8n.io/build/understand-workflows/understand-executions/debug-executions)
- [Dify Run History and Logs](https://deepwiki.com/langgenius/dify-docs/6.3-run-history-and-logs)
- [Dify Workflow Logs API](https://docs.dify.ai/en/api-reference/workflow-runs/list-workflow-logs)
- [ComfyUI Execution](https://mintlify.wiki/Comfy-Org/ComfyUI/concepts/execution)
- [ComfyUI Queue Manager](https://github.com/QuietNoise/comfyui_queue_manager)
- [Windmill Jobs](https://hugo-win-73-git-sync-azure-d.windmilldocs.pages.dev/docs/core_concepts/jobs)
- [Windmill Observability](https://www.windmill.dev/platform/observability)
