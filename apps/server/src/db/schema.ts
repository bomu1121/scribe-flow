import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** JSON 字符串，结构为 packages/shared 的 WorkflowGraph。 */
  graphJson: text("graph_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  /** 所属工程文件夹 ID（folders.id）；null 表示根层级。 */
  folderId: text("folder_id"),
  /** 同父级内手动排序位置；null 兼容旧数据，读取时按 0 处理。 */
  position: integer("position"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;

/** 工程文件夹：给工程（项目）分类整理，支持嵌套。 */
export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  /** 同父级内手动排序位置；null 兼容旧数据，读取时按 0 处理。 */
  position: integer("position"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type FolderRow = typeof folders.$inferSelect;

/** 扫码登录会话：二维码密钥只在内存里映射到本表主键，不落库。 */
export const biliSessions = sqliteTable("bili_sessions", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["waiting", "scanned", "expired", "success"] }).notNull().default("waiting"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export type BiliSessionRow = typeof biliSessions.$inferSelect;

/** B 站登录 Cookie（单用户；只存自托管服务端，禁止回传前端）。 */
export const biliCookies = sqliteTable("bili_cookies", {
  id: integer("id").primaryKey(),
  cookie: text("cookie").notNull(),
  mid: integer("mid").notNull(),
  uname: text("uname").notNull(),
  face: text("face").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type BiliCookieRow = typeof biliCookies.$inferSelect;

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  /** 历史遗留列（M8 曾试验全局运行库分类；现不再使用，运行记录随工程展示）。 */
  folderId: text("folder_id"),
  status: text("status", { enum: ["running", "success", "error", "cancelled"] }).notNull(),
  scope: text("scope", { enum: ["all", "fromNode", "node"] }).notNull(),
  /** 当 scope 为 fromNode/node 时，记录本次运行的起点节点；历史行可能为空。 */
  nodeId: text("node_id"),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
  elapsedMs: integer("elapsed_ms"),
  summary: text("summary"),
  error: text("error"),
  /** 运行时的工程图快照，保证历史结果页的输入/输出溯源不被后续编辑影响。 */
  graphJson: text("graph_json"),
});

export type RunRow = typeof runs.$inferSelect;

export const runNodeResults = sqliteTable("run_node_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  nodeLabel: text("node_label"),
  status: text("status", { enum: ["queued", "running", "done", "error", "cancelled", "skipped"] }).notNull(),
  attempts: integer("attempts").notNull().default(1),
  elapsedMs: integer("elapsed_ms").notNull().default(0),
  summary: text("summary"),
  error: text("error"),
  outputKind: text("output_kind", { enum: ["text", "noteBlock", "noteDoc", "audio"] }),
  outputText: text("output_text"),
  outputPath: text("output_path"),
  outputSize: integer("output_size"),
  updatedAt: integer("updated_at").notNull(),
});

export type RunNodeResultRow = typeof runNodeResults.$inferSelect;

/** 运行节点输入明细：记录每个节点实际消费的输入（文本或音频转写结果），用于结果页单独查看。 */
export const runNodeInputs = sqliteTable("run_node_inputs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  targetNodeId: text("target_node_id").notNull(),
  sourceNodeId: text("source_node_id").notNull(),
  kind: text("kind", { enum: ["text", "audio"] }).notNull(),
  text: text("text"),
  resultText: text("result_text"),
  path: text("path"),
  size: integer("size"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export type RunNodeInputRow = typeof runNodeInputs.$inferSelect;

/** 应用设置（key-value；密钥只存服务端，读取接口返回 hasKey）。 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AppSettingRow = typeof appSettings.$inferSelect;

/** 提示词块：内置块在 shared 中，这里只存自定义块。 */
export const promptBlocks = sqliteTable("prompt_blocks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  builtin: integer("builtin").notNull().default(0),
  /** M8-1：配方 JSON（阶段 C 提供编辑 UI 前恒为 NULL）。 */
  recipe: text("recipe"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type PromptBlockRow = typeof promptBlocks.$inferSelect;

/** 运行节点日志（文稿片段 / AI 请求与响应等）。 */
export const runNodeLogs = sqliteTable("run_node_logs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  kind: text("kind", { enum: ["input", "ai-request", "ai-response", "info", "error"] }).notNull(),
  content: text("content").notNull(),
  /** M8-1：配方步骤 id；非配方节点日志为空。 */
  step: text("step"),
  /**
   * 多输入节点的输入归属：该条日志是第几个输入产生的（对应 run_node_inputs.position）。
   * 一个节点处理 8 个视频时，8 组同名日志靠它才能分清是哪个视频。
   */
  inputIndex: integer("input_index"),
  /** 该节点本次执行的输入总数，用于展示「3/8」。 */
  inputTotal: integer("input_total"),
  createdAt: integer("created_at").notNull(),
});

export type RunNodeLogRow = typeof runNodeLogs.$inferSelect;

/**
 * 媒体资产库：视频下载/归一化后的「内容寻址」文件 + 元数据。
 * 只存引用与元数据的结构化侧；大文件本体在 dataDir/media（默认不进坚果云备份）。
 */
export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  /** 去重键（B站：sha1("bili:"+bvid+":"+cid+":"+qn)；文件：sha1("file:"+filePath)）。 */
  contentKey: text("content_key").notNull().unique(),
  kind: text("kind", { enum: ["bili", "file"] }).notNull(),
  /** restoring=下载/归一化中；ready=文件就绪；error=上次尝试失败（文件可能缺失）。 */
  status: text("status", { enum: ["ready", "restoring", "error"] }).notNull().default("ready"),
  /** 最近一次下载/归一化失败原因（status=error 时）。 */
  error: text("error"),
  /** dataDir 相对路径：media/<id>.mp4 或 uploads/…（uploads 原件的文件生命周期归上传管理）。 */
  filePath: text("file_path").notNull(),
  mime: text("mime").notNull().default("video/mp4"),
  size: integer("size"),
  durationSec: integer("duration_sec"),
  title: text("title"),
  /** B站：bvid/cid/qn/封面/up 主/原链接等溯源信息（JSON）。 */
  metaJson: text("meta_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastUsedAt: integer("last_used_at").notNull(),
});

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

/** 运行 ↔ 节点 ↔ 资产：一次运行的来源节点产生了哪些可播放视频（含多选/分P 的逐项对应）。 */
export const runMedia = sqliteTable("run_media", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  sourceIndex: integer("source_index").notNull().default(0),
  assetId: text("asset_id").notNull(),
  status: text("status", { enum: ["ready", "error", "restoring"] }).notNull().default("ready"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

export type RunMediaRow = typeof runMedia.$inferSelect;
