# 视频模块（下载与结果页播放）验收（分层）

> 生效时间：2026-09-09。范围：B站/本地视频 keepVideo 下载归一化 → 媒体缓存库 + 引用 → 结果页播放与缺失恢复。
> 设计稿：`docs/video-module-research.md`（含 D1–D7 决策）；P0 实测：`docs/research/video-module-poc.md`。
> 状态：**MVP（P0–P2）验收通过**；`smoke:ui` 既有 37 项回归待下一次全量执行时并入（本次新 UI 用真实 Chrome 手工/脚本验证并留截图证据）。

## 验收结果总表

| 层级 | 结果 | 证据 |
|---|---|---|
| L0 静态质量 | ✅ 通过 | `pnpm typecheck`（shared/server/web 全绿）；`pnpm test`（server 52/52，shared 全过）；`pnpm lint`（slop/ui 全过） |
| L0.5 构建 | ✅ 通过 | `pnpm build`（apps/web built in 31s；MediaPlayer 并入 RunDetailView chunk） |
| L1 引擎/存储/API | ✅ 通过 | vitest `media-store.test.ts` 3 例 + `media-smoke.mjs` 真实链路（Range 206 / probe / restore） |
| L2 结果页 UI | ✅ 通过 | 真实 Chrome + Vite/API：素材视频区起播 1080P、控件交互、画布开关 |
| L3 视觉复核 | ✅ 通过 | 4 张截图经视觉复核（播放画面/控制条/缺失面板/恢复播放/卡片开关） |
| L4 真实 B站 | ✅ 通过 | 真实账号（非大会员）1080P AVC 下载/合成/播放/重下全通过 |

## L1 引擎/存储/API 用例

- `media-store.test.ts`：内容键稳定；删除运行 GC（media/ 文件删除、uploads/ 原件保留）；多运行共享资产引用计数。
- `media-smoke.mjs`（真实服务）：keepVideo 运行 success → `run_media` ready/present → `GET /api/media/:id/stream` Range `bytes=0-1023` → 206 + `Content-Range: bytes 0-1023/111863072` → 删文件后 probe `present=false` → `POST restore` → 任务 done → probe `present=true`、Range 恢复 206。

## L2 结果页 UI（真实 Chrome 手工验证）

| # | 检查 | 结果 |
|---|---|---|
| 1 | 纯来源运行（无文本输出）结果页出现「素材视频」区 | ✅ |
| 2 | 播放器起播：muted play 后 paused=false、readyState=4、seekable 全片 | ✅ |
| 3 | 播放/暂停控件真实点击生效；时间/进度条/音量/倍速/全屏按钮存在 | ✅ |
| 4 | 画布 B站节点「高级设置」内：保留可播放视频开关 → 360P/480P/720P/1080P 段选出现（紧凑两行、中性墨色选中态），默认 1080P；切 720P 生效 | ✅ |
| 5 | 删资产文件 → 结果页显示缺失面板（说明 + 重新下载 + 在 B 站打开） | ✅ |
| 6 | 点「重新下载」→ 轮询任务 → 页面刷新后视频恢复可播 | ✅ |
| 7 | 默认不保存：只放来源节点直接运行 → 不产生视频附件，结果页显示“默认不保存视频文件…开启后重跑”指引（不再莫名空屏） | ✅ 文案已改（未截图复核） |
| 8 | 来源节点高级设置开启「保留可播放视频」后运行 → 结果页直接展示「素材视频」+「下载视频」按钮，并隐藏“无文本产物”占位 | ✅ |

## L3 视觉证据（截图，已人工/视觉复核）

| 图 | 内容 |
|---|---|
| `docs/research/video-poc-player-1080p.jpeg` | P0 本地播放器画面（1080P 实拍画面，非黑屏） |
| `docs/research/video-poc-result-page-player.jpeg` | 结果页「素材视频」新版播放器：浅色纸面控件条常驻下方、进度条横贯、舞台贴合视频比例 |
| `docs/research/video-poc-restore-ui.jpeg` | 缺失面板「重新下载」→ 恢复后播放器（点击后自动重载出现） |
| `docs/research/video-poc-node-card-keepvideo.jpeg` | 画布节点高级设置：keepVideo 开关 + 清晰度段选（紧凑、中性墨色选中） |
| `docs/research/video-poc-leaf-download-view.jpeg` | 开启「保留可播放视频」后运行的结果页（新版样式）：素材视频播放 + 「下载视频」按钮，无空输出文案 |

## L4 真实 B站（样本 BV1eqYx6UE9V，386.7s，账号：非大会员登录态）

- playurl：登录后实际返回 AVC 1080P（id=80）；游客实际最高 480P → 按实际返回流判定清晰度（详见 P0 记录）。
- 下载：100.7MB @ 23.8MB/s（4.2s）；ffmpeg `-c copy +faststart` 合成 0.3s，产物 h264(High) 1920x1080 + aac，111,863,072B。
- 引擎真实运行（keepVideo）：run success，media 附件 ready；重下 restore 真实完成。

## 遗留（非阻塞 / 后续）

- `smoke:ui` 自动化用例补录（播放器/缺失面板/恢复），并入下次全量执行；
- durl 兜底与“仅 HEVC 样本”的 libx264 速率实测（遇真实样本补测）；
- P3 文档：部署说明已更新 media 目录与备份矩阵；开发日志已记录（见下）。
