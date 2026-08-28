import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** JSON 字符串，结构为 packages/shared 的 WorkflowGraph。 */
  graphJson: text("graph_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;

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
  status: text("status", { enum: ["running", "success", "error", "cancelled"] }).notNull(),
  scope: text("scope", { enum: ["all", "fromNode", "node"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
  elapsedMs: integer("elapsed_ms"),
  summary: text("summary"),
  error: text("error"),
});

export type RunRow = typeof runs.$inferSelect;

export const runNodeResults = sqliteTable("run_node_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  nodeLabel: text("node_label"),
  status: text("status", { enum: ["queued", "running", "done", "error", "cancelled", "skipped"] }).notNull(),
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

/** 应用设置（key-value；密钥只存服务端，读取接口返回 hasKey）。 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AppSettingRow = typeof appSettings.$inferSelect;
