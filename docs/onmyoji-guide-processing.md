# 阴阳师攻略视频文稿 AI 加工模块

> 状态：已实现（独立“阴阳师攻略加工”节点 + 内置提示词块 + 核对版配方 + 垂直模板）
> 适用素材：阴阳师攻略类视频转文字稿 / UP 主口播稿 / 攻略文章
> 关联代码：`packages/shared/src/graph.ts`、`packages/shared/src/prompt.ts`、`packages/shared/src/templates.ts`、`apps/server/src/lib/engine.ts`、`apps/web/src/components/canvas/ScribeNode.vue`

---

## 1. 要解决的问题

阴阳师攻略类视频文稿与一般知识/观点视频不同，直接套通用摘要会有几个典型损失：

1. **专名与数值失真**：式神/角色名、御魂/装备名、技能等级（155/145/115）、速度线（240/170/152）、暴击/暴伤阈值、百分比增伤等一旦被“概括”就会失去可用性。
2. **决策信息被埋没**：攻略的核心价值是“该练谁、该刷什么、该怎么配、先做什么”，通用观点提炼容易输出成观点小结，而不是可执行清单。
3. **ASR 口语噪音**：视频转写稿常有重复、口误、口头禅、含糊指代（“这个式神”“那个御魂”），需要校对与消歧。
4. **版本时效与主观经验混杂**：攻略依赖当前版本、活动、免费领取；UP 主的主观推荐与客观游戏机制必须分层，否则读者会按过期信息操作。
5. **系列课上下文丢失**：本仓库示例是《我在阴阳师学网课》系列，每期承接上期、预告下期，模块需要保留“系列/期数/本集范围”。

---

## 2. 类似需求调研结论

桌面调研覆盖了视频转笔记工具、AI 内容加工流、游戏知识库抽取三类近邻方案，主要参考：

