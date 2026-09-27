---
title: 全项目审计（2026-09-27）：七个区域逐文件走过一遍
class: research
owner: 念前
last_reviewed: 2026-09-27
---

# 全项目审计（2026-09-27）

这份报告不做取舍，只做两件事：**说清哪些文件真的被逐行读过**，以及**把发现按"会不会让用户拿到错结果"排序**。
之前的几轮评述只覆盖了缺口清单里已有的条目，这次是独立把七个区域走完的结果。

## 0. 怎么读这份报告

**分级按后果，不按代码风格**：

| 级别 | 含义 | 处理建议 |
| --- | --- | --- |
| A | 会静默产出错结果，或把失败报成成功 | 优先修，且每个都该配一条回归用例 |
| B | 数据一致性、资源泄漏、凭据与文件安全 | 排期修；有两条涉及凭据，建议先修 |
| C | 前端可用性与性能，用户能感觉到但不至于出错 | 按体感排序修 |
| D | 契约与可维护性，今天不痛但会让下一个改动踩坑 | 顺手修，别专门排期 |

**验证状态标记**（重要，请勿混用）：

- 【复核】= 我自己读了源码或跑了最小验证，可以当作事实
- 【报告】= 子代理逐行读代码后报告的，我**没有**逐条复核；引用前建议先看它给的 `文件:行号`
- 涉及数字的，标注是实测还是推导

**与 `docs/status.md` 的关系**：那份清单里的条目本文不重复论证，只在 §6 给"是否成立 + 实际后果是否更重"的复核结论。

## 1. 覆盖地图

| 区域 | 文件 | 读全否 | 读的人 |
| --- | --- | --- | --- |
| 运行引擎 | `lib/engine.ts`(2216)、`recipe.ts`、`restore.ts` + 7 个引擎测试 | 读完 | 子代理 |
| 外部集成 | `lib/` 的 bilibili/ai/media/media-store/nutstore/traceExternal/mindmap/drill + `routes/` 的 auth/bilibili/media/nutstore/files + 6 个测试 | 读完 | 子代理 |
| 路由与数据 | `routes/` 的 projects/runs/folders/prompts/settings/docs/health + `db/` + `app.ts`/`index.ts`/`env.ts` + `lib/settings.ts`/`lib/docs.ts` | 读完 | 子代理 |
| 前端画布 | `components/canvas/` 全部（FlowCanvas 924、ScribeNode 2849、8 张卡片、SourcePickerDialog 887…）+ `utils/flow.ts` + `stores/projects.ts` + `useSegmentPick` + `dropdown-modal` | ScribeNode 的 1385 行样式只做定向抽查 | 子代理 |
| 前端结果页 | `views/RunDetailView.vue`(3421)、RunLogDialog、TraceReportViewer、DrillViewer、MindMapViewer、DiffViewer、PromptBlockDiffDialog、MediaPlayer + `utils/run-segments`、`utils/drill`、`lib/markdown`、`lib/run-meta` | 读完 | 子代理 |
| 前端外壳 | `components/workspace/` 全部 + `views/SettingsView`(1641, 正文)/`HomeView` + `SettingsDialog`/`DocsDialog`/`ModelSelect`/`ToastStack` + `layouts`/`router`/`main` + `stores/` 全部 + `lib/api|sse|toast` + `components/auth/` | SettingsView 的 573 行样式只抽查 | 子代理 |
| 契约层 | `packages/shared/src/` 全部 23 个文件 + 6 个测试 + `scripts/docs-gen.mjs` | `prompt.ts` 的纯提示词正文段落抽查 | 子代理 |

**没被覆盖**：`apps/server/src/routes/videos.ts`、`apps/web/src/styles/*` 的逐行内容、`scripts/` 除 docs-gen 外的门禁脚本、`docs/` 正文。
**上面所有子代理都没有改动任何文件**，我复核时也没有。

---

## 2. A 级：会静默产出错结果，或把失败报成成功

### A1 素材挑选在"中间隔了模块"时完全不生效，且不报错【复核】

- **证据**：引擎按**直接上游节点 id** 查表：`engine.ts:976` 的 `passesPick(pick, item.sourceNodeId, item.itemKey)`，而 `item.sourceNodeId` 来自 `resolveInputs` 遍历 `edge.target === node.id` 得到的**紧邻上游**。
  前端写入端却一路追到**来源卡**当键：`packages/shared/src/segment.ts:212-219` 的 `collectSegmentOptions` 对非来源节点继续沿入边 `visit(edge.source)`，返回的 `originNodeId` 始终是来源卡；`useSegmentPick.ts` + `PickCard.vue` 直接用它当 key 写进 `data.pick`。
