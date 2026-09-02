# R1 桌面研究报告：市场工作流产品功能地图 v1

> 调研日期：2026-09-02
> 方法：官方文档/官网抓取（curl 原始 HTML 存 `docs/research/raw/`，去标签文本存 `docs/research/txt/`）
> 状态：**v1 可评审**；标注「待 R2 核实」的条目为 JS 渲染站点未抓全、以产品常识补充，需产品试用/真实浏览器复核。
> 关联方案：[workflow-module-expansion-research.md](./workflow-module-expansion-research.md)

---

## 0. 调研概况

### 0.1 抓取情况

| 结果 | 产品 |
|---|---|
| ✅ 已核实（文档/官网抓到实质内容） | n8n（节点分类/AI 目录）、Dify（节点与工作流）、Flowise（节点分类）、Airflow、Prefect、Dagster、AWS Step Functions、GitHub Actions、ComfyUI、Power Automate、BibiGPT、IFTTT、集简云、通义听悟、Camunda（部分） |
| ⚠️ 部分（JS 渲染/页面重定向，知识补充） | Coze/扣子、FastGPT、Langflow、Make 流控细节、Zapier Paths 细节、HiFlow、飞书妙记、DolphinScheduler |
| ❌ 失败 | NotebookLM（超时，知识补充） |

### 0.2 限制说明

- JS 单页应用（Coze/FastGPT/Make 帮助中心等）curl 拿不到正文，需要 R2 产品试用（真实浏览器）或换用其 GitHub 文档源核实。
- 本报告功能清单以「节点/模块名称 + 是否具备」为主，不展开每个参数的细节。

---

## 1. 分层产品功能模块清单

### L1 内容/AI 加工流（最直接对标）

#### 1.1 Dify（✅ 已核实，docs.dify.ai，2026-09-02）

- 两种应用形态：**Workflow**（一次运行，适合批量/自动化产出）与 **Chatflow**（对话式）。ScribeFlow 对标的是 Workflow 形态。
- 节点清单（官方导航）：Start（User Input / Trigger）、LLM、Knowledge Retrieval、Answer、Output、Agent、Question Classifier、If-Else、Human Input、Iteration、Loop、Code、Template、Variable Aggregator、Document Extractor、Variable Assigner、Parameter Extractor、HTTP Request、List Operator、Tool。
- Trigger 三类：**Schedule Trigger / Integration Trigger / Webhook Trigger**。
- 其他：Version Control（版本控制）、Snippets（片段）、Debug（调试）、发布为 Web App / MCP Server / Marketplace、监控 Dashboard/Logs/Annotation、Knowledge（创建/管理/测试检索/限流）、Model Providers、Tools、Custom Endpoint、成员与计费。
- **对 ScribeFlow 的关键信号**：条件分支（If-Else / Question Classifier）、参数抽取（Parameter Extractor）、文档抽取（Document Extractor）、变量聚合（Variable Aggregator）、列表操作（List Operator）、循环（Iteration/Loop）、代码节点、版本控制、调试、片段。

#### 1.2 n8n（✅ 已核实，docs.n8n.io，2026-09-02）

- 节点体系：**Trigger（触发器）/ Action（动作）** 两类操作；内置节点分 Core nodes（逻辑/调度/通用 API 等）、App nodes（外部服务）、Trigger nodes、Cluster nodes（root + sub-nodes 扩展）；支持 **Credentials（凭据库，加密存储）** 与 **Community nodes（社区节点，npm 分发）**。
- Build 文档目录揭示的能力模块：Flow logic（流程逻辑）、Work with data（数据处理）、Code in n8n（代码）、Integrate AI（MCP servers、AI components、LangChain、测试与改进 AI 工作流）、模板、执行历史（Executions list 调试）、共享工作流。
- AI 能力（目录）：连接 OpenAI/Anthropic/Google 等多家 LLM，加工具与记忆，单流多模型组合；LangChain 节点体系（Agent/Chain/Vector Store 等）。
- **对 ScribeFlow 的关键信号**：凭据管理、社区/自定义节点机制、执行历史调试、AI 组件化、子流程/Cluster 节点。

#### 1.3 Flowise（✅ 已核实，docs.flowiseai.com，2026-09-02）

