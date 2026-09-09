# 视频模块 P0 真实视频验证记录

> 状态：✅ 已完成（2026-09-09，本机 Windows + 真实 B站公网）
> 目的：验证 `docs/video-module-research.md` §6 P0 的风险点——DASH 视频流可得性/编解码、m4s 双流 ffmpeg copy 合成、`+faststart` 后 HTTP Range 播放与 Chrome 真实起播/拖动。
> 脚本：`apps/server/video-poc.mjs`（开发期工具；Cookie 只从本机 SQLite 读取、不打印本体）。

## 1. 环境

| 项 | 值 |
|---|---|
| Node / pnpm | v22.23.2 / 11.19.0 |
| ffmpeg / ffprobe | 7.1.1-essentials（gyan.dev），libx264 + AAC 编码器可用 |
| B站登录态 | 本地 `bili_cookies` 存在（薄暮轻阴，非大会员）；游客组无 Cookie |
| 样本视频 | `BV1eqYx6UE9V`《我 来 同 你 玩丨二洲年快乐》P1，`cid=41726444802`，386.7s（6:27） |
| 产物目录 | `%TEMP%\scribe-video-poc\`（guest/login 各一组，可重复运行脚本再生成） |

## 2. playurl（`fnval=16&fnver=0&fourk=1&qn=80`）实测

**游客（无 Cookie）**

- `accept_quality=[112,80,64,32,16]`（列表含 1080P+/1080P），但**实际返回的 `dash.video` 只有 ≤480P**：
  - AVC id=32 852x480 525kbps / id=16 640x360 353kbps
  - HEVC id=32 852x480 258kbps / id=16 640x360 181kbps
- DASH 恒有返回，`durl` 0 条（fnval=16 下未触发单文件兜底）。

**登录（非大会员）**

- `accept_quality=[112,80,64,32,16]`；实际返回流含 **AVC 1080P（id=80, 1920x1080, 2.18Mbps）**、AVC 720P/480P/360P，以及各档 HEVC 并行流。
- 列表含 112(1080P+) 但**响应中没有 id=112 的流** → 非大会员实际上限 1080P。

**结论 ①**：`accept_quality` 是「账号可达档位列表」，不等于「本次实际返回的流」；未登录实际只能拿到 ≤480P。**UI/引擎必须按实际返回流判定可用清晰度，并在缺登录态时提示“登录后可取 1080P”**（落实进设计稿 D2/§3.2）。

## 3. 下载 → ffmpeg copy 合成（`-c copy -movflags +faststart`）

| 组 | 选用流 | 视频下载 | 音轨 | 合成 | 产物 |
|---|---|---|---|---|---|
| guest | AVC id=32 852x480 | 24.2MB @ 5.31MB/s（4.6s） | 5.9MB | copy 成功 0.1s（含探测共 1.1s） | 30.2MB · h264(High) 852x480 + aac · 386.7s |
| login | AVC id=80 1920x1080 | 100.7MB @ 23.77MB/s（4.2s） | 5.9MB | copy 成功 0.3s | 106.7MB（111,863,072B）· h264(High) 1920x1080 + aac · 386.7s |

- 音频流 id=30280（DASH audio，codecid 字段为 0，产物 ffprobe 确认 `aac`）。
- copy 合成为纯 remux，秒级完成，**无画质损失** → 引擎内额外耗时可忽略。
- 实测该 1080P 样本码率 2.18Mbps ≈ **16.4MB/分钟** → 40 分钟视频 ≈ 0.65GB（数量级与设计稿预估一致）。

**结论 ②**：AVC 档位在游客/登录下均存在（样本视频），「优先 AVC + copy 合成」成立；HEVC 同档并存但不需要它。libx264 转码未触发（无“仅 HEVC”样本），编码器已在环境确认可用，转码路径保留为兜底并在后续遇到仅 HEVC 样本时补测速率。

## 4. Range 播放（本地服务模拟后端流式接口）

服务：`video-poc.mjs --serve`（GET/HEAD + 单区间 Range）。

```
GET /login-BV1eqYx6UE9V/out.mp4                 → 200  video/mp4  (111,863,072 B)
GET Range: bytes=0-1023                          → 206  Content-Range: bytes 0-1023/111863072
GET Range: bytes=100000000-                      → 206  bytes=11863072（尾部区间正常）
响应头：Accept-Ranges: bytes ✓  Content-Length: 1024 ✓
```

## 5. Chrome 真实播放与拖动（本机 Chrome，页面 = 本地 player.html）

- 起播（muted 自动播放）：`paused=false`、`readyState=4`、`networkState=1`、`duration=386.67s`、3.5s 后 `currentTime≈10.9s`，已缓冲 `[0,25.1]`，**seekable 全片 `[0,386.67]`**，视频 1920x1080。
- 拖动：设 `currentTime=260` → seeked 后继续播放，`currentTime≈262.96s`，缓冲出现目标区 `[255.9,265.6]` 与预取区 `[291.9,298.7]`，全程无 `waiting` → **Range 流式 seek 正常**。
- 视觉复核截图：`docs/research/video-poc-player-1080p.jpeg`（非黑屏、正在播放画面；原生控件在播放中闲置自动隐藏属预期）。

## 6. 对设计与后续 P1/P2 的影响

1. keepVideo 下载清晰度依赖登录态：**无 Cookie 时按实际可得流（≤480P）并提示；有 Cookie 默认 1080P AVC**。
2. 播放器侧前提成立：服务端只需提供「H.264 MP4 + `+faststart` + Range(206)」，浏览器原生起播/拖动即可达预期 → P2 可安全走「原生 `<video>` + 自研轻封装」。
3. 实测下载带宽远高于转码/合成耗时，瓶颈在存储（40 分钟级视频 0.6–0.7GB/条）→ 印证「媒体缓存库 + 引用、默认不进备份」的设计取向。
4. 遗留待覆盖项（非阻塞）：durl 兜底路径（DASH 恒返回故未触发）、仅 HEVC 样本的 libx264 转码速率——保留在 L4/遇到真实样本时补测。

## 7. 产物与复现

- 复现：`cd apps/server && node video-poc.mjs --modes guest,login --bvid BV1eqYx6UE9V`
- 播放复现：`node video-poc.mjs --serve --out "%TEMP%\scribe-video-poc" --port 8345` → 浏览器开 `/player.html`
- 临时产物（约 137MB，可随时删除重下）：`%TEMP%\scribe-video-poc\{guest,login}-BV1eqYx6UE9V\{video,audio}.m4s,out.mp4`