- **触发**：来源卡与挑选节点之间隔任意一个模块（例如 `source.bili`(8 个素材) → `process.transcribe` → 挑选）。此时运行时查 `pick[transcribeId]` → `undefined` → `passesPick` 直接 `return true`（`segment.ts:45-48`）。
- **后果**：8 段全下载、全转写、全加工，而用户以为只选了 1 段；因为没有排除项，连"已跳过 N 段"那行日志都不会出现（`engine.ts:979` 只在 `excluded.length > 0` 时写）。**这是一条纯烧钱、纯烧时间的静默失效**。
- **为什么测试没拦住**：`engine.pick.test.ts` 与 `engine.picknode.test.ts` 的运行用例都是**来源直连挑选节点**，恰好落在能工作的那一侧。
- **修法**：把键统一到一套命名空间。要么引擎按"身份链的最上游来源"查（复用 `pairItemKeys` 的思路），要么前端在写入时同时写上直接上游的键。更稳的是后者改成前者：**消费端与生产端必须共用同一个函数**，并补一条"隔一个模块"的回归用例。

### A2 工程图成环时运行报「成功」，所有节点标「skipped」且理由写错【复核】

- **证据**：`engine.ts:621` 的 `while (done.size + failed.size < active.order.length)`，环上两节点互相等待依赖（`isReadyToRun` 对 A 要求 B 已 done，反之亦然），`ready` 为空 → `engine.ts:635` 的 `if (running.size === 0) break` 退出循环 → `engine.ts:647-651` 把未执行节点标成 `skipped`、理由写死为"上游失败，跳过" → `engine.ts:669` 的 `finishRun(active, failed.size > 0 ? "error" : "success", …)`，而 `failed` 为空 → **success**。
- **可达性**：`packages/shared/src/schema.ts:173-208` 的 `superRefine` 只查重复 id、悬空引用、端口存在、自环，**不查环**；前端 `FlowCanvas.vue` 的 `validateConnection` 同样只挡自环与端口兼容。导入一份含环 JSON 也能落库（`routes/projects.ts:166`）。
- **附带**：同一段代码下，**空画布点运行**也报 success（`order.length === 0` 时 while 一遍都不跑就直接 `finishRun("success")`，`summary` 为 undefined）。
- **修法**：`parseGraph` 里补一次拓扑排序做环检测（有环就 400 并指出环上的节点），引擎侧再加一道"若 break 时仍有未 done 节点，则 runError 至少写明'存在无法满足的依赖（可能是环）'"。

### A3 自定义提示词块在运行时完全不生效【复核】

- **证据**：`engine.ts:1377` 只做 `BUILTIN_PROMPT_BLOCKS.find((b) => b.id === blockId)`，`grep promptBlocks apps/server/src/lib/engine.ts` **零命中**（引擎从不查 `prompt_blocks` 表）。而前端下拉把自定义块也列进去了：`stores/prompts.ts:10` 的 `allBlocks = [...BUILTIN_PROMPT_BLOCKS, ...customBlocks]`，`ScribeNode.vue:715-724` 的 `promptOptions` 直接用它。
- **触发**：设置页新建自定义块 → 在 AI 加工节点里选中它 → 运行。`builtin` 为 undefined，`system` 落到 `engine.ts:1377` 后面那行的兜底文案（"你是内容编辑。按用户要求整理文稿…"）。
- **后果**：`docs/usage.md` 明确教的操作路径是**空操作**；用户写的提示词一个字都没进请求，而界面上、日志里都不会报错（日志记的是兜底的 system）。
- **修法**：run 启动时把该节点引用的自定义块内容一起下发，或引擎查库（注意后者要把块内容按 run 快照固定下来，否则改块会影响历史运行的复现）。

### A4 四条引文断言恒真（路径写法在标量叶子上多写了 `[]`）【复核】

- **证据**：`packages/shared/src/prompt.ts` 里 6 条 `citationsInOriginal` 断言，其中 4 条写成 `items[].evidence[].quote[]`（:305、:352）与 `points[].sourceQuote[]`、`items[].sourceQuote[]`（:999、:1000）；`quote`/`sourceQuote` 本身是**字符串**而不是数组。
  机制在 `apps/server/src/lib/recipe.ts:77-90` 的 `tokenizePath`：末尾 `[]` 被解释为"这个叶子是数组"，`collectFieldStrings` 遇到非数组就 `return`，什么都不收集。
