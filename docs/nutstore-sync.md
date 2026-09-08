# 坚果云同步模块（设置页）

ScribeFlow 在设置页新增「坚果云」分组，基于坚果云 WebDAV 提供：

1. **读取云端**：测试连接、递归读取远程目录、读取远程 Markdown 文件内容；
2. **Obsidian 云端模式**：`process.obsidian` 节点可直接把笔记写入坚果云，并在写入前远程扫描已有笔记做自动关联；
3. **本地 ↔ 坚果云同步**：把本地 Obsidian 库中的 `.md` 推送到坚果云，或从坚果云拉取到本地（按修改时间防覆盖）；
4. **应用数据备份**：把 SQLite 数据库备份为 `remoteRoot/backups/scribe-flow-<时间戳>/scribe-flow.sqlite`。

## WebDAV 配置

- 服务器：`https://dav.jianguoyun.com/dav/`
- 账号：坚果云登录邮箱
- 密码：必须是坚果云「账户信息 → 安全选项 → 第三方应用管理」中生成的**应用密码**，不是登录密码
- 免费版限制：单次 PROPFIND 约 750 条（文件+文件夹）；访问频率约每 30 分钟 600 次请求（付费 1500 次），大量首次同步容易触发 403

## 路径与本地同步的关系（重要）

坚果云 WebDAV 根目录 `/dav/` 不是“我的坚果云”文件夹内部，而是能看到多个同步文件夹的上级目录（例如 `我的坚果云`、`Works`、`Images`）。

因此如果上传到 `/ScribeFlow`，文件会出现在本地同步文件夹**之外**，网页“我的坚果云”和本地客户端都可能看不到。

默认配置已改为：

- 数据根目录：`/我的坚果云/ScribeFlow`
- Obsidian 云端目录：`/我的坚果云/ScribeFlow/Obsidian`

这样备份会出现在本地 `D:\我的坚果云\ScribeFlow\backups\...`（假设本地同步文件夹是 `我的坚果云`）。如果你使用其他同步文件夹，请把路径前缀改成对应的云端同步文件夹名。

## 读取设计要点（调研结论）

坚果云 WebDAV 的“读取”比本地文件系统多出很多细节，本实现按以下原则处理：

- **逐层递归而非一次性 Depth:infinity**：`PROPFIND Depth:1` 只读当前目录，递归进入子目录。避免大目录一次性返回过多导致截断。
- **750 条上限保护**：如果某目录一次返回达到 750 条，视为“可能截断”并在需要完整遍历的同步/递归扫描中显式报错，**绝不静默漏文件**。
- **只读笔记相关文件**：默认遍历 `.md`；同步本地 ↔ 云端只处理 `.md`，避免把附件/音视频大量上传（坚果云流量有限）。
- **隐藏目录跳过**：跳过 `.obsidian`、`.trash` 等隐藏目录，避免同步插件缓存与配置。
- **URL 编码/解码**：远程路径按段 `encodeURIComponent`，中文/空格/特殊字符安全；从服务端返回的 `href` 解码回逻辑路径。
- **UTF-8 读取**：`GET` 返回内容按 UTF-8 解码；超大 Markdown 做读取保护。
- **ETag / Last-Modified / 修改时间**：远程列表保留 `etag` 与 `lastModified`；本地文件保留 `mtime`/`size`。推送/拉取时用“对端更新时间晚于本端 2 秒则不覆盖”做冲突保护，避免误覆盖。
- **限流退避**：429/502/503/504 自动指数退避重试，403 明确提示可能触发坚果云频率限制。
- **安全路径**：本地/远程相对路径拒绝 `..`，防止恶意路径逃逸。

## 后端接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/nutstore/status` | 配置状态（不含密码） |
| POST | `/api/nutstore/test` | 测试连接（可传表单中未保存的账号/密码） |
| GET | `/api/nutstore/list?path=...` | 读取远程目录（Depth:1） |
| GET | `/api/nutstore/folders?path=...&maxDepth=3` | 递归读取远程目录树 |
| GET | `/api/nutstore/read?path=...` | 读取远程 Markdown 内容 |
| POST | `/api/nutstore/sync/push` | 本地 → 坚果云 |
| POST | `/api/nutstore/sync/pull` | 坚果云 → 本地 |
| GET | `/api/nutstore/backups` | 读取云端备份列表 |
| POST | `/api/nutstore/backup` | 备份 SQLite 到坚果云 |

## 代码位置

- 共享类型：`packages/shared/src/nutstore.ts`、`packages/shared/src/run.ts`
- 服务端 WebDAV 客户端：`apps/server/src/lib/nutstore.ts`
- 服务端路由：`apps/server/src/routes/nutstore.ts`
- 设置持久化：`apps/server/src/lib/settings.ts`
- Obsidian 云端模式引擎分支：`apps/server/src/lib/engine.ts`
- 前端设置页：`apps/web/src/views/SettingsView.vue`
- 前端设置 store：`apps/web/src/stores/settings.ts`

## 已知边界

- 坚果云 WebDAV 分页协议未公开，目前对“单目录 ≥750 条”采取显式报错而不是猜测下一页；后续若拿到官方分页头/参数可无缝替换。
- 推送/拉取为单向“同步按钮”，不做删除传播，避免误删；删除同步需要同步状态表，可在下一迭代加入。
- 数据备份当前为“上传 SQLite 备份 + 读取列表”，未做运行中的一键热恢复（涉及数据库替换/重启）。
