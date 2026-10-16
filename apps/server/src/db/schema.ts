import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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


/** B 站登录 Cookie（单用户；只存自托管服务端，禁止回传前端）。 */
export const biliCookies = sqliteTable("bili_cookies", {
  id: integer("id").primaryKey(),
  cookie: text("cookie").notNull(),
  mid: integer("mid").notNull(),
  uname: text("uname").notNull(),
  face: text("face").notNull(),
  updatedAt: integer("updated_at").notNull(),
});


export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  /** 历史遗留列（M8 曾试验全局运行库分类；现不再使用，运行记录随工程展示）。 */
  folderId: text("folder_id"),
  /** `interrupted` 只由服务重启/崩溃时的收尾写入，见 db/client.ts 的 recoverInterruptedRuns。 */
  status: text("status", { enum: ["running", "success", "error", "cancelled", "interrupted"] }).notNull(),
  scope: text("scope", { enum: ["all", "fromNode", "node"] }).notNull(),
  /** 当 scope 为 fromNode/node 时，记录本次运行的起点节点；历史行可能为空。 */
  nodeId: text("node_id"),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
  elapsedMs: integer("elapsed_ms"),
  /** 用户自己起的名字（笔记标题）；空表示没起过名，列表回落到时间与状态。 */
  name: text("name"),
  summary: text("summary"),
  error: text("error"),
  /** 运行时的工程图快照，保证历史结果页的输入/输出溯源不被后续编辑影响。 */
  graphJson: text("graph_json"),
  /**
   * 单价快照：运行时设置页上的单价，**由运行开始时写入**。
   *
   * 为什么要快照（照抄 Langfuse / LibreChat / Dify / Lobe 的共同选择）："这次运行花了多少"
   * 是一件历史事实，不该被之后改设置改写。四处单价都可空——**null 表示当时没快照过**
   * （升级前的旧运行，或用户当时还没填单价），界面会退回用当前单价并写明口径。
   */
  priceInputPerMillion: real("price_input_per_million"),
  priceOutputPerMillion: real("price_output_per_million"),
  priceCachedInputPerMillion: real("price_cached_input_per_million"),
  priceAudioPerMinute: real("price_audio_per_minute"),
  priceCurrency: text("price_currency", { enum: ["CNY", "USD"] }),
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
  /**
   * 外部 API 用量：这个节点本次（含重试）花掉的调用次数、token 与音频秒数。
   * 全 0 表示「这次没调外部 API，或调了但厂商没返回用量」，不表示「不花钱」。
   * 金额由单价另算，见 packages/shared 的 `estimateChatCost`。
   */
  usageCalls: integer("usage_calls").notNull().default(0),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  /** 命中上下文缓存的输入 token；四种厂商写法归一后的结果。 */
  cachedTokens: integer("cached_tokens").notNull().default(0),
  /** 显式缓存写入的 token（OpenAI / Moonshot / OpenRouter 报）。 */
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  /** 推理 token，按输出价计费。 */
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  audioSeconds: real("audio_seconds").notNull().default(0),
  /**
   * 厂商在响应里**直接报的金额**（目前只有 OpenRouter 这类网关）。
   * **null 表示厂商没报**——与「报了 0」不是一回事，所以可空而不是默认 0。
   */
  billedCost: real("billed_cost"),
  updatedAt: integer("updated_at").notNull(),
});


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
  /** 该输入承载的素材段标识（见 shared/segment.ts 的 segmentKey）。 */
  itemKey: text("item_key"),
  /** 素材挑选把它排除了（记录在案只为说明「共几段、本次用了几段」）。 */
  excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});


/** 应用设置（key-value；密钥只存服务端，读取接口返回 hasKey）。 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});


/** 提示词：内置提示词在 shared 中，这里只存自定义提示词。 */
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


/**
 * 「对照」的 AI 差异判读缓存。
 *
 * 键是内容指纹（模型 + 两侧正文），不是运行 id：同一对产物换台机器/换次运行再打开也能直接读，
 * 内容变了自然落到新键上。判读要花一次模型调用、几十秒，重开页面不该重新掏这份钱。
 */
export const compareReports = sqliteTable("compare_reports", {
  id: text("id").primaryKey(),
  /** sha256(模型 + 左侧标签/正文 + 右侧标签/正文)。 */
  contentHash: text("content_hash").notNull().unique(),
  model: text("model").notNull(),
  leftLabel: text("left_label").notNull(),
  rightLabel: text("right_label").notNull(),
  /** CompareAnalysis 的 JSON。 */
  analysisJson: text("analysis_json").notNull(),
  /** CompareRunMeta 的 JSON（截断与体量等事实，与模型产出分开存）。 */
  metaJson: text("meta_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * 笔记打标的指纹：让「重打标」能跳过没变的笔记，从而不重复花模型钱。
 *
 * 为什么不把指纹写进笔记的 front matter：这个功能要动**整个库**（含用户手写的笔记），
 * 往别人笔记里塞一个工具专用字段太侵入；而且指纹放这儿，用户手改笔记标签会让
 * `content_hash` 自然失效、触发重判，不需要额外监听。
 *
 * 键是「库路径 + 库内相对路径」，所以整个库被搬走不会导致全部重打。
 */
export const noteTagFingerprints = sqliteTable("note_tag_fingerprints", {
  id: text("id").primaryKey(),
  /** Obsidian 库根目录（绝对路径，做规范化后存）。 */
  vaultPath: text("vault_path").notNull(),
  /** 笔记在库内的相对路径（`/` 分隔）。 */
  notePath: text("note_path").notNull(),
  /** stableHash(分类特征 + 当前标签集合)：笔记内容或标签被人改过就失效。 */
  contentHash: text("content_hash").notNull(),
  /** 判定时用的词库指纹；词库变了但这条没变，走「只判断新增标签」的增量路径。 */
  taxonomyHash: text("taxonomy_hash").notNull(),
  /** 本功能当时写进去的标签（JSON 数组），用于区分「工具写的」与「人写的」。 */
  tagsJson: text("tags_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