- **后果**：这 4 条断言收集到空列表 → 0 条超限 → 判通过（`recipe.ts:206-212` 的循环不会进）。**编造的引文可以一路进产物**。对照组是写得对的 `blocks[].quotes[]`（:501、:651，`quotes` 确实是数组）。
- **修法**：删掉这 4 条路径末尾的 `[]`，并补一条"给一份含编造引文的输出，断言必须失败"的用例锁住。

### A5 B 站单链接卡切换分 P 后，段键与运行时不一致【复核】

- **证据**：`packages/shared/src/segment.ts:135` 单链接卡的键用 `Number(data.page ?? 1)`；而 `packages/shared/src/schema.ts:45-56` 的 `bili` 分支**没有 `page` 字段**（只有 `pageInfo`），Zod 默认 strip → `data.page` 永远是 `undefined` → 前端算出的键永远是 `:1`。
  引擎运行时却用 `engine.ts:1271` 的 `Number(pageInfo?.page ?? 1)`。
- **触发**：单链接卡用「点行切换」切到 P2 以上（UI 只写 `pageInfo.page`），把它与别的卡放在一起挑选，并只勾中它 → 运行时查的是 `…:3`，pick 里存的是 `…:1` → 不匹配。
- **后果**：用户明确"只保留这一段"，结果该素材被判为"未被任何下游节点选中"而跳过（`engine.ts:1271` 之后的 `isSourceOutputNeeded` 分支），或整条链路报"素材挑选没有选中任何素材"。同时 `engine.ts:165` 的历史身份还原也永远算成 page 1。
- **修法**：二选一，但要一致：把 `page` 加进 `schema.ts` 的 bili 分支（并让 UI 也写它），或统一改用 `pageInfo.page`。

### A6 产物超过 20 万字符不落库，于是"全量能跑、重跑报没输入"【复核】

- **证据**：`engine.ts:45` 的 `MAX_INLINE_TEXT = 200_000`，`engine.ts:2039` 写库时 `outputText: output.text.length <= MAX_INLINE_TEXT ? output.text : undefined`；从历史取数的 `previousOutputs` 在 `engine.ts:819` 直接 `text: row.outputText ?? undefined`。
- **触发**：任一转写/合并产物超过 20 万字符（长合集、多个长视频合并）→ 之后用「从此节点运行」或单节点重跑。
- **后果**：下游节点以"没有可用的文稿输入"失败，而**真实原因（正文被长度闸门丢弃）在节点错误、日志、界面上都没有痕迹**，报错指向的下游节点是无辜的。全量运行不受影响（内存里是原值）。
- **修法**：取数时若 `outputText` 为空但 `outputPath` 有值，就从文件读回来（`outputPath` 已经存了）。

### A7 「从此节点运行」在多输入场景会静默只处理第一条或把多份压成一份【报告】

- **证据**（子代理给出，我未复核）：`engine.ts:774-780` 的还原名单只有 5 种类型（转写/校对/AI加工/攻略/练一练），`flow.pick` 与 `process.text` 不在其中 → 它们被当整体产物，走 `engine.ts:819` 返回**一份**合并文本（`combineOutputs` 以 `"\n\n---\n\n"` 拼接）；而这两个类型恰恰是 `AGENTS.md` 硬规则 6 点名的「一个输入一份结果」节点。
  另一条：转写成功后 `engine.ts:1068-1070` 把音频输入行改写成文本行（`kind: "text"`），而 `engine.ts:802-808` 还原来源音频时只查 `kind = "audio"` 的行 → 多选来源重跑时只剩兜底的**单个主输出**（`engine.ts:1104` 的 `outputs[0]`）。
- **后果**：违反项目自己的硬规则 6（多输入不静默丢弃），且摘要不点明。
- **验证方法**：在 `engine.partial.test.ts` 的 fromNode 用例里把图改成 `两路文本 → process.text → output`，断言下游拿到的是两份。

### A8 确定性解析失败被当成可重试，跑满 3 次完整 LLM 调用【报告】

- **证据**（子代理，我未复核）：`engine.ts:54` 的不可重试黑名单里有「不是**合法** JSON」，但 `process.chapter`（`engine.ts:432`）与 `process.mindmap`（`mindmap.ts:50`）抛的是「不是**有效** JSON」；这两个类型都在 `RETRYABLE_NODE_TYPES`（`engine.ts:48`）里，默认 `maxRetries = 2`（`engine.ts:1136`）。
- **后果**：可预测的失败也会花 3 倍 token 与时间（输入是整篇文稿，单次超时 300s）。黑名单机制意味着**任何新写的确定性错误文案都会默认重试**。
- **修法**：把"是否可重试"从文案判断改成错误类型（例如 `NonRetryableError` 类），或至少把关键词改成结构化标记。

