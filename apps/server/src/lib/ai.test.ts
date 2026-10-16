import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatCompletion, listAiModels, transcribeAudio, wavDataSeconds } from "./ai";

let server: Server;
let baseUrl: string;

/**
 * 造一个头规整的 WAV：16bit 单声道、`seconds` 秒静音。
 * 用来验证「音频时长是量出来的」这件事本身——量错了，用量里的秒数就是错的。
 */
function makeWav(seconds: number, sampleRate = 8000): Buffer {
  const pcm = Buffer.alloc(sampleRate * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // 单声道
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byteRate
  header.writeUInt16LE(2, 32); // blockAlign
  header.writeUInt16LE(16, 34); // 位深
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.includes("/audio/transcriptions")) {
        // 与真实端点一致：`verbose_json` 带 usage 与 duration，`json` 只有一个 text。
        // 我们的实现优先走 verbose_json，拿不到才退回 json。
        if (body.includes("verbose_json")) {
          res.end(
            JSON.stringify({
              text: "转写内容",
              duration: 4.2,
              usage: { type: "duration", seconds: 5 },
            }),
          );
          return;
        }
        res.end(JSON.stringify({ text: "转写内容" }));
        return;
      }
      if (req.url?.includes("/chat/completions")) {
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "AI 内容" } }],
            usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33, prompt_cache_hit_tokens: 7 },
          }),
        );
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
  it("chatCompletion 走 OpenAI 兼容协议，并把厂商报的 usage 带回来", async () => {
    const result = await chatCompletion({ provider: "deepseek", baseUrl, model: "mock", apiKey: "key" }, "system", "user");
    expect(result.content).toBe("AI 内容");
    expect(result.usage).toEqual({
      calls: 1,
      promptTokens: 11,
      completionTokens: 22,
      cachedTokens: 7,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      audioSeconds: 0,
    });
  });

  it("listAiModels 拉取 OpenAI 兼容模型列表", async () => {
    const models = await listAiModels({ baseUrl, apiKey: "key" });
    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("wavDataSeconds 量出的秒数与文件实际时长一致", async () => {
    const wav = join(tmpdir(), `scribe-wav-${Date.now()}-3s.wav`);
    await writeFile(wav, makeWav(3));
    expect(await wavDataSeconds(wav)).toBeCloseTo(3, 5);
  });

  it("wavDataSeconds 对非 WAV 文件返回 0，而不是抛错或瞎猜", async () => {
    const notWav = join(tmpdir(), `scribe-notwav-${Date.now()}.wav`);
    await writeFile(notWav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    expect(await wavDataSeconds(notWav)).toBe(0);
  });

  it("transcribeAudio 走 verbose_json 拿厂商报的音频秒数（优先于自己量的）", async () => {
    const wav = join(tmpdir(), `scribe-asr-test-${Date.now()}.wav`);
    await writeFile(wav, makeWav(2));
    const result = await transcribeAudio({ engine: "openai-compatible", baseUrl, model: "mock-asr", apiKey: "key" }, wav);
    expect(result.text).toBe("转写内容");
    // 文件本身是 2 秒，但厂商报了 5 秒（usage.seconds）——**用厂商的**，那是它计费的依据。
    // token 一概记 0：按秒计费的语音模型不吃 token，不按字数瞎估。
    expect(result.usage).toEqual({
      calls: 1,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      audioSeconds: 5,
    });
  });

  it("transcribeAudio 支持 MiMo input_audio 协议（音频 token 由厂商报在 usage 里）", async () => {
    const wav = join(tmpdir(), `scribe-mimo-test-${Date.now()}.wav`);
    await writeFile(wav, makeWav(2));
    const result = await transcribeAudio({ engine: "mimo", baseUrl, model: "mimo-v2.5-asr", apiKey: "key" }, wav);
    expect(result.text).toBe("AI 内容");
    expect(result.usage).toEqual({
      calls: 1,
      promptTokens: 11,
      completionTokens: 22,
      cachedTokens: 7,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      audioSeconds: 2,
    });
  });
});
