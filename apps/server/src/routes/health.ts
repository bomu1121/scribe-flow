import { Hono } from "hono";
import { WORKFLOW_TEMPLATES } from "@scribe-flow/shared";

export const health = new Hono();

health.get("/", (c) =>
  c.json({
    ok: true,
    name: "scribe-flow",
    version: "0.1.0",
    time: new Date().toISOString(),
    // 自动化客户端用它做能力探测：旧服务没有这一段时，客户端必须按“不支持”处理。
    capabilities: {
      autoSave: true,
      templates: WORKFLOW_TEMPLATES.map((template) => template.id),
      outputKinds: ["text", "noteBlock", "noteDoc", "audio"],
    },
  }),
);