- 节点=Integrations，分类：LangChain 系（Agents / Cache / Chains / Chat Models / Document Loaders / Embeddings / LLMs / Memory / Moderation / Output Parsers / Prompts / Record Managers / Retrievers / Text Splitters / Tools / Vector Stores）；LlamaIndex 系（Agents / Chat Models / Embeddings / Engine / Response Synthesizer / Tools / Vector Stores）；Utilities（Custom JS Function、Set/Get Variable、If Else、Sticky Note）；外部（Zapier Zaps）。
- **对 ScribeFlow 的关键信号**：变量节点（Set/Get Variable）、If Else、Custom JS Function、Sticky Note、缓存节点（Cache）。

#### 1.4 Coze/扣子（⚠️ 待 R2 核实，知识补充）

- 节点体系（公开资料）：开始/结束、LLM、知识库检索、插件、子工作流、代码、文本处理、表格处理、条件判断、循环（批处理/For/While）、变量赋值/聚合、意图识别、图像/语音处理、定时触发器、Webhook 触发器、消息节点、数据库、记忆、搜索、多路选择。
- 平台能力：Bot 商店/模板商店、发布到豆包/微信/飞书等渠道、工作流可被 Bot 调用。
- **对 ScribeFlow 的关键信号**：意图分类（可作为「自动选提示词」参考）、触发器（定时/Webhook）、模板商店形态。

#### 1.5 Langflow（⚠️ 待 R2 核实，知识补充）

- 组件化 LLM 流：Inputs/Outputs、Prompts、Models、Embeddings、Vector Stores、Tools、Memory、Agents、Retrievers、Text Splitters、Custom Components（Python）。
- 支持子流程（Subflow）与组件市场。
- **对 ScribeFlow 的关键信号**：子流程、组件市场、Python 自定义组件。

#### 1.6 FastGPT（⚠️ 待 R2 核实，知识补充）

- 节点：系统输入、插件、知识库搜索、AI 对话、指定回复、工具调用、代码运行、文本加工、判断器、循环、变量更新、HTTP、多路选择、意图分类。
- 能力：知识库（内容抽取）、工作流编排、对话、内容提取。
- **对 ScribeFlow 的关键信号**：知识库内容抽取、意图分类、变量更新。

### L2 通用自动化 iPaaS（借鉴编排基础）

#### 1.7 Zapier（✅ 部分核实：开发者文档 2026-09-02；功能知识补充）

- 已核实：9,000+ 应用连接；Zapier MCP（给 AI 客户端受治理访问 9000+ 应用）；SDK/CLI/Connectors；嵌入产品（Powered by Zapier / White Label）。
- 经典功能（知识补充，待 R2 用产品试用核实细节）：Zap（Trigger + Actions）、**Paths（分支）**、**Filters（过滤）**、**Webhooks**、**Transfer**（数据管道）、**Tables**、**Interfaces**、**Chatbots**、自动重试、执行历史、版本、团队共享。
- **对 ScribeFlow 的关键信号**：分支（Paths）与过滤（Filters）的极简交互；Webhook 触发。

#### 1.8 Make（✅ 部分核实：帮助中心首页 2026-09-02；流控细节知识补充）

- 已核实：错误处理（Error handling 独立模块）、Audit Log、Analytics dashboard、Scenario inputs、Marketplace 应用、模板、组织管理。
- 流控模块（知识补充）：**Router（路由器/分支）**、**Iterator（迭代器）**、**Aggregator（聚合器）**、**Repeater**、**Sleep/Delay**、**Error handlers（Commit/Rollback/Ignore/Resume/Break）**、**Filters**、**Get/Set Variable**、**Text parser / JSON / XML / CSV / HTTP / Webhook / Data store / Email**。
- **对 ScribeFlow 的关键信号**：路由器/聚合器语义（多路分支后聚合，ScribeFlow 模板三已具雏形但无显式节点）；错误处理路由；变量；延迟。

#### 1.9 Power Automate（✅ 已核实，Microsoft Learn，2026-09-02）

- 三类流：**Cloud flows**（automated/instant/scheduled 触发）、**Desktop flows**（RPA，网页与桌面自动化）、**Generative actions（preview）**——用自然语言描述意图，AI 选择并编排动作。
- **对 ScribeFlow 的关键信号**：Generative actions = 自然语言生成流程，是高级方向的重要对标。

#### 1.10 IFTTT（✅ 已核实，ifttt.com，2026-09-02）

- Applet = Trigger + Action；Services（Webhooks、X、YouTube、Discord、Google Sheets、Gmail 等）；支持带条件的过滤（如仅当带特定 hashtag 才执行）；IFTTT MCP（给 Claude/ChatGPT 等 AI 助手调用 1000+ 服务）。
- **对 ScribeFlow 的关键信号**：极简单触发-动作模型；MCP 化趋势。