---

## 3. B 级：数据一致性、资源与安全

### B1 未认证请求即可把库里保存的坚果云应用密码发往任意主机【报告，子代理称已用本地 mock 实测】

`routes/nutstore.ts:101-110` 的 `POST /api/nutstore/test` 把请求体里的 `serverUrl` 与**回落自库里的** `account`/`password` 拼起来调 `lib/nutstore.ts:123` 的 Basic 认证头。攻击者只需一次 POST 并自带 URL，不需要先改设置。
**同形还有一处**：`routes/settings.ts` 的 `/test/asr`（`resolveAsrTestConfig` 同样是"请求体 baseUrl + 已存密钥回落"）。`docs/status.md` 只记了 `/test/ai` 那一处。
**修法**：测试连接的接口只接受"本次请求里显式提供的凭据"，不允许回落已保存的密钥；或对这类接口要求一个本地令牌。

### B2 工程图里的 `filePath` 可越出数据目录读任意文件【复核了校验缺失，外泄链未复核】

`packages/shared/src/schema.ts:50` 的 `filePath: z.string().optional()` 只校验类型；`engine.ts:1312` 直接 `resolve(this.dataDir, filePath)`。配合可改的 `asr.baseUrl` 与无鉴权的 `GET /api/media/:id/download`，构成"读任意文件 + 外泄"的链路。
`docs/status.md` 的路径条目只提了媒体前缀比较、`runs.ts:312/325`、`outputDir` 写出，**没有这条读路径**。
**对照**：`lib/docs.ts:127-148` 是同一个仓库里写对的示范（`path.relative` 判包含性 + `realpath` + 强制前缀）。把那段抄过来即可。

### B3 上传先整段缓冲进内存，再判断大小上限【报告，子代理实测 RSS 58MB → 1465MB】

`routes/files.ts:13` 的 `await c.req.formData()` 先把整个 multipart 物化，`:27-29` 才比较 `file.size`。默认上限 2048MB（`env.ts:21`），因此一次未认证的约 2GB 上传会把 RSS 推到约 4GB，超限请求同样先付内存再拿 413。
**修法**：改成流式写盘并在写入过程中累计字节数，超限即中断。

### B4 `MAX_UPLOAD_MB` 写成非法值会让上限静默失效【复核】

`env.ts:21` 的 `Number(process.env.MAX_UPLOAD_MB ?? 2048)` 不做校验；写成 `MAX_UPLOAD_MB=2G` 得到 `NaN`，`files.ts:29` 的 `file.size > NaN` 恒为 false → 任何大小都通过（连报错文案都会渲染成 `NaNMB`）。同类：`env.ts:16` 的 `PORT` 同样不校验。

### B5 媒体 GC 与在途下载竞态会留下永久孤儿文件【报告】

`media-store.ts:489-497`：`status === "restoring"` 时保护文件不删，但**照样删 DB 行**；在途的 `downloadIntoAsset` 随后 `rename` 落盘成一个已无 DB 行的 `.mp4`。GC 只按运行引用查找，没有全局清扫入口，这个文件永远清不掉。
同一处根因还有一半：`ensureBiliVideoAsset` 先落行落盘、`attachRunMedia` 后挂引用，中间失败同样留下永不进任何 `run_media` 的资产。

### B6 `restoring` 是永久粘滞态，引擎永不重试【报告】

`media-store.ts:149`：命中 `status === "restoring"` 就直接返回，而 `db/client.ts` 的启动恢复只扫 `runs`/`run_node_results`，**从不碰 `media_assets`**。下载途中进程被杀 → 之后每次带 `keepVideo` 重跑都返回 restoring，文件永不落地，只有结果页的手动「重新下载」能救。

### B7 删除运行/工程与"尚未收尾的运行"竞态 → 孤儿行 + 残留视频【报告】

`routes/runs.ts` 的删除守卫只看 `runs.status === "running"`；`forceStop` 之后 `runLoop` 仍在内存里收尾并继续写 `run_node_results`/`run_node_logs`，于是为已删除的运行重建行。若此时 `keepVideo` 的下载还在跑（`ensureBiliVideoAsset` 不收 `AbortSignal`），视频落盘后 `run_media` 引用写进一个不存在的 run → 几百 MB 永久占盘。

### B8 删文件夹不重排被移出工程的 position → 同层撞号【报告】

`routes/folders.ts:194-198`：只把 `folderId` 置空，不重排 `position`。根层级原本 1/2/3，文件夹里也是 1/2/3，删掉文件夹后 6 个工程两两撞号，而前端按 `position` 排。

### B9 其它一致性与资源项【报告】

