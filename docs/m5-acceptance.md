# M5 验收标准（分层）

> 生效时间：2026-08-28。M5 范围：Element Plus 按需引入与分包、响应式移动端、a11y、节点数量防御、深色令牌预留、Docker 部署、CI 增补。

## 2026-08-28 验收结果

| 层级 | 结果 | 证据 |
|---|---|---|
| L0 静态质量 | ✅ 通过 | typecheck / test（9 用例）/ build / lint 全绿 |
| L1 构建体积 | ✅ 通过 | 主包 `index.js` 1130KB → **124.6KB**（gzip 42KB）；element-plus / vue-flow / reka-ui 拆分为独立 chunk，构建无 chunk 警告 |
| L2 无头 CDP | ✅ 37/37 | `pnpm smoke:ui`（新增移动端 3 项：画布只读提示、节点库隐藏、底部导航显示） |
| L3 生产静态托管 | ✅ 通过 | `STATIC_DIR=apps/web/dist` 启动后端：`/` 200 返回 SPA、`/project/abc` 200 SPA fallback、`/assets/*.js` 200 |
| L4 Docker 部署 | ✅ 通过 | `docker build -t scribe-flow:ci .` 本地构建成功；CI 增加 docker build job |

## L0 静态质量

- `pnpm typecheck` 0 错误
- `pnpm test`：shared 4 + bili 2 + ai 3
- `pnpm build` 成功
- `pnpm lint` 全过

## L1 构建体积（Element Plus 按需 + 分包）

- 移除 `app.use(ElementPlus)` 全量注册，改为组件显式引入 + `ElConfigProvider` 中文 locale + `v-loading` 指令单独注册
- Vite `manualChunks`：element-plus / vue-flow / reka-ui 独立文件；`elkjs` 保持懒加载
- 结果：主入口 124.6KB（gzip 42.2KB）；无 >1500KB 警告

## L2 无头 CDP（`pnpm smoke:ui`，37 项）

M4 34 项基础上新增：

| # | 检查 |
|---|---|
| 35 | 390×844 下画布只读提示显示 |
| 36 | 移动端节点库隐藏 |
| 37 | 移动端底部导航显示 |

## L3 生产静态托管

- 后端增加 `STATIC_DIR` 支持（Hono + `@hono/node-server/serve-static`）
- 实测：`/`、SPA fallback `/project/abc`、静态资源均 200

## L4 Docker 部署

- `Dockerfile`：node:22-slim + ffmpeg + pnpm 安装 + web 构建 + `/data` 卷 + `STATIC_DIR=/app/apps/web/dist`
- `.dockerignore`：排除 node_modules/dist/data/docs 等
- `docs/deploy.md`：单容器部署、环境变量、备份迁移、健康检查
- `.github/workflows/ci.yml` 增加 `docker build` job
- 本地 `docker build -t scribe-flow:ci .` 成功

## 完成判据

L0–L4 全部通过，M5 完成 ✅（2026-08-28）。