#### 1.11 集简云（✅ 已核实，jijyun.cn，2026-09-02）

- 可视化流程搭建、1000+ 应用连接、内置应用做**数据格式转换、逻辑判断、循环执行、分支步骤、延迟处理**、团队协作与权限、流程分享复用、模板、等保加密。
- **对 ScribeFlow 的关键信号**：与 Make/Zapier 一致的「数据转换 + 逻辑 + 循环 + 分支 + 延迟」基础件。

#### 1.12 HiFlow（⚠️ JS 未抓全，知识补充）

- 腾讯云 iPaaS：连接器、触发/动作、模板、企业微信/腾讯系应用集成。
- 对 ScribeFlow 信号弱；仅作为国内连接器生态参考。

### L3 数据管道/调度（借鉴运行引擎）

#### 1.13 Airflow（✅ 已核实，3.3.1 文档，2026-09-02）

- Workflows as code（Python）；DAG：Schedule、Tasks、Task Dependencies、Callbacks、参数；Task SDK。
- 运行语义：手动触发、日志检查、任务状态监控、**backfill（回填）**、**rerun only failed tasks（只重跑失败任务）**。
- 优势：版本控制（代码化）、团队协作、可测试、可扩展 Operators。
- **对 ScribeFlow 的关键信号**：只重跑失败任务、回填（历史素材批处理）、回调、版本控制。

#### 1.14 Prefect（✅ 已核实，v3 快速上手，2026-09-02）

- @flow/@task 装饰器动态建图；**失败后从失败点恢复（resume from point of failure）**；动态并行 map；部署（deployments）、调度（cron schedule）、work pools、并发运行。
- **对 ScribeFlow 的关键信号**：断点续跑/从失败点恢复；动态 map（一对多并行）。

#### 1.15 Dagster（✅ 已核实目录，docs.dagster.io，2026-09-02）

- 资产视角：Assets、Asset dependencies、**Asset checks**（数据契约/测试）、**Partitions and backfills**、**Schedules / Sensors / Declarative Automation**、Resources、I/O managers、Jobs、Executors、并发管理、日志与调试、血缘（lineage）、告警（Dagster+）、洞察。
- **对 ScribeFlow 的关键信号**：资产检查（节点输出质量校验）、传感器/声明式自动化、分区与回填（素材批次）、血缘。

#### 1.16 DolphinScheduler（⚠️ JS 未抓全，知识补充）

- 任务类型丰富（Shell/SQL/Spark/HTTP/子流程等）、定时调度、失败重试、告警、可视化 DAG。
- 对 ScribeFlow 信号弱。

### L4–L8 其他层代表（借鉴点速览）

#### 1.17 AWS Step Functions（✅ 已核实，2026-09-02）

- 状态机：**内建错误处理、超时、并行**；**try/catch/retry**；**Map state 大规模并行**；**Variables + JSONata 数据变换**；状态管理与进度追踪；实时可审计执行历史；可视化操作台。
- **对 ScribeFlow 的关键信号**：状态机式错误分支；Map（一对多并行）；变量/JSONata 数据变换（无需代码节点）。

#### 1.18 Camunda 7（✅ 部分核实：docs 目录）

- BPMN 流程引擎：人工任务、审批、泳道、监听器、SLA、流程版本。
- 对 ScribeFlow 信号：轻量「人工确认节点」的语义参考；整体过重。

#### 1.19 GitHub Actions（✅ 已核实目录，2026-09-02）

- 工作流即 YAML；触发器事件丰富；**Variables / Contexts / Expressions**；**可复用工作流**；**矩阵策略（matrix，一对多变体）**；**依赖缓存**；**并发控制**；**部署环境与审批**；Secrets；可视化 graph；运行历史/日志/状态徽章。
- **对 ScribeFlow 的关键信号**：矩阵策略（同图多参数变体运行，类似「同一素材 × 多提示词」）、缓存、可复用工作流。

#### 1.20 ComfyUI（✅ 已核实，docs.comfy.org，2026-09-02）

- 节点式生成 AI；**Subgraph（子图）**、**Partial Execution（部分执行）**、Workflow Templates、自定义节点注册表、MCP/CLI/In-App Agent。
- **对 ScribeFlow 的关键信号**：子图、部分执行（=从某节点运行/单节点重跑的强化版）、模板工作流、自定义节点生态。

