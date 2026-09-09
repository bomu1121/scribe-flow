# ScribeFlow 视频下载与结果页播放 —— 调研与设计

> 状态：**调研与设计稿，待评审**（评审通过后按 §6 分阶段立实施文档）
> 范围：B站视频/本地视频 → 下载与归一化 → 结果页可流畅播放；存储采用「媒体缓存库 + 引用」；播放器为「原生 HTML5 video + 自研轻封装」。
> 对应目标：让「带有下载视频的运行/工作流」在重启、备份恢复、换机后仍能正常浏览，同时不让大文件拖垮现有轻量备份（坚果云仅 SQLite）。

---

## 0. TL;DR（结论先行）

1. **播放**：服务端把所有媒体统一归一为 **MP4（H.264 + AAC + `+faststart`）**，通过带 **HTTP Range（206）** 的流式接口下发给浏览器；前端**不引入 video.js/Plyr**，自研 `MediaPlayer.vue`（原生 `<video>` + 轻控件层），为将来的「区间选择 → 截取」预留稳定扩展点。
2. **下载**：扩展现有 `media.ts downloadBiliAudio`（DASH 音轨）为「视频流 + 音轨双流下载 → ffmpeg 合成归一」。默认**优先 AVC(H.264) 流、copy 模式合成**（快、无画质损失）；目标清晰度无 AVC 时才考虑转码或降档。
3. **存储**：新增 `dataDir/media/` 资产库 + `media_assets` / `run_media` 两张表。**DB 与工程只存引用和元数据，视频文件不进任何默认备份**；备份恢复/换机后文件缺失时，结果页给出「缺失态」并提供**一键重新下载/打开源站**。运行删除走引用计数 GC。
4. **落地路径**：P0 用真实 B站视频做下载-合成-播放 PoC → P1 存储/引擎/接口 → P2 结果页播放器与缺失恢复 UX → P3 分层验收与文档回归。「截取与后续处理」是下一里程碑，本期只把播放器接口预留好。

**需要评审的开放决策点（详见各处）**

| # | 决策点 | 当前建议 |
|---|---|---|
| D1 | 「保留可播放视频」默认值 | **默认不保存**：无论是否独立运行，未开启一律不下载视频；需要保存/查看时在来源节点「高级设置 → 保留可播放视频」开启后重跑。结果页对“只转出音轨、未开视频”的运行显示操作指引，而不是莫名空屏（曾试过“独立运行自动下载”，用户明确要求默认不保存后撤销） |
| D2 | 默认清晰度 | 1080P 且仅 AVC；登录态下自动抬升档位（详见 §3.2） |
| D3 | 视频下载失败对运行的影响 | 视频是「附加产物」：失败不拖垮音频转写链路，节点/附件展示错误并提供单独重试 |
| D4 | 删除运行后媒体文件处理 | 引用归零即删除文件（可选：设置页「缓存保留策略」后续迭代） |
| D5 | 本地视频是否也做「保留视频」开关 | 是，与 B站走同一附件模型（原文件已在 uploads/，优先直放、必要时转码） |
| D6 | 运行里出现 `kind: video` 输出端口 | 本期**不加**端口类型；等「截取/再加工」里程碑（§2.5）再引入 |
| D7 | 里程碑编号 | 本文档按 M9 起草，最终编号以项目排期为准 |

---

## 1. 需求与已确认口径

### 1.1 用户目标

- 复用/扩展现有「B站下载」链路（现状只下载 DASH **音轨**并转 16k wav 供 ASR），新增**下载完整视频**并在**结果页查看**。
- 核心投入点是结果页视频播放能力：期望播放器**健全**，且为将来「自己选内容 → 截取 → 截取内容后续处理」预留。
- 存储：下载的视频是大文件，需要保证「以后打开带视频的工作流仍能正常浏览」，同时**避免大文件进备份**的麻烦。

### 1.2 已与用户对齐的选择（2026 本稿评审前确认）

| 维度 | 结论 |
|---|---|
| 播放器路线 | **原生 HTML5 `<video>` + 自研轻封装**（不用 video.js/Plyr 作骨架） |
| 播放范围 | **B站下载视频 + 本地视频文件**（同一套媒体服务与播放器） |
| 存储模型 | **媒体缓存库 + 引用；备份默认不含媒体**；缺失可恢复/重下 |
| 交付节奏 | 先出本文档（调研+设计），评审通过后再开发 |

### 1.3 本稿写作时点的事实基线（读代码确认）

