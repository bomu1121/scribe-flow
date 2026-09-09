# ScribeFlow 部署说明

## 方式一：Docker 单容器（推荐）

镜像包含后端 API、前端静态资源与 ffmpeg，数据统一放在 `/data` 卷。

```bash
docker build -t scribe-flow .
docker run -d --name scribe-flow \
  -p 8787:8787 \
  -v scribe-flow-data:/data \
  scribe-flow
```

打开 http://localhost:8787 即可使用。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 服务端口 |
| `DATA_DIR` | `/data` | SQLite 与上传/产物目录 |
| `STATIC_DIR` | `/app/apps/web/dist` | 前端静态目录；置空则前端独立托管 |
| `MAX_UPLOAD_MB` | 2048 | 单文件上传上限 |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 可执行文件路径 |
| `CORS_ORIGIN` | `*` | 逗号分隔的允许来源 |

### 备份与迁移

- 工程数据：`/data/scribe-flow.sqlite`
- 上传文件：`/data/uploads`
- 运行产物：`/data/runs`、`/data/outputs`
- 媒体资产：`/data/media`（keepVideo 下载的可播放视频，默认**不**随坚果云备份）
- 迁移 = 停止容器 → 复制整个 `/data` → 新容器挂载同一卷

### 媒体文件与备份（视频模块）

- 坚果云一键备份仍只上传 SQLite（含媒体**引用与元数据**，不含大文件本体）。
- 备份恢复/换机后，运行结果页会显示「视频文件不在本地」缺失态：B站来源可**一键重新下载**；本地文件来源提示重新上传后重跑。
- 需要离线全量迁移时按上面方式整体拷贝 `/data`（含 `/data/media`）。

## 方式二：开发机直接部署

```bash
pnpm install
pnpm build
STATIC_DIR=apps/web/dist DATA_DIR=./data pnpm --filter @scribe-flow/server exec tsx src/index.ts
```

前端由同一进程托管；如需 HTTPS/反代，把 `CORS_ORIGIN` 配为域名。

## 健康检查

```bash
curl http://localhost:8787/api/health
# {"ok":true,"name":"scribe-flow","version":"0.1.0",...}
```