### L9 垂直笔记/AI 内容工具（直接竞品）

#### 1.21 BibiGPT（✅ 已核实，bibigpt.co，2026-09-02）

- 来源平台：B站、YouTube、抖音、小红书、快手、X、TED、Coursera、Khan Academy、Apple Podcasts、Spotify、小宇宙、喜马拉雅、任意含音视频的网页；本地文件 mp3/mp4/m4a/wav/srt/vtt/ass。
- 功能：**带时间戳摘要、章节大纲、思维导图、AI 对话追问、图文改写**；导出 **Notion / Obsidian / flomo**；MCP server / OpenAPI / NLWeb / Skill 四种 Agent 接口。
- **对 ScribeFlow 的关键信号**：来源平台广度（尤其播客/网页）、章节大纲、思维导图节点、第三方笔记导出、Agent 接口化。

#### 1.22 通义听悟（✅ 已核实，tingwu.aliyun.com，2026-09-02）

- 实时语音转文字、多语言翻译、1 小时音视频 5 分钟转写、**智能区分发言人**、**章节速览**、**待办事项提取**、会议纪要。
- **对 ScribeFlow 的关键信号**：说话人分离、章节速览、待办事项抽取。

#### 1.23 飞书妙记（⚠️ JS 未抓全，知识补充）

- 会议录制转写、**发言人识别**、**智能摘要/章节/关键词**、**会议待办**、全文检索、分享协作。
- 对 ScribeFlow 信号：章节、关键词、待办、检索。

#### 1.24 NotebookLM（❌ 抓取失败，知识补充）

- 多来源（文档/链接/粘贴）合成、**来源引用（citation）**、**音频概览**、笔记与问答。
- **对 ScribeFlow 的关键信号**：来源引用（信息溯源提示词块的增强方向）、多来源合成。

---

## 2. 14 维功能矩阵（L1–L3 代表产品 0/1/2 打分）

> 2=成熟/高级，1=基础具备，0=无或未发现。打分基于 R1 桌面研究；「待 R2」为知识补充项。

| 维度 | Dify | n8n | Flowise | Coze* | Zapier* | Make* | Airflow | Prefect | Dagster |
|---|---|---|---|---|---|---|---|---|---|
| 编排模型 | 2（DAG+循环+条件+子流） | 2（DAG+循环+条件+子流程） | 1 | 2 | 1（路径分支） | 2（路由/迭代/聚合） | 2（DAG+调度） | 2（DAG+map） | 2（资产 DAG） |
| 节点/连接器 | 1（20+ 固定节点） | 2（400+ + 社区节点） | 1（分类组件） | 2（节点+插件） | 2（9000+ 应用） | 2（2000+ 应用） | 2（Operators） | 1 | 1 |
| 触发器 | 2（定时/集成/Webhook） | 2（定时/Webhook/事件） | 0 | 2（定时/Webhook） | 1 | 2（定时/Webhook/事件） | 2（cron/事件） | 2（cron/事件） | 2（cron/传感器） |
| 数据流/类型 | 2（变量/JSON/列表操作） | 2（数据转换/表达式） | 1（变量/If） | 2 | 1 | 2（文本解析/变量） | 1（XCom/Jinja） | 1 | 2（资产/类型） |
| 运行引擎 | 2（重试/缓存/调试） | 2（重试/错误处理/执行历史） | 1 | 2 | 1（自动重试） | 2（错误处理路由） | 2（重试/回填/重跑失败） | 2（断点续跑/缓存） | 2（检查/回填） |
| 可观测性 | 2（Dashboard/Logs/标注） | 2（执行历史/日志） | 1 | 1 | 1（执行历史） | 2（Audit/Analytics） | 2（日志/监控/血缘） | 2 | 2（血缘/洞察） |
| 版本协作 | 2（版本控制） | 2（版本/共享） | 0 | 1 | 1（团队共享） | 1（团队） | 2（代码版本） | 1 | 2 |
| 工程管理 | 2（模板/片段/凭据） | 2（模板/凭据） | 1 | 2（商店） | 1（模板） | 2（模板/Data store） | 1 | 2（部署） | 2 |
| AI 能力 | 2（RAG/Agent/工具） | 2（Agent/LangChain/MCP） | 2（全套 LLM 组件） | 2 | 1（MCP/SDK） | 1（Make AI） | 1（agentic 负载） | 1 | 1 |
| 人工任务 | 1（Human Input 节点） | 1（人工触发/审批） | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 权限治理 | 2（成员/计费） | 2（用户/凭据） | 1 | 1 | 1 | 2（组织/审计） | 2 | 2 | 2 |
| 开发者体验 | 2（调试/API/SDK） | 2（API/CLI/代码） | 1（API/CLI） | 1 | 2（SDK/CLI） | 2（Dev Hub） | 2（代码即工作流） | 2（Python） | 2（Python） |
| 发布部署 | 2（Web App/MCP/Marketplace） | 2（自托管/云） | 1 | 2（多渠道发布） | 1 | 1 | 2 | 2 | 2 |
| 性能规模 | 1 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 |