- `source.bili` 执行体：`apps/server/src/lib/engine.ts` case `source.bili`（L982-1033）→ `media.ts downloadBiliAudio`：`playurl?fnval=16&qn=64` 取 **DASH 最高码率音轨** `audio.m4s` → FFmpeg 16k 单声道 wav → `runs/<runId>/nodes/<nodeId>/audio.wav`（相对路径入 `run_node_results.output_path`）。
- 单节点结果只存**一个** output（`output_kind/output_text/output_path/output_size` 四列，见 `apps/server/src/db/schema.ts` run_node_results）。
- 结果页：`apps/web/src/views/RunDetailView.vue`，结果 Tab = 左侧「链路输入」（按深度分组、选中进入主区查看）+ 主区 Markdown 纸面。**音频输入目前没有可播放 UI**，无转写稿时只有占位文案（L1238-1241）。
- 备份：坚果云 `uploadCurrentBackup` 只上传 `scribe-flow.sqlite`（sqlite backup API）+ `backup.json`；工程导入导出只含图 JSON。**大文件天生不在备份里**（`docs/deploy.md` 的完整迁移 = 拷贝整个 `/data`）。
- 本地上传：`files.ts` 允许 `video/*`（mp4/mkv/flv/mov/webm/m4v…），存 `uploads/<uuid>.<ext>`，图数据 `FileSourceData.filePath`；运行期转 wav，**原件保留在 uploads/**。
- 迁移机制：`db/client.ts ensureSchema` 幂等 SQL + `PRAGMA table_info` 补列；**SQLite 列无真枚举约束**，drizzle 的 `text(enum)` 只是类型层——新增 `video` 枚举值**不需要 ALTER TABLE**，但需审计类型扩散点（见 §4.6）。
- 工程规范：UI 全中文、颜色只走 `tokens.css`、通用控件用 Element Plus、许可证只复用 MIT/Apache-2.0、验收走 L0–L4 分层（`pnpm typecheck/test/build` + `check:api` + CDP 真实 Chrome `smoke:ui`）。

---

## 2. 播放器调研（核心之一）

### 2.1 目标能力谱

**本期（浏览/核对）**

- 播放/暂停、进度拖动（精确 seek）、当前/总时长、剩余时间。
- 音量/静音、0.5–2x 倍速、全屏、画中画（PiP）、`preload=metadata`（首帧即出封面不拉全片）。
- 大文件（数百 MB–GB 级）边下边播不卡界面：依赖 Range 流式而不是整文件读入内存。
- 加载中/缓冲/错误/缺文件（媒体不在本地）的明确状态，缺文件时可「重新下载」。
- 与现有 UI 规范一致（tokens/Element Plus 观感、中文文案）、键盘可达、`aria` 标签完整。
- 运行中实时性：SSE `node.done` 后结果页刷新即可出现视频（沿用现有节流重载，不新做链路）。

**下一里程碑（预留，不本期实现）**

- 时间轴**区间选择**（起止把手/拖动/输入秒数）、选区与播放联动、节选后服务端截取。
- 逐帧/前后 N 秒步进、截图（canvas 对 video 帧 `drawImage`，注意 CORS 同源无碍）。
- 未来若有字幕/文稿时间轴对齐，播放器需要暴露稳定的 `currentTime` 订阅与事件。

### 2.2 关键技术事实（为什么「归一 mp4 + Range」是稳健基线）

- 所有现代浏览器（Chrome/Edge/Firefox/Safari）都原生播放 **MP4/H.264(AVC)+AAC**；H.265(HEVC) 支持不统一（Chrome 系长期依赖平台/硬件能力，不能当通用基线）；AV1 虽普遍可软解，但 Safari 覆盖晚于 H.264。结论：**服务端负责把内容归一成浏览器一定有把握的 H.264+AAC MP4**，播放器侧就不需要 flv.js/hls.js/dash.js/MSE 一整套。
- `<video>` 拖动进度条依赖 HTTP **Range**：浏览器发 `Range: bytes=…`，服务端回 `206 Partial Content` + `Accept-Ranges: bytes`；**当前 `runs.ts` 的 `download`/`content` 用 `readFile` 整读，不能直接用于视频播放**，必须新增流式接口（§5.5）。
- MP4 的 `moov`（索引）如果在文件尾部，浏览器必须拉到文件尾才能开始 seek/起播——归一化时用 `-movflags +faststart` 把索引移到头部，起播与拖动体验才稳定。
- 原生 `<video>` 支持 `currentTime` 设置区间首帧（“只播一段”可在客户端先做，服务端截取是另一回事）。

### 2.3 候选路线对比

| 维度 | **原生 `<video>` + 自研轻封装（建议）** | video.js（MIT） | Plyr（MIT） | 明确排除 |
|---|---|---|---|---|
| 体积 | 0（无新增播放器依赖） | 较大（主文件 + CSS + 图标字体，量级 ~200KB+ gzip，安装后实测） | 小（几十 KB 量级） | MediaElement.js（维护弱、Flash 历史包袱）；dash.js/hls.js/shaka（MSE 流协议栈，单文件 MP4 用不上）；JWPlayer/Kaltura（商业） |
| 能力基线 | 浏览器原生全有；控件/皮肤自研 | 字幕、插件生态、稳定内核 | 常见控件开箱即用、观感好 | |
| 与项目 UI 规范贴合 | 最高：控件直接吃 `tokens.css` 与 Element Plus 观感约定 | 低-中：需要整皮肤替换（`vjs-*` 大改） | 中：有自己的皮肤系统，二次贴合也要覆盖 | |
| 区间选择/截取扩展 | **最高**：进度条自己画，起止把手、选区层、键盘微调都是自有 DOM | 中低：要在 VJS 组件体系里写插件，受其 UI 骨架约束 | 中低：只暴露事件，深入改造类似自研但还要绕 Plyr | |
| 健壮性成本 | 需要自己把坑踩平（a11y、缓冲/错误状态、快捷键） | 社区踩过多轮 | 常用场景已被踩平 | |
| 许可证/红线 | —（无新增） | MIT ✅ | MIT ✅ | |

结论：**建议原生 + 自研**。理由：

1. 本项目最看重的是**将来可控的截取交互**，而它恰好落在播放器「进度条/时间轴」这一核心区域——那里自研成本最低、三方库改造成本最高；
2. 服务端已归一为单一容器格式，播放器不需要处理 flv/m3u8/dash 等复杂技术路径，原生能力足够；
3. 项目已有「通用控件不自研、但画布/节点/浮层自研」的成熟边界（Element Plus 只覆盖通用控件），视频播放器属于业务交互组件，自研符合既有分工；
4. 备一个兜底：组件加载/异常时回退原生 `controls`（一条属性），避免「自研控件挂了等于不能播」。

### 2.4 `MediaPlayer.vue` 组件规格（本期实现目标）

- 文件：`apps/web/src/components/media/MediaPlayer.vue`（+ 可选 `media-player.ts` 状态机，便于单测）。
- Props：`src`（流式 URL）、`poster`、`title`、`missing?: MediaMissingInfo`（缺失态：原因/来源链接/可否重下）、`disabled` 等。
- 事件：`ready` / `error` / `timeupdate`（节流 250ms，未来给文稿高亮用）/ `seeked` / `play` / `pause` / `ended` / `enter-fullscreen`。
- 控件条（自绘，纯 tokens 配色，`data-` 前缀防样式冲突）：
  - 播放/暂停、进度条（缓冲区间灰条 + 播放进度 + 可拖动 seek）、时间（`h:mm:ss`）、音量、倍速（0.5/0.75/1/1.25/1.5/2）、全屏、画中画。
  - 播放中无操作 2.5s 自动隐藏控件；悬停/聚焦唤回。
  - 点击视频切换播放/暂停，双击全屏（与常见播放器一致）。
- 键盘（组件聚焦范围内，均 `preventDefault`）：`Space/K` 播放暂停、`←/→` ±5s（Shift ±10s）、`↑/↓` 音量、`M` 静音、`F` 全屏、`[`/`]` 倍速档。
- 语义：播放按钮 `aria-label`、进度条 `role="slider"` + `aria-valuenow/text`、`aria-keyshortcuts`；焦点可见性沿用项目规范（无 ring 无 outline 方案按现有按钮规范处理）。
- 视觉（内嵌态与结果页“纸面”一体）：浅色控件条常驻画面下方——进度条横贯整条、按钮/文字中性墨色；舞台黑只包住视频本身，并按真实宽高比自适应（无需 16:9 黑边骨架）；仅全屏态切换为暗色悬浮控件（自动隐藏）。不使用品牌蓝做强调色。
- 状态机：`loading → ready | error`；`waiting/stalled` 显示缓冲动画；`error` 区分「网络错误」「媒体 404/缺失（走 missing 面板）」「解码失败（提示降级/转码重下）」。
- 缺失面板（策略见 §4.4，接口见 §5.5）：封面/标题 + 说明 + 「重新下载」按钮（调 restore 接口，展示进度）+ 「在 B 站打开」外链 + 「本地文件已被清理」提示（file 类无自动恢复）。
- 与运行态联动：结果页 SSE 刷新后若 `media` 从“无”变“有”，自动切入可播状态（沿用现有 scheduleReload）。

### 2.5 为「区间选择 → 截取」预留（设计口子，不在本期实现）

- 播放器对外暴露选区能力口子：props `selection?: { enabled; startSec; endSec; minGapSec }` + `update:selection`；进度条组件内部把「进度拖动」与「选区把手」分层实现，避免未来返工进度条。
- 服务端截取语义（未来节点）：输入 `{ assetId/runMedia 引用, startSec, endSec }`，ffmpeg 截取（`-ss` 放输入前 + `-c copy` 快速裁剪，若不满足精确性要求则对小窗口转码），产物进 media 库并可继续走 ASR/AI 节点。
- 端口模型：届时在 `PORT_TYPES`/`NODE_PORTS` 增加 `video` 端口与新节点（如 `process.clip`），source 节点多一个 `video` 输出；本期**不加**（见 D6）。

---

## 3. 下载与归一化管线（B站 + 本地）

### 3.1 B站播放地址与编码事实

- 现链路已用官方 `x/player/playurl`（带 Referer/UA，登录态走 Cookie），`fnval=16` 请求 **DASH**；DASH 返回 `video[]/audio[]`，各自有 `baseUrl/backupUrl/bandwidth/id(qn)/codecid`。
- codecid 映射（B站约定，按 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/video/videostream_url.md)）：`7 = AVC(H.264)`、`12 = HEVC(H.265)`、`13 = AV1`。**只有 AVC 是浏览器通用基线**（见 §2.2）。
- 清晰度/登录限制是**动态账号策略**：未登录/非大会员可用的 `accept_quality` 与会员不同（具体档位会变，以真实请求实测为准，PoC 必须记录无 Cookie 与有 Cookie 两组结果）。现有音频代码在无 Cookie 时也能下公开视频音轨（M3 L4 已验证），视频流按同一套 Cookie 读取即可。
- **实测补充（2026-09-09 PoC，样本 BV1eqYx6UE9V）**：`accept_quality` 会列出高档位（含 1080P+），但**未登录时实际返回的 `dash.video` 最高只有 480P（AVC/HEVC 各两档）**；登录（非大会员）后实际返回最高 1080P AVC（id=80）且 112(1080P+) 在列表但无对应流。→ UI/引擎必须按「实际返回的流」判定可用清晰度，并在缺登录态时提示（详见 [P0 记录](./research/video-module-poc.md)）。
- 低清晰度档 `durl`（单文件 mp4/flv）作为回退；DASH 首选的原因是可拿到「合成后仍是浏览器友好容器」的两个流，且合成多数是 copy（无损、快）。

### 3.2 下载策略（建议）

对每个来源（单 URL/分P/多选第 i 项），引擎新增（keepVideo 开启时）：

1. `playurl` 取到 DASH `video[]` 后**按用户清晰度档 `qn` 过滤，优先 `codecid=7`（AVC）**；同档多流取带宽最高。
2. 下载 `video.m4s` + `audio.m4s`（沿用现有 `fetch` + Referer + Cookie + 600s 超时 + 进度上报模式；音频流选择与现状一致取最高码率）。
3. ffmpeg 合成归一：
   - 首选：`ffmpeg -y -i video.m4s -i audio.m4s -c copy -movflags +faststart out.mp4`（AVC+AAC 时 copy 无损且快）；
   - 若目标档只有 HEVC/AV1 而用户不允许转码 → **回退到该账号可用最高 AVC 档**；
   - 若用户明确要高清晰度且只有 HEVC → `libx264` 转码（CPU 耗时，PoC 记录速率后写进 UI 提示）；
   - `durl` 兜底：mp4(H.264) 直接 faststart 归位；flv/mkv 等 → 转码 H.264+AAC。
4. 原子落盘：先写 `*.part` 再 rename；失败清理残留；成功后**内容寻址入媒体库**（§4.3），同一 `(bvid,cid,qn,codec)` 再次运行直接命中缓存，秒级完成。

**清晰度/大小策略（建议默认）**

| 项 | 建议 | 备注 |
|---|---|---|
| 默认档位 | 1080P（qn=80 档语义，按实际接口） | 登录态可用更高档时仍需 AVC 优先 |
| 上限 | 不自动下 4K/大会员专属档 | 4K 多是 HEVC/AV1，存储与转码成本高；后续做「清晰度设置」再说 |
| 体积预估 | `≈ 码率(Mbps)/8 × 60 × 分钟`；H.264 1080p 约 20–45 MB/分钟、720p 约 10–20 MB/分钟（粗估，以实测为准） | 40 分钟 1080p 可到 1GB 量级，直接决定备份策略（§4） |
| keepVideo 生效规则 | **显式开启才下载**（默认不保存，无“独立运行自动下载”）；显式关闭=不下载 | 避免未预期的大文件占盘；结果页对未开启的运行给出操作指引 |

**失败语义（D3 建议）**：keepVideo 只是「附加产物」，下载/合成失败不判定节点失败（不阻塞音频-转写链路），在 `run_media` 记 `status=error` + 日志 + 结果页可单独「重试下载」；纯查看型流程（无下游）时，附件错误也在节点摘要与结果页可见。

### 3.3 本地视频（source.file）

- 原文件已在 `uploads/`（`FileSourceData.filePath`），上传时已验 MIME。
- keepVideo 开启时：若原文件就是浏览器可播 MP4（`fileId` 扩展名 `.mp4` 且探测通过）→ **直放原件**（媒体资产引用 uploads 文件，Range 直出，零拷贝零转码）；mkv/flv/mov/webm 等 → 运行期 ffmpeg 归一为 mp4 资产（同时保留 uploads 原件）。
- 已知风险：`files.ts` 上传目前 `file.arrayBuffer()` **整文件进内存**（`maxUploadMb` 可配到 2GB），大视频上传会吃内存；本期先按现状（上传仍走现有限制），把「流式上传 + 落盘哈希」列入后续优化清单。
- 删除运行/工程时 uploads 原件生命周期需一并澄清（现状未见随工程删除清理 uploads 的逻辑，§4.6 作为观察项列出）。

---

## 4. 存储、历史可打开性与备份（核心之二）

### 4.1 问题拆解

1. 视频文件大（单条数百 MB～GB）；把大文件塞进「工程/运行记录/坚果云备份」会让备份、迁移、换机全部变慢变贵——**现有备份本来就只有 SQLite**，这是优势不是缺陷。
2. 「以后打开带视频的工作流能正常浏览」要拆成两个承诺：
   - **承诺 A（本机/本实例）**：媒体文件在 `dataDir` 里持久保存，重启不丢；打开运行记录即播。
   - **承诺 B（备份恢复/换机/迁移后）**：SQLite 恢复后媒体文件大概率不在 → 用「**引用 + 懒恢复**」补上：元数据完整可展示封面/标题，点击播放时发现缺失 → 一键重新下载（B站类）或提示重传（本地文件类）。
3. 运行是「不可变快照」，但**媒体文件不必跟着运行重复**：同一视频多次运行/多个运行共用一份资产（去重），否则重跑一次就多几百 MB。

### 4.2 设计原则

- **引用与内容分离**：图（graph）/运行记录/Db 只存「引用 + 元数据」；文件在媒体库；缺文件 ≠ 丢记录。
- **内容寻址去重**：B站视频 `contentKey = sha1("bili:" + bvid + ":" + cid + ":" + qn + ":" + codec)`；本地文件先按 uploads 存储路径（内容哈希后续迭代）建 key。同 key 文件只存在一份。
- **运行记录不变**：运行删除只清理引用；媒体文件按引用计数 GC。
- **备份默认不含媒体**：坚果云备份维持「只 SQLite」；完整迁移仍可整体拷贝 `/data`（这是用户主动选择「离线全量」的路径，见 §4.4）。

### 4.3 目录与表设计（建议）

```
<DATA_DIR>/
├─ scribe-flow.sqlite          # 不变：全部结构化数据（含媒体元数据）
├─ media/                      # 新增：视频资产库（不进坚果云备份）
│  └─ <id>_<slug>.mp4          # 扁平或两级 hash 目录均可，文件名即内容键前缀
├─ uploads/                    # 不变：本地上传原件
├─ runs/                       # 不变：运行产物（wav/md 等小/中文件）
└─ outputs/                    # 不变：输出文件
```

`media_assets`（新表）：

| 列 | 说明 |
|---|---|
| `id` | 资产 id（`asset_<uuid>`） |
| `content_key` | 去重键，UNIQUE |
| `kind` | `bili` / `file` |
| `status` | `ready` / `error`（文件是否在盘由访问时 stat 判定，缺失态从引用侧推导） |
| `file_path` | dataDir 相对路径（media/… 或 uploads/…） |
| `mime` / `size` / `duration_sec` | 播放/下载用 |
| `title` / `meta_json` | 标题、封面 URL、bvid/cid/qn/codec/up 主/原链接等溯源信息 |
| `created_at` / `updated_at` / `last_used_at` | 生命周期管理 |

`run_media`（新表，运行 ↔ 节点 ↔ 资产 的附加产物引用）：

| 列 | 说明 |
|---|---|
| `id` | PK |
| `run_id` / `node_id` | 哪个运行的哪个节点 |
| `source_index` | 多选/分P 序号（0 = 单视频），用于结果页逐项对应 |
| `asset_id` | → media_assets |
| `status` | `ready` / `error` / `restoring`（附件级状态，不占节点状态） |
| `error` | 下载/合成失败原因 |
| `created_at` | |

> 不把视频塞进 `run_node_results.output_*` 的原因：节点目前是「单 output」模型（四列），而 video 是**附加在来源节点上的附属产物**，且一个节点可能多 P 多视频；用 `run_media` 表达「一个节点有 N 个可播放视频」最自然，改动最小。

### 4.4 备份策略矩阵

| 场景 | 现状 | 新增后的处理 |
|---|---|---|
| 坚果云一键备份（`POST /nutstore/backup`） | 仅 sqlite | **不变**；媒体不在备份里（这正是“避免大文件备份麻烦”） |
| 坚果云恢复（`/nutstore/restore`） | 换 sqlite | 恢复后媒体缺失属预期：结果页缺失态 + 懒重下 |
| Docker 卷整体迁移 | 拷贝整个 `/data` | **不变**即含媒体（离线全量路径），或只拷 sqlite（轻量路径） |
| 工程导入/导出 | 仅图 JSON | 不变；工程本身只引用 bvid/cid，不背文件 |
| （远期可选） | — | 设置项 `媒体是否纳入坚果云备份`、独立 `MEDIA_DIR` 环境变量（媒体可放独立大磁盘/卷） |

**「以后打开都能正常浏览」的承诺方式（建议表述）**：图与运行记录（SQLite）保证「内容还在、元数据可看、可一键恢复」；媒体文件保证「在本地就秒开，不在本地就重下再开」。对 B站来源这天然成立（源是公网可再取的）；对本地文件类，缺失时明确提示重新上传/重跑（诚实降级，不假装能恢复）。

### 4.5 生命周期与 GC

- 引擎 `runNode` 下载成功后：upsert `media_assets`（命中 content_key 则复用）→ 插入 `run_media` → 节点摘要可写「视频 1080P 已缓存」。
- `deleteRun`：删 `run_media` 行后重算该 asset 引用数；**归零且非 restore 中** → 删文件 + `media_assets` 行（D4；要保留缓存可后续加设置）。
- `deleteProject`：复用上述路径批量处理。
- 并发：同一视频两个运行同时下 → content_key 唯一约束 +「下载中锁（restoring 状态）」防重复；后到者等锁或直接命中。
- 完整性：`recoverInterruptedRuns`（服务重启标记 cancelled）时若残留 restoring 附件 → 置回 error/ready 依文件实际存在判定。

### 4.6 代码改动面与类型扩散点（预研结论）

新增 `video` 相关类型时注意这些扩散点（本期若只做附件模型，大多无需动）：

- `packages/shared/src/run.ts`：`NodeOutputKind`、`NodeOutput`、`RunNodeInput.kind`。
- `packages/shared/src/port.ts` + `graph.ts NODE_PORTS`：将来加 video 端口时。
- `schema.ts`/`client.ts`：SQLite TEXT 无真枚举，drizzle enum 变更**不需要迁移 SQL**，但所有 switch/三元分支要过一遍：
  - `engine.ts`：`output.kind !== "audio"` 当作文本的若干处、`buildLegacyInputs` 对非 audio 行按 outputText 处理；
  - `runs.ts` `rowToNodeResult` / SSE preview 生成；
  - `RunDetailView.vue` inputItems kind 推断、`RunLogDialog`、`FlowCanvas/ScribeNode` 预览逻辑。
- `apps/web` 各处的 `kind: "text" | "audio"` 手写联合类型要收敛到 shared 导出类型。

---

## 5. 结果页接入设计（RunDetailView）

### 5.1 数据

- `GET /api/runs/:id` 的返回增加 `media: RunMediaView[]`（由 `run_media` JOIN `media_assets` 组出）：

```ts
interface RunMediaView {
  id: string;            // run_media.id
  nodeId: string;
  sourceIndex: number;   // 多选/分P 序号
  label: string;         // 标题/文件名
  kind: "bili" | "file";
  status: "ready" | "error" | "restoring";
  error?: string;
  asset?: {
    id: string;
    title?: string;      // 含封面 URL、上传者等 meta 的展示子集
    durationSec?: number;
    size?: number;
    present: boolean;    // 文件当前在盘（stat 结果缓存）
    sourceUrl?: string;  // bilibili 原链接；file 类为空
  };
}
```

### 5.2 摆放位置

- 现有交互已把「链路输入 → 主区查看」打通（选中侧栏行 → `viewingInput` 主区纸面）。
- 建议：**输入有可播视频时，主区纸面头部下方插入播放器区块**（标题/元信息之下、转写文稿之上）；无转写稿时播放器照常可用（替代现在的占位文案）。
- 多选/多P 卡片：主区提供该输入的视频列表（现有 `modules` 分组逻辑的兄弟实现：按 `source_index` 列出资产），一次播放一个，切换不丢当前选择。
- 将来若某节点输出本身是 `video`（截取产物），同一组件在「输出文档」区渲染——组件与运行媒体模型天然通用。

### 5.3 渲染约束

- 播放器宽度随纸面（max-width 900px 体系），`aspect-ratio` 容器 + `object-fit: contain` 黑底；全屏走容器 `requestFullscreen`。
- 颜色/字体/图标全部走 tokens + lucide（同现有 rv-* 风格）；无渐变/玻璃拟态（lint:slop 红线）。
- 移动端：播放器 `playsinline`，窄屏下控件可点按目标 ≥ 36px。

### 5.4 缺失态 UX（核心承诺的可视化）

| 情形 | 展示 | 动作 |
|---|---|---|
| 文件在盘 | 正常播放 | — |
| B站资产缺失（备份恢复/换机） | 封面 + 「视频文件不在本地（备份不含大文件）」 | 「重新下载」→ restore 接口带进度（复用现有下载+合成代码）；「在 B 站打开」新标签 |
| 下载后文件损坏/解码失败 | 错误面板 | 「重新下载」；「在 B 站打开」 |
| 本地文件资产缺失 | 「上传原件已被清理」 | 引导回画布重新上传/重跑该节点 |
| B站内容已失效（删除/私密/需登录） | 保留元数据 + 错误原因 | 「在 B 站打开」兜底，用户自行确认 |

### 5.5 后端接口（新增，前缀 `/api`）

| 接口 | 语义 | 要点 |
|---|---|---|
| `GET /api/runs/:id`（扩展） | 附带 `media` | JOIN 查询，`present` 由 stat 推导（可 30s 缓存） |
| `GET /api/media/:assetId/stream` | 视频流播放 | **Range 支持**：206/200 + `Accept-Ranges: bytes` + `Content-Type: video/mp4` + `Content-Length`；Hono 里对 `fs.createReadStream` 手工处理 `Range` 头（或用 Hono 静态中间件能力），**禁止 readFile 整读**；同源部署无需 CORS |
| `GET /api/media/:assetId/stream?probe=1`（或 HEAD） | 播放器预检 | 返回可播/缺失/损坏，便于前端快速进入缺失态 |
| `GET /api/media/:assetId/download` | 另存为 | attachment + 原文件名 |
| `POST /api/media/:assetId/restore` | 缺失重下 | 仅 bili：按 meta_json 的 bvid/cid/qn/codec 重放 §3.2 管线；`file` 返回 400 引导重传；返回 `jobId` |
| `GET /api/media/restore-jobs/:jobId` | 轮询进度 | `{status: running|done|error, progress 0-100, message}`（MVP 轮询即可，不必新开 SSE） |
| `DELETE /api/runs/:id`（改） | 引用归零则 GC 媒体 | 见 §4.5 |

播放 URL 生成：前端拿 `run_media` 的 `asset.id` 拼 `/api/media/:assetId/stream`，**不暴露服务器物理路径**。

---

## 6. 分阶段实施与验收（M9 建议，评审通过后拆实施文档）

> **实施状态（2026-09-09）**：P0 ✅（记录见 [video-module-poc.md](./research/video-module-poc.md)）→ P1 ✅ → P2 ✅ → 分层验收见 [video-module-acceptance.md](./video-module-acceptance.md)。MVP 已在真实环境跑通「下载 → 结果页播放 → 缺失一键重下」闭环，待 L0.5 build 与后续自动化 smoke 补录后整体定稿。

### P0 选型 PoC（先做，风险最低）

> 状态：✅ **已完成（2026-09-09，本机真实 B站实测）**，完整数据见 [docs/research/video-module-poc.md](./research/video-module-poc.md)；核心结论：① 未登录实际流 ≤480P、登录（非大会员）可达 1080P AVC，须按实际返回流判定清晰度；② m4s 双流 `-c copy +faststart` 合成秒级完成、无画质损失；③ Range 206 + Chrome 起播/seek 到 70% 处流畅（有截图证据）；④ 遗留非阻塞项：durl 兜底与仅 HEVC 样本的 libx264 速率，遇真实样本再补测。

- 用现有 ffmpeg + 真实 B站视频（先 2–10 分钟公开视频，再 40 分钟级）验证：
  1. `playurl` 无 Cookie / 有 Cookie 的 `video[]` 实际 codecid 分布与可用清晰度（记录 480/720/1080 档 AVC 可得性）；
  2. m4s 双流 `-c copy` 合成 mp4 成功率与耗时、大小；
  3. `+faststart` 后 Range 播放：`curl -H "Range: bytes=0-1"` 回 206、Chrome 起播/拖动正常；
  4. 若无 AVC 高码率档，评估 libx264 转码速率（为 UI 文案与默认策略取证）；
  5. durl 兜底路径可行性。
- 产出：PoC 记录追加到本文档或实施文档附录。

### P1 存储与引擎（后端）

> 状态：✅ 已完成（2026-09-09）。表/迁移、`media-store`、引擎 keepVideo 与 GC、Range 流式/restore REST 均落地，真实链路冒烟通过。

- `media_assets` / `run_media` 建表与幂等迁移（`ensureSchema` 模式）；
- shared 类型 + `RunMediaView`；引擎 `source.bili`/`source.file` keepVideo 分支（复用/改造 `media.ts`，抽出 `downloadBiliDashVideo` + `muxToMp4` + `ensureMediaAsset`）；
- run_media upsert、deleteRun/deleteProject GC、restore job 注册表与接口；
- L1 `pnpm check:api` 新增用例：资产去重（同视频两 run 只一份文件）、删除引用 GC、Range 206、restore 流程（mock 下载）。

### P2 结果页播放（前端）

> 状态：✅ 已完成（2026-09-09）。`MediaPlayer.vue` + RunDetailView（链路输入/素材视频兜底/缺失恢复）+ 来源节点「高级设置」内的 keepVideo 开关与清晰度段选（紧凑、中性色）；真实 Chrome 验证与截图见验收文档。

- `MediaPlayer.vue` + 缺失态/restore 进度 UI；
- RunDetailView 接入（§5.2–5.4）；
- `pnpm lint:ui` / `lint:slop` 合规；
- L2 `pnpm smoke:ui` 新增：下载 fixture（ffmpeg 造 2 分钟 H.264 mp4）→ 结果页出现播放器 → play/pause/seek 通过 → 模拟缺文件出缺失面板 → restore mock 后恢复；
- L3 bsk 真实 Chrome 视觉复核：播放器控件、全屏、倍速、缺失态面板；
- L4 真实 B站：`source.bili` keepVideo 开 → 1080P AVC 视频在结果页播放、第二次运行命中缓存、删除运行后文件被 GC。

### P3 回归与文档

> 状态：文档与验收已落（2026-09-09）；`pnpm build` ✅。遗留：既有 `smoke:ui` 全量回归与播放器自动化用例补录、durl/仅 HEVC 样本补测（非阻塞）。

- `pnpm typecheck && pnpm test && pnpm build` 全绿、smoke 37+ 回归；
- 更新 `docs/deploy.md`（`/data/media`、备份矩阵、可选 `MEDIA_DIR`）、`docs/development-log.md`；
- 按 L0–L4 模板落 `docs/video-module-acceptance.md`。

### 不在本期（下一里程碑）

- 时间轴区间选择 + 服务端截取 + video 端口/截取节点（`process.clip`）——播放器已留接口（§2.5）；
- 清晰度/格式设置面板、流式上传与内容哈希、媒体缓存 LRU 管理 UI、字幕时间轴对齐、YouTube 等来源扩展。

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| B站接口策略变化（WBI/登录/风控/域名） | 下载失败 | 下载代码收敛在 `media.ts` 单点 + 现有「补 cause、中文报错」模式；PoC 记录接口版本；cookie 仅服务端 |
| 高清晰度只有 HEVC/AV1 | 浏览器不能直放 | 默认 AVC 优先 + 回退降档；转码作为显式选项并提示耗时（D2） |
| 大文件内存/磁盘 | OOM / 磁盘满 | 播放/下载全程流式；媒体库去重；GC；文档写明容量建议；上传流式化为后续项 |
| 自研播放器健壮性/可访问性 | 播放体验不稳 | 组件规格先定（§2.4）、兜底原生 controls、CDP 冒烟 + L3 视觉复核覆盖 |
| 恢复后媒体缺失被误解为「丢了」 | 信任受损 | 缺失态文案 + 懒恢复 + 源站链接；备份策略在设置/文档中明示 |
| 大会员过期/视频失效 | 重下失败 | 附件级 error + 「在 B 站打开」兜底；运行记录与元数据不删 |
| 合规 | — | 延续现有「个人学习用途 + 服务端 Cookie 私有」口径；文档注明遵守 B站条款与当地法律 |

---

## 8. 参考资料

- [bilibili-API-collect：视频流（playurl/DASH/durl、清晰度与 codecid 说明）](https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/video/videostream_url.md)（另见 [DeepWiki 镜像](https://deepwiki.com/SocialSisterYi/bilibili-API-collect/4.1.3-video-playback-and-streaming#1) 与 [DASH 域名补充说明](https://gitea.s1f.ren/shiran/bilibili-API-collect/commit/de0cf01a3686574c5bb45ae5766b2bbf39b6beda?files=video%2fvideostream_url.md)）
- [BrowserStack：HTML5 音视频编码与浏览器兼容指南](https://www.browserstack.com/guide/html5-codec)
- [HTML5 video 支持的编码格式与浏览器兼容（中文汇总）](https://www.php.cn/faq/2636399.html#1)
- [Stack Overflow：HTML5 video 只播一段 / 区间控制](https://stackoverflow.com/questions/10174516/html5-video-playing-only-a-portion-of-a-video/)
- [Stack Overflow：区间播放交互实现讨论](https://stackoverflow.com/questions/75452078/display-and-play-just-a-section-of-a-video)
- [Stack Overflow：Content-Range 在 200 OK 响应中的问题（Range 语义注意点）](https://stackoverflow.com/posts/59406607/revisions)
- [视频站 Range/快进/断点续传服务端配置思路（nginx mp4 模块等）](http://mansion-reel.com/index.php?ssid=20260625324420.shtml)
- [video.js 进度条跳转问题分析与解决（社区实践，选型对比用）](https://blog.gitcode.com/faf7b49f767ff22f5ececcdade7bb5b2.html)
- [bilibiliDownloader（GitHub 第三方下载器 README，DASH/清晰度实践参考）](https://github.com/leventfrais/bilibiliDownloader/blob/main/README.md)
- [FFmpeg 合成 B站 m4s 实践（360doc 与 B站专栏案例）](https://www.360doc.cn/article/33317445_898690711.html)、[B站 PC 缓存 m4s 转 MP4 案例](https://www.bilibili.com/opus/1135402457611894801)
- [Chrome HEVC 硬件解码 QA 项目（说明 Chrome 系 H.265 支持非通用基线）](https://github.com/OpenIPC/chrome-hevc-qa)
