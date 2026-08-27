import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) =>
  c.json({
    ok: true,
    name: "scribe-flow",
    version: "0.1.0",
    time: new Date().toISOString(),
  }),
);