\* Coze/Zapier/Make 标 * 行含知识补充，待 R2 核实。

---

## 3. ScribeFlow 差距分析 v1（R1 更新）

### 3.1 确认的「遗漏基础功能」（同类需求该有，多产品交叉验证）

| # | 功能 | 证据产品 | 对 ScribeFlow 的具体形态 |
|---|---|---|---|
| B1 | **条件分支** | Dify If-Else/Question Classifier；Make Router；Zapier Paths；集简云分支；Step Functions 状态机 | 「无文稿时跳过校对」「长视频走章节切分、短视频直接提炼」 |
| B2 | **失败重试策略** | n8n/Make/Airflow/Step Functions 全部内建 | 节点卡片加「最大重试次数/退避」，AI/ASR 超时自动重试 |
| B3 | **节点级缓存/断点续跑** | Prefect resume、Airflow rerun failed、ComfyUI Partial Execution、GitHub Actions 缓存 | 重跑时未变更的上游节点直接复用快照 |
| B4 | **文本/数据工具** | Make Text parser/JSON/XML；集简云数据格式转换；Dify Code/Template/List Operator | 查找替换、正则、模板渲染、字数统计、Markdown 格式化 |
| B5 | **章节切分** | BibiGPT 章节大纲、通义听悟章节速览、飞书妙记章节 | 转写稿 → 章节节点 → 输出带目录笔记 |
| B6 | **定时/自动触发** | Dify Schedule Trigger；Prefect cron；Power Automate scheduled flow | 订阅合集更新后自动跑 |
| B7 | **第三方导出** | BibiGPT Notion/Obsidian/flomo | 输出节点扩展：Notion/飞书/剪贴板 |
| B8 | **运行 diff/版本对比** | Dify 版本控制；GitHub Actions 历史；Airflow 代码版本 | 同工程两次运行对比（proposal P1 已有） |

### 3.2 确认的「高级功能机会」（差异化方向）

| # | 功能 | 证据产品 | ScribeFlow 切入方式 |
|---|---|---|---|
| A1 | **结构化抽取节点** | Dify Parameter Extractor；通义听悟待办提取 | 从转写稿抽 JSON（观点/术语/行动项）再渲染 |
| A2 | **RAG/知识库节点** | Dify/FastGPT/Flowise 全套 | 「结合我的历史笔记库」加工 |
| A3 | **多模型路由/对照** | n8n 多模型组合；GitHub Actions matrix | 同素材 × 多模型/多提示词矩阵运行（模板三升级） |
| A4 | **自然语言生成流程** | Power Automate Generative actions；n8n/Dify AI 方向 | 说「把这三个视频做成技术拆解笔记」自动搭图 |
| A5 | **轻量人工确认节点** | Dify Human Input；Camunda 人工任务 | 输出前人工改稿再导出 |
| A6 | **子流程/可复用片段** | ComfyUI Subgraph；n8n 子流程；Langflow Subflow；Dify Snippets | 把「校对+观点提炼」打包为片段复用 |
| A7 | **来源平台广度** | BibiGPT 30+ 平台/播客/网页 | YouTube/播客/网页文章/本地字幕(srt/vtt) |
| A8 | **Agent 接口化（MCP/OpenAPI）** | BibiGPT、Zapier、IFTTT、ComfyUI 均已 MCP 化 | 把 ScribeFlow 工程暴露为 MCP/API，供外部 Agent 调用 |

### 3.3 候选模块长名单 v1（评分后排序）

> 评分规则沿用方案 §6.1（1–5 分，价值/成本/契合/风险）。P0/P1/P2 为建议优先级。

