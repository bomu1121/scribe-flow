# M3 验收标准（分层）

> 生效时间：2026-08-28。M3 范围：运行数据模型与 API、DAG 执行引擎、B站下载/FFmpeg、云 ASR、AI 节点、SSE、节点状态与运行控制台、运行记录页、设置页 AI/ASR 配置。
> 验收原则：L0/L1/L2 全自动；L3 用 bsk 真实浏览器；L4 用真实外部能力与真实凭据；任何一层不过，M3 不算完成。

## 2026-08-28 验收结果

| 层级 | 结果 | 证据 |
|---|---|---|
| L0 静态质量 | ✅ 通过 | typecheck / test（9 用例：shared 4 + bili 2 + ai 3）/ build / lint 全绿 |
| L1 引擎 API | ✅ 14/14 | `pnpm check:api:m3`（设置、文本链路、SSE 5 类事件、列表、重跑、停止、删除） |
| L2 无头 CDP | ✅ 30/30 | `pnpm smoke:ui`（含画布点「运行全部」→ SSE 驱动 3 节点 done → 运行记录页 → 设置页） |
| L3 真实浏览器 | ✅ 通过 | bsk 会话：设置页表单、画布运行 AI 链路（80字→校对81字→观点786字→合并797字→输出）、运行记录页、运行详情 Markdown 预览 |
| L4 真实外部能力 | ✅ 通过 | B站下载+FFmpeg、MiMo-V2.5 真实 ASR、DeepSeek AI 全部真实跑通「B站视频→观点笔记」 |

L4 明细：
1. **B站下载 + FFmpeg**：真实项目「视频观点笔记」单节点运行 `source.bili`，CodeX 40 分钟视频 → 下载 m4s 音轨 → 16k 单声道 wav（77,195,096 字节），耗时 10.9s，节点 `done` ✅
2. **AI 节点（DeepSeek 真实 Key）**：文本→AI 校对→观点提炼→合并→输出 5 节点全部 done，观点块 786 字，耗时 6.3s ✅
3. **云 ASR（MiMo-V2.5 真实 Key）**：`/api/settings/test/asr` 返回「嗯。」；完整模板一（B站 2:23 视频 → 转写 → 校对 → 观点提炼 → 输出）5 节点全部 done：转写 196 字（6.3s）、AI 校对 196 字（1.2s）、观点提炼 207 字（2.3s）、输出 `笔记.md`（207 字），run=success，总耗时 11.1s ✅
4. **ASR 协议**：OpenAI 兼容 `/audio/transcriptions` 与 MiMo `input_audio` 两条路径另各有 mock 用例通过 ✅

## L0 静态质量

| 检查 | 标准 |
|---|---|
| `pnpm typecheck` | 0 错误 |
| `pnpm test` | shared 4 + bili 2 + ai 3 用例全过 |
| `pnpm build` | 成功（chunk >500KB 为已知优化项） |
| `pnpm lint` | slop 0 命中；ui-lint 无散写颜色/z-index |

## L1 引擎 API（`pnpm check:api:m3`，14 项）

| # | 检查 |
|---|---|
| 1 | GET /api/settings 默认配置 |
| 2 | PUT /api/settings 保存 |
| 3 | 创建临时工程 |
| 4 | PUT 文本工作流（source.text → merge → output） |
| 5 | POST /api/projects/:id/runs 返回 202 + run id |
| 6 | SSE 收到 run.started / node.done×3 / run.done |
| 7 | 3 节点全部 done、run=success |
| 8 | 输出节点产物路径 `outputs/<runId>/验收.md` |
| 9 | GET /api/runs 列表包含本次运行 |
| 10 | POST retry 单节点运行（复用上次产物） |
| 11 | 重跑 success |
| 12 | POST stop 返回 ok |
| 13 | DELETE 运行 |
| 14 | DELETE 临时工程 |

## L2 无头 CDP（`pnpm smoke:ui`，30 项）

在 M2 23 项基础上新增：

| # | 检查 |
|---|---|
| 24 | 画布「运行全部」按钮启用 |
| 25 | 点击后 SSE 驱动 3 节点进入 `.is-done` |
| 26 | 底部控制台显示「运行结束」 |
| 27 | /runs 页出现本次运行 |
| 28 | 设置页 AI 表单（≥3 个 el-input） |
| 29 | 设置页 ASR 分段控件 |
| 30 | 清理 M3 临时数据 |

## L3 真实浏览器（bsk）

| # | 检查 | 结果 |
|---|---|---|
| 1 | /settings 设置页渲染与表单默认值 | ✅ |
| 2 | 画布运行 AI 链路，节点摘要条实时出现（80/81/786/797 字） | ✅ |
| 3 | 底部控制台「运行结束：success」 | ✅ |
| 4 | /runs 运行记录表格（状态/耗时/时间） | ✅ |
| 5 | /run/:runId 运行详情：节点结果表 + 输出 Markdown 预览 | ✅ |
| 6 | 截图视觉复核无错位 | ✅ |

## L4 真实外部能力

| # | 检查 | 结果 |
|---|---|---|
| 1 | B站音轨下载（guest 可下载公开视频） | ✅ 40min 视频 10.9s 完成 |
| 2 | FFmpeg 转 16k 单声道 wav | ✅ 77MB |
| 3 | DeepSeek chat completions（校对/观点提炼） | ✅ 真实 Key |
| 4 | OpenAI 兼容 ASR 协议 | ✅ mock 验证 |
| 5 | MiMo-V2.5 input_audio 协议 | ✅ mock + 真实 Key 验证 |
| 6 | 真实 ASR 转写 | ✅ 196 字 / 6.3s |

## 完成判据

L0–L3 全绿 + L4 全部真实能力验证通过，M3 完整完成 ✅（2026-08-28）。
