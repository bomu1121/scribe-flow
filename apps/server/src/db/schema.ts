import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * M0 数据模型。
 * 完整模型见 docs/scribe-flow-proposal.md 7.2：
 * runs / run_node_results / prompt_blocks / bili_sessions / bili_cookies 在后续里程碑补建。
 */
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