| 项 | 证据 | 后果 |
| --- | --- | --- |
| 进程内 Map 只增不减 | `routes/media.ts:27` 的 `jobs`；`routes/auth.ts:11` 的 `qrKeys`（只在有人轮询时清） | 反复恢复媒体/反复申请二维码会无界增长 |
| `graph-backups` 无入口可见、无清理 | `routes/projects.ts:76-95` 每工程留 20 份整图；`settings.ts:226-237` 只统计 `outputDir` | 隐性磁盘占用，用户在清理页看不到 |
| 导入工程不过 `cleanGraph` | `routes/projects.ts:166-184`（其余三条写路径都过） | `status`/`summary` 可被导入文件写进库，违反硬规则 7；因读取侧都 clean，**不可见** |
| 无 SIGTERM 处理 | `index.ts` | 容器重启把运行留在 running，只能靠下次启动的恢复兜底 |
| 启动类失败一律 400 | `routes/runs.ts:137-139` | "工程不存在""重复启动"都被报成客户端请求非法，前端无法区分该不该重试 |
| `previousOutputs` 全量取 runs + 无界 IN | `engine.ts:758-772` | 每个节点每次输入解析都跑一遍；IN 长度 = 该工程运行总数，越过 SQLite 变量上限会直接抛错 |
| `/api/runs` 顺带把全部工程的完整 graph 读进内存 | `routes/runs.ts:168` | 只为了拿工程名，读放大很多 |
| 日志表存 AI 请求与响应全文 | `engine.ts:1454-1459` | 单次 `GET /:id/logs` 可能读几 MB |

---

## 4. C 级：前端可用性与性能