| 优先级 | 候选模块 | 价值 | 成本 | 契合 | 风险 | 来源对标 |
|---|---|---|---|---|---|---|
| **P0** | 失败重试策略（节点配置） | 5 | 1 | 5 | 1 | n8n/Make/Airflow/Step Functions |
| **P0** | 条件分支节点 | 5 | 2 | 5 | 1 | Dify If-Else/Make Router/Zapier Paths |
| **P0** | 文本工具节点（查找替换/正则/模板/字数） | 5 | 1 | 5 | 1 | Make/集简云/Dify Template |
| **P0** | 章节切分节点 | 5 | 2 | 5 | 2 | BibiGPT/通义听悟/飞书妙记 |
| **P1** | 节点级缓存/断点续跑 | 5 | 3 | 5 | 2 | Prefect/Airflow/ComfyUI Partial |
| **P1** | 定时触发（合集更新自动跑） | 4 | 3 | 4 | 2 | Dify Schedule/Prefect cron |
| **P1** | 结构化抽取节点（JSON） | 4 | 2 | 5 | 2 | Dify Parameter Extractor |
| **P1** | 第三方导出（Notion/飞书/剪贴板） | 4 | 2 | 4 | 2 | BibiGPT/集简云 |
| **P1** | 运行 diff | 3 | 2 | 5 | 1 | Dify 版本控制/GitHub Actions |
| **P1** | 来源平台扩展（YouTube/播客/网页/srt） | 4 | 3 | 5 | 3 | BibiGPT |
| **P2** | 子流程/可复用片段 | 4 | 3 | 4 | 2 | ComfyUI Subgraph/n8n/Dify Snippets |
| **P2** | 多模型路由/矩阵对照 | 3 | 3 | 4 | 2 | n8n/GitHub Actions matrix |
| **P2** | 轻量人工确认节点 | 3 | 2 | 3 | 2 | Dify Human Input/Camunda |
| **P2** | RAG/知识库节点 | 5 | 4 | 3 | 4 | Dify/FastGPT/Flowise |
| **P2** | 自然语言生成流程 | 4 | 4 | 3 | 4 | Power Automate Generative actions |
| **P2** | webhook 触发 | 3 | 2 | 3 | 2 | Dify/n8n/IFTTT |
| **P2** | Agent 接口化（MCP/OpenAPI） | 3 | 3 | 4 | 2 | BibiGPT/Zapier/IFTTT |

### 3.4 关键结论

1. **基础件高度一致**：条件分支、失败重试、文本/数据转换、定时触发在 L1/L2/L3 产品中全部存在，属于「工作流产品的默认能力」。ScribeFlow 缺这些会被视为残废，建议作为下一里程碑 P0。
2. **运行引擎的「缓存/断点续跑」是被低估的高价值项**：Prefect 的 resume、Airflow 的 rerun failed、ComfyUI 的 Partial Execution 指向同一需求——长链路重跑不要从头算。ScribeFlow 的「视频→转写→AI→输出」链路完全适用（转写最贵）。
3. **垂直竞品 BibiGPT 的功能面比预想更广**：30+ 平台来源、章节大纲、思维导图、AI 对话、第三方导出、MCP 化，且已做成 Agent 接口。ScribeFlow 的差异化应落在「画布可编排 + 逐节点产物可见 + 工程可保存复用」，而不是与其拼平台覆盖。
4. **RAG 与自然语言生成流程维持 P2**：价值高但会把产品拉向 Dify 路线，与「笔记加工画布流」定位有张力，需专门立项论证。

---

## 4. 待验证清单（R2 产品试用/真实浏览器）

| 产品 | 待核实内容 | 建议方式 |
|---|---|---|
| Coze/扣子 | 工作流节点完整清单、触发器类型、模板商店 | 注册试用 |
| FastGPT | 节点清单、知识库内容抽取细节 | 试用或读 GitHub 文档源 |
| Langflow | 组件目录、子流程、组件市场 | 读 docs / 试用 |
| Make | 流控模块（Router/Iterator/Aggregator/Error handlers）细节 | 帮助中心或试用 |
| Zapier | Paths/Filters/Webhooks/Transfer 当前形态 | 试用或官方 product 页 |
| HiFlow / 飞书妙记 / DolphinScheduler | 功能清单 | 浏览器访问 |
| NotebookLM | 来源引用/音频概览细节 | 浏览器访问 |

---

## 5. 证据目录

- 原始 HTML：`docs/research/raw/*.html`（27+ 个页面，2026-09-02 抓取）
- 去标签文本：`docs/research/txt/*.txt`
- 抓取脚本：`docs/research/fetch.ps1` / `fetch2.ps1` / `fetch3.ps1` / `strip.ps1`
