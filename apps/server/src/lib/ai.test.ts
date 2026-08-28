import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatCompletion, listAiModels, transcribeAudio } from "./ai";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.includes("/audio/transcriptions")) {
        res.end(JSON.stringify({ text: "转写内容" }));
        return;
      }
      if (req.url?.includes("/chat/completions")) {
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "AI 内容" } }] }));
        return;
      }
      if (req.url?.includes("/models")) {
        res.end(JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server 启动失败");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("AI / ASR 调用层（本地 mock 端点）", () => {
  it("chatCompletion 走 OpenAI 兼容协议", async () => {
    const content = await chatCompletion({ provider: "deepseek", baseUrl, model: "mock", apiKey: "key" }, "system", "user");
    expect(content).toBe("AI 内容");
  });

  it("listAiModels 拉取 OpenAI 兼容模型列表", async () => {
    const models = await listAiModels({ baseUrl, apiKey: "key" });
    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("transcribeAudio 支持 OpenAI 兼容 /audio/transcriptions", async () => {
    const wav = join(tmpdir(), `scribe-asr-test-${Date.now()}.wav`);
    await writeFile(wav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const text = await transcribeAudio({ engine: "openai-compatible", baseUrl, model: "mock-asr", apiKey: "key" }, wav);
    expect(text).toBe("转写内容");
  });

  it("transcribeAudio 支持 MiMo input_audio 协议", async () => {
    const wav = join(tmpdir(), `scribe-mimo-test-${Date.now()}.wav`);
    await writeFile(wav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const text = await transcribeAudio({ engine: "mimo", baseUrl, model: "mimo-v2.5-asr", apiKey: "key" }, wav);
    expect(text).toBe("AI 内容");
  });
});