| # | 现象 | 证据 | 验证状态 |
| --- | --- | --- | --- |
| C1 | 离开工程页时最后 500ms 内的编辑永久丢失（自动保存有防抖，卸载时不 flush，只有 startRun 前 flush） | `ProjectEditorView.vue:158-164`、`:249-281` vs `:521-530` | 【报告】 |
| C2 | 文本工具的每个字符都提交一次撤销历史并整图深拷贝 | `ScribeNode.vue:803` 的 `patchTextTool` 内 `patch` + `commit`；`TextToolCard.vue:32/47-79` 直接 `@update:model-value` 调它；子代理实测单次深拷贝 1.61ms（1MB 图）/5.62ms（3.86MB 图） | 【复核了链路，毫秒数为子代理实测】 |
| C3 | 撤销会一次性清掉所有节点的运行结果显示（记录还在，只是不再显示），并把视角一起回滚 | `utils/flow.ts:161-165/186` 剥运行态但把 viewport 放进快照；`FlowCanvas.vue:591-597` 恢复时只重建节点 | 【报告】 |
| C4 | Backspace/Delete 只挡输入框、不挡按钮 → 焦点在按钮上时误删节点 | `FlowCanvas.vue:616-617`（只判 INPUT/TEXTAREA/SELECT/contentEditable）、`:638-640` | 【报告】 |
| C5 | 分段下拉箭头的 `ChevronDown` 没 import，渲染成未知元素（`pnpm typecheck` 不报） | `ScribeNode.vue:1363` 使用；`:5` 只 import 了 `CircleAlert`；`main.ts` 无全局注册 | 【复核】 |
| C6 | 打开工程即对每张 B 站卡发解析请求，并把远端当前值写回工程图，必要时把分 P 静默改回 P1 | `ScribeNode.vue:335-338` 的 `onMounted`、`:108-137` 的 `patch({pageInfo})`；`FlowCanvas.vue:478-486` → `ProjectEditorView.vue:234-237` 触发自动保存 | 【报告】 |
| C7 | 200 节点上限可被 Ctrl+D 绕过；正文的 50000 字只是计数器（无 `maxlength`，schema 与引擎都不校验） | `FlowCanvas.vue:406-411` 有检查 vs `:425-443` 的 `duplicateNodes` 无检查；`ScribeNode.vue:1119` vs `:1123` | 【报告】 |
| C8 | 素材选择器打开时对同一份列表发 3 组重复请求，且无序号/取消保护 → 慢响应会覆盖新结果 | `SourcePickerDialog.vue:277-305`、`:192-215`、`:268-275` | 【报告】 |
| C9 | 结果页的过期响应会覆盖新数据（令牌只在校验点之前查一次） | `RunDetailView.vue:953-964`、`:1074-1087`、`:1146-1156` | 【报告】 |
| C10 | run 不存在或首次加载失败 → 永久停在"加载中…"，无错误文案与重试入口 | `RunDetailView.vue:1430` 与 `:1432` 之间缺 else 分支 | 【报告】 |
| C11 | 取产物失败被显示成"本次运行没有可展示的文本产物" | `RunDetailView.vue:1080-1083` 的 catch 把 `markdown` 置空 + `:1873-1879` | 【报告】 |
| C12 | 目录 id 与正文锚点 id 是两套实现（一个用源 Markdown、一个用渲染后文本），标题含链接时点目录不跳转 | `RunDetailView.vue:281-295` vs `lib/markdown.ts:4-18` | 【报告】 |
| C13 | 练一练的全局 keydown 监听跨面板生效：切走后按 Enter/数字键仍会改答题状态 | `DrillViewer.vue:261`、`:242-259` | 【报告】 |
| C14 | 任何元素全屏都会让播放器以为自己在全屏 → 结果页全屏阅读时播放器塌成 0 高 | `MediaPlayer.vue:302` + `:683/691/700` 的 CSS 分工 | 【报告】 |
| C15 | 切到其它 tab 后视频继续播放（四个面板用 `v-show`，DOM 不卸载，也没有同步暂停） | `RunDetailView.vue:1434/1483/1512/1541` | 【报告】 |
| C16 | 5 秒轮询失败完全静默；轮询无并发控制，慢响应会乱序回写 | `stores/runs.ts:22-33`、`AppLayout.vue:36` | 【报告】 |
| C17 | 批量移动/删除部分失败既不报错也不刷新列表（`Promise.all` 后置的 `loadList` 被跳过） | `stores/projects.ts:191/200/205-212/215-219` | 【报告】 |
| C18 | 轮询把同一批新运行**反向**插入工程缓存，列表不再是时间倒序 | `stores/runs.ts:35-45` 的 `unshift` | 【报告，子代理做了逻辑复现】 |
| C19 | 删除某工程最后一条运行后，该工程缓存键被丢弃但 `loadedProjects` 仍为 true → 运行面板永久显示"没有运行记录" | `stores/runs.ts:69-74` | 【报告】 |
| C20 | 错误 toast 永不自动消失、无去重与上限；堆多了旧条目的关闭按钮在视口之上点不到 | `lib/toast.ts:21-26/43`、`ToastStack.vue:110-125` | 【复核（我在浏览器里见过 6 条堆积跨页面不消失）】 |
| C21 | 部分失败的操作被包成绿色"操作成功"toast（标题成功、正文才提失败条数） | `SettingsView.vue:529-531`、`:552-554` | 【报告】 |
| C22 | "保存设置"被一个与保存无关的模型列表请求阻塞，最长 30s 且按钮无 loading | `SettingsView.vue:373` → `routes/settings.ts:158` → `lib/ai.ts:49` | 【报告】 |
| C23 | 运行记录面板整体不可键盘操作（行无 tabindex/role，也没有替代入口） | `RunRow.vue:86-92`，对比 `ProjectItem.vue:270` 有 | 【报告】 |
| C24 | 四个浮层声明 `aria-modal="true"` 但不移焦、不困焦、不还焦 | `RunLogDialog.vue:361-364`、`PromptBlockDiffDialog.vue:169-172`、`DocsDialog.vue:301`、`SettingsDialog.vue:30` | 【报告】 |

---

## 5. D 级：契约与可维护性

### D1 节点类型 × 声明位置矩阵（子代理逐格核对，前四列有机器保证）

16 种节点类型在**类型联合 / 标签 / 端口 / 卡片宽度 / data 校验 / 模板预设 / 文档生成**这七处**全部 16/16 齐备**，且 `Record<NodeType, …>` 的类型完备性 + `scripts/docs-gen.mjs` 的三表同集断言 + `docs:lint` 三重保证。**这一层是整个仓库做得最扎实的地方。**

缺口都在 shared 之外（这些位置同样"每个节点类型要声明一遍"，但没有完备性保证）：

| 位置 | 覆盖 | 缺口 |
| --- | --- | --- |
| `utils/flow.ts` 的 `emptyNodeData`（新建默认值） | 16/16 | 靠 TS 返回值完备性兜住 |
| `ScribeNode.vue` 的卡片分派链 | 16/16 | 末位无 `v-else`，将来新增类型会静默渲染空卡片 |
| `ScribeNode.vue` 的 `typeIcon` | **15/16** | 漏 `flow.pick` 且无 default → 该卡片无图标（调色板里有） |
| `ScribeNode.vue` 的 `canViewOutput` | **12/16** | 缺 4 个类型 → 悬停预览静默不可用 |
| `NODE_CARD_WIDTH["flow.pick"]` | **264 ≠ CSS 280** | 注释声称与 CSS 一致，但没有脚本校验；布局按 264 算，实际 280 |
| 合并/输出的高级设置会露出「失败重试」 | — | 但 `RETRYABLE_NODE_TYPES` 不含它们 → 填了不生效 |

