import { describe, expect, it } from "vitest";
import { health } from "./health";

describe("GET /api/health", () => {
  it("暴露自动化客户端需要的能力探测字段", async () => {
    const res = await health.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      capabilities: { autoSave: boolean; templates: string[]; outputKinds: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.capabilities.autoSave).toBe(true);
    expect(body.capabilities.templates).toContain("template.single-note");
    expect(body.capabilities.templates).toContain("template.transcript-only");
    expect(body.capabilities.templates).toContain("template.refine-only");
    expect(body.capabilities.outputKinds).toEqual(["text", "noteBlock", "noteDoc", "audio"]);
  });
});