- [AI-GAME-RULE-EXTRACTOR](https://github.com/skindhu/AI-GAME-RULE-EXTRACTOR)：从游戏视频中抽取规则/实体，验证了“先抽结构化信息再生成文档”比直接摘要更可控。
- [拾语 Shiyu：本地优先 B 站视频 AI 笔记工具](https://github.com/YuMu247/shiyu-ai-knowledge-base)：Whisper 转录 + 分块清洗流水线 + 结构化总结 + 机器可读层，说明垂直视频笔记需要“清洗 → 结构化 → 导出”的流水线，而非单次 LLM。
- [Bilibili Video Notes](https://github.com/asdhabdua/bilibili-video-notes-skill)：教育/讲课视频自动笔记，强调多模态与结构化 DOCX；对攻略类可借鉴其“分块 + 抽取 + 合并”思路。
- [transcreve-ai](https://github.com/DeHor-Labs/transcreve-ai) / [Twitch Video Summarization 论文](https://dl.acm.org/doi/full/10.1145/3789624.3789641#2)：面向游戏视频的摘要需要区分事件、实体、用户决策，纯自由文本摘要不足以支撑知识库。
- 仓库内已有调研：[ai-tagging-design.md](./ai-tagging-design.md)（受控标签优于自由生成）、[workflow-module-expansion-research.md](./workflow-module-expansion-research.md)（内容加工流不要直接抄 iPaaS 功能）、[scribe-flow-ai-recipe-stage-a.md](./scribe-flow-ai-recipe-stage-a.md)（多步配方 + 断言门）。

**共同结论**：
- 不能只靠一段“帮我总结”提示词；需要**领域化输出 schema + 多步核对 + 术语/数值零损耗约束**。
- 结构化中间产物（实体、配置、步骤、坑、术语）比直接成稿更有利于审校、回查、后续知识库入库。
- 垂直模板应“开箱即用”预绑推荐加工块，而不是让用户从通用块里找。

---

## 3. 模块设计

### 3.1 加工链路

在画布上新增独立节点卡 `process.gameguide`（阴阳师攻略加工），用户直接拖这个节点即可，不需要先添加“AI 加工”再选提示词：

```text
视频/B站 → 转写 → AI 校对 → [阴阳师攻略加工] → 输出 Markdown
已有文稿 → AI 校对 → [阴阳师攻略加工] → 输出 Markdown
```

- `process.refine`：负责 ASR 口语清洗（错字、重复、语气词）。
- `process.gameguide`：专用阴阳师攻略加工节点，卡片上可选择“快速版 / 核对版”，默认核对版；内部自动调用对应加工逻辑，无需用户选提示词。
- `process.output`：落盘 Markdown，便于人工再编辑或进入 Obsidian 节点。

### 3.2 两种内置加工块

| 块 | 版本 | 方式 | 成本 | 适用 |
|---|---|---|---|---|
| `builtin.gameguide` | v1 | 单次 LLM 调用 | 低 | 短攻略、快速初稿、成本敏感 |
| `builtin.gameguide.v2` | v2（推荐） | 配方 4 步：拆解 → 起草 → 回文核对 → 修正成稿 | 约 4 次调用 | 长攻略、配队/数值类高价值内容 |

### 3.3 核对版配方步骤

| 步骤 | 做什么 | 中间产物 | 确定性校验 |
|---|---|---|---|
| `scan` 攻略要素拆解 | 识别游戏、系列、类型、受众；抽取实体/配置/步骤/坑/术语/版本提示 | JSON | 根键齐全：meta/oneLiner/entities/loadouts/steps/caveats/terms/versionNotes |
| `draft` 起草攻略稿 | 把拆解结果还原成 Markdown 攻略笔记 | Markdown 草稿 | 包含 `#`，避免空稿 |
| `audit` 回文核对 | 拿草稿回原文逐项核对专名、数值、优先级、步骤 | JSON 核对表 | 根键 `items` |
| `finalize` 修正成稿 | 按核对表修正/标注存疑，输出终稿 | Markdown 终稿 | 不包含代码围栏 |

这一设计沿用了仓库已有 `recipe` 原语与断言门，并通过 `process.gameguide` 专用节点接入运行引擎。

### 3.4 输出 Markdown 结构

```markdown
# 阴阳师攻略笔记：〈主题〉

> 适用游戏 / 系列期数 / 攻略类型 / 目标读者 / 作者 / 一句话结论

## 看完能获得什么
## 核心建议 / 优先级          ← 决策层，表格
## 分模块要点                ← 角色培养 / 御魂 / 配队 / 副本等
## 新手可执行清单
## 常见坑 / 注意事项
## 术语 / 黑话表
## 版本时效与待核实
```

该结构刻意强调：
- **决策先行**：先让读者知道“该做什么”，再展开细节。
- **数值零损耗**：技能等级、速度线、套装、百分比保留原样。
- **事实 vs 观点**：作者主观推荐与客观机制分开，防止误导。
- **时效边界**：版本活动类内容单独列出，不替作者更新。

### 3.5 垂直模板

新增两个模板：

| 模板 | 路径 |
|---|---|
| 文稿转阴阳师攻略笔记（核对版） | `template.text-game-guide` |
| 视频转阴阳师攻略笔记（核对版） | `template.video-game-guide` |

模板中的核心节点是 `process.gameguide`，默认 `mode: "audited"`（核对版），用户粘贴文稿/链接后即可运行；在节点卡片上可切换为快速版。

---

## 4. 为什么“不过于简单”

- 不是“一段提示词”了事：提供 v1 快速版 + v2 核对版两种档位，默认推荐核对版。
- 不是“自由输出”：v2 先用固定 JSON schema 做要素拆解，再做回文核对；scan/audit 都有断言门，缺根键会明确报错。
- 不是“无领域约束”：提示词显式要求保留专名/数值、区分主观推荐、标注版本时效、保留系列上下文。
- 不是“孤立功能”：配套两个一键模板、内置列表、共享测试与文档，用户可从新建工程直接进入。

---

## 5. 验收与测试

- `packages/shared/src/prompt.test.ts`：新增阴阳师攻略系列存在性、核对版 recipe 步骤 id、提示词关键约束断言。
- `packages/shared/src/recipe.test.ts`：`builtin.gameguide.v2` recipe 可通过 zod 运行时校验。
- `packages/shared/src/schema.test.ts`：新增阴阳师攻略模板通过 graph 校验，并确认使用独立 `process.gameguide` 节点且默认 `mode: "audited"`。
- `apps/server/src/lib/engine.recipe.test.ts`：mock 端点覆盖阴阳师攻略 v2 配方 4 步全流程，断言输出为终稿产物。
- `pnpm typecheck` 通过。

---

## 6. 后续增强（不在本次范围）

- 游戏专属词表/受控标签：为特定游戏维护实体词表，把 scan 输出映射到知识库规范名。
- 多篇系列聚合：同一系列多集分别出攻略笔记后，再合并成“总纲/索引页”。
- 结构化导出：把 entities/loadouts/steps 输出为 JSON/表格，供 Notion/Obsidian Dataview 使用。
- 版本差异追踪：同一攻略不同版本视频之间做 diff，标出“已过期/已改版”。