### D2 其它契约项

| 项 | 证据 | 说明 |
| --- | --- | --- |
| Zod 默认 strip，前端字段名拼错静默失效 | `schema.ts` 无任何 `.strict()` | `page` 就是这样丢的（A5）；UI 改名或引擎加字段而忘了同步 schema，表现是"设置没反应"而不是保存失败 |
| `graphSchema` 不校验端口兼容性 | `schema.ts:198-206` 只判端口存在与自环，从未调 `canConnect` | 非法连线可入库；且 `NODE_PORTS["process.merge"]` 只收 `noteBlock`，而引擎与测试都在喂 `transcript`，两处口径不一致 |
| `schemaVersion` 无迁移分支 | `graph.ts:255`/`schema.ts:168` 都是 `literal(1)`，全仓无按版本的读点 | 格式一改，旧文件导入直接 400；该字段目前给人"有版本治理"的错觉 |
| 填空多空答案只判第 0 空 | `drill.ts:422` 收下全部答案，`:510-513` 只比 `answer[0]` | 多空题从第 2 空起是死数据，用户填对也判错；而导出 Markdown 会把两空都打印出来 |
| 出题预算与解析上限不一致 | 提示词「每点 1-3 题」× `pointCount ≤ 12` = 最多 36 题，`drill.ts:103` 的 `MAX_ITEMS = 20` | 设 `pointCount: 12` 时近一半产出被静默丢弃（还会连坐"该知识点没有通过校验的题目"） |
| drill 字数声明与执行不一致 | 声明 20/60（`drill.ts:45-47` + 提示词），执行 `clip(name,40)`/`clip(gist,120)` | 排版按哪一份都说不清 |
| 配方模板变量无白名单 | `apps/server/src/lib/recipe.ts:24-31` 只替换已知变量，其余 `{{…}}` 原样保留 | 拼错一个字母 → 字面量直接进 system，无报错 |
| 同一常量被多个块名共享 | `builtin.insight = builtin.insight.v3`、`builtin.trace = builtin.trace.v2`、`builtin.gameguide = builtin.gameguide.v2` | 块名与 `prompt` 字段语义不符；把 `.v2` 挂到非配方节点会退回块自己的旧版式 |
| 两份人工同步的 DDL | `db/schema.ts` 与 `db/client.ts` 的 `ensureSchema`；`run_node_logs.step/input_index` 只在 ALTER 里 | 给 schema.ts 加列忘了加进补列逻辑，tsc 不报错，第一次查该列才炸 |
| `foreign_keys = ON` 但零外键声明 | `db/client.ts:13` + DDL 里零 `FOREIGN KEY` | 级联全靠手写，漏一条就是孤儿（B7 就是） |
| 死导出 | `isSourcePicked`、`hasAnyPick` 在 apps 与测试里零引用；`groupSegmentOptions`/`isValidConnection`/`parseRecipe`/`normalizeClozeAnswer` 只被测试引用 | `index.ts` 全是 `export *`，实现细节也在公共面上；`knip` 把 exports 设成 warn 所以不红 |
| `trace.ts` 用 `---` 切分报告 | `trace.ts:269` 按 `/\n?\s*---\s*\n?/` 切 | JSON 字符串值里出现 `---`（如 `"第 1---3 章"`）就会把报告切碎，两半都解析失败后整份被丢弃 |
| 未知字段静默丢弃 | 所有写接口都用 Zod 的 strip 语义，没有一处 strict | API 契约漂移不会被发现 |

---

## 6. 对 `docs/status.md` 已知项的复核结论

| status.md 条目 | 结论 |
| --- | --- |
| 未处理的 Promise rejection 会终结进程 | **成立**；补充：`finishRun` 抛错时 `actives` 条目不会被清理，`activeRunIds` 会永久非空，坚果云恢复会被它一直挡住 |
| `Promise.race` 把 `persistInputs` 的 DB 错误升级成整运行失败 | **成立，且后果比记录的重**：`runLoop` 的 catch 直接 return，不做收尾 → 在飞节点的 promise 无人 await、DB 里永远停在 `running`，从未启动的节点**一行都没有**，并且这些 promise 之后仍会写库（可能给已删除的运行重建行，见 B7） |
| 坚果云请求无超时 | 成立；补充：`retries=2` 会把一次挂住放大成 3 次尝试 |
| `forceStop` 会篡改已结束的运行 | 成立；补充：之后 `runLoop` 仍会再 `finishRun` 一次并二次 emit `run.done`，等于写库两遍 |
| SSE 建连竞态 | 成立（先 `detail()` 判 running 再 `subscribe()`，两者之间结束时连接永不 resolve） |
| 前端组件、路由、store 无测试 | 成立。本次新增的具体清单见 §7；另外 `apps/web` 里 `components/workspace/project-tree-utils.ts` 已经是纯函数模块、可测但零覆盖 |
| 缺索引 | 成立；`previousOutputs` 是这两张表的高频调用方（见 B9） |
| 配方阶段 B/C 未做 | 成立，`executeRecipeOnInput` 里没有任何缓存读写 |
| 盲 SSRF、路径校验可绕过、错误信息泄漏、密钥明文入库 | 均成立；本文 B1/B2 是同一类的新实例（`nutstore`/`test-asr` 的凭据回落、`source.file` 的 `filePath` 读路径） |
| 首屏体积、`manualChunks` 未落地 | 成立，前一轮我已复现 602.6/380.2/286.0 KiB，当前仍是 602.6，距 R9 失败线剩 47.4 KiB |

---

## 7. 各区域的测试覆盖缺口（具体清单）

现有测试覆盖的是：引擎的 `describeError`/`isRetryableError` 纯函数、部分成功降级、`fromNode`（仅文本链路）、挑选（仅"来源直连"这一侧）、挑选节点身份穿透、配方 5 个块、`recipe.ts` 的断言门宽容规则、restore 的 4 条路径；前端只有 `run-segments.test.ts` 与 `drill.test.ts` 两个纯逻辑文件。

**完全没有覆盖**（都是本次发现的 A/B 级问题所在的路径）：

- `previousOutputs` 的任何分支（A7 两条都在这里）
- 环工程（A2）与空画布运行
- `MAX_INLINE_TEXT` 截断后的历史取数（A6）
- 自定义提示词块（A3）——根本没有用例碰 `process.obsidian`/`flow.if`/`process.text`/`source.bili`/`process.chapter`/`process.mindmap` 这几个类型
- 引文断言的**反向**用例（A4：给编造引文必须失败）
- 并发：没有任何用例把 concurrency 拉到 >1 并断言共享状态的时序
- 取消/强制结束之后的终态一致性

---

## 8. 我明确判定"不算问题"的（避免下一轮重复讨论）

- `lib/markdown.ts` 用 `marked` + `DOMPurify.sanitize`，全仓 `v-html` 只 4 处且全部经过它；其余组件全用文本插值。**AI 产物进 DOM 这条最危险的路径是干净的。**
- 单节点内逐输入串行、`keepVideo` 默认不下载、`skipBlocked` 单趟传播、`restore.ts` 的热替换事务与 `DETACH` 写法、`ai.ts` 用 `AbortSignal.any` 合并超时与取消，这些都是**有注释说明的刻意设计**。
- 「同工程只允许一个运行」是真的成立（`createRun` 的检查与插入之间没有 await）。
- 11 个内置模板实测 46 条边 0 条端口违规；`docs-gen --check` 与 `packages/shared` 的 71 个用例当前全绿。
- 我上一轮撤回过的两条：卡片尺寸（我在未控制缩放的视口下量的，真实卡片是 320-380 px 宽）与那个 500（响应体不是 JSON，说明没到应用层，属环境问题）。

## 9. 诚实清单

- **验证状态**：§2 的 A1-A6 与 B2/B4、C5、C20 是我自己复核过的（读了源码或跑了最小验证）。其余标【报告】的条目来自七个子代理的逐行阅读，**我没有逐条复核**；它们的共同点是都给了 `文件:行号`，但请以文件为准。
- **抽样边界**：子代理报告里凡涉及"实测"的数字（上传内存放大 58→1465MB、深拷贝 1.61-5.62ms、markmap 前端解析、URL 归一化）,是它们在**各自环境**里跑的，我没有复现。
- **未做端到端运行**：除我前一轮实际用过的那几次（画布加节点/连线/跑 19ms 文本链路/打开真实运行记录）之外，本文所有结论都没有在浏览器里端到端复现。A1-A8 里凡写"触发"的，都是代码路径推导。
- **可能的重号**：同一处代码被多个区域的子代理从不同角度看，我在合并时做了去重（例如环→成功被两个区独立发现），但仍有少量条目可能指向同一处根因的不同表现（例如 A7 与 D1 矩阵里的 `flow.pick` 缺席）。
- **没有改动任何代码或数据**。本轮只读了源码、跑了只读的 grep 与 `docs-gen --check`。
