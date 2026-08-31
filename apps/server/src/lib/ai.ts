import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AsrEngine, UpdateSettingsRequest } from "@scribe-flow/shared";

export interface AiConfig {
  provider: "deepseek" | "openai" | "custom";
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AsrConfig {
  engine: AsrEngine;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (!signal) return AbortSignal.timeout(ms);
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

export function chatCompletion(config: AiConfig, system: string, user: string, signal?: AbortSignal): Promise<string> {
  return fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    }),
    signal: withTimeout(signal, 300_000),
  }).then(handleChatResponse);
}

/** 拉取 OpenAI 兼容接口的可用模型列表。 */
export async function listAiModels(config: Pick<AiConfig, "baseUrl" | "apiKey">, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: withTimeout(signal, 30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`获取模型列表失败（${res.status}）${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    data?: { id?: string }[];
    error?: { message?: string };
    message?: string;
  };
  if (body.error?.message) throw new Error(body.error.message);
  if (!Array.isArray(body.data)) throw new Error("模型接口没有返回 data 数组");
  return body.data.map((model) => model.id).filter((id): id is string => Boolean(id));
}

async function handleChatResponse(res: Response): Promise<string> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI 接口请求失败（${res.status}）${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
    message?: string;
  };
  if (body.error?.message) throw new Error(body.error.message);
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI 接口没有返回内容");
  return content;
}

/** 云 ASR：MiMo 走 input_audio 的 chat/completions；OpenAI 兼容走 /audio/transcriptions。 */
export async function transcribeAudio(config: AsrConfig, audioPath: string, signal?: AbortSignal): Promise<string> {
  if (config.engine === "mimo") {
    return transcribeMimo(config, audioPath, signal);
  }
  return transcribeOpenAiCompatible(config, audioPath, signal);
}

// MiMo 的 input_audio 把整段音频塞进 base64 data URL，官方文档限制编码后字符串最大 10MB。
// 按原始 PCM 7MB（base64 约 9.3MB）切块，留出 data URL 前缀余量。
const MIMO_MAX_AUDIO_BYTES = 7 * 1024 * 1024;

function splitWav(buffer: Buffer, maxDataBytes: number): Buffer[] {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return [buffer];
  }

  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || dataSize <= 0) return [buffer];

  const header = buffer.subarray(0, dataOffset);
  const chunks: Buffer[] = [];
  for (let start = 0; start < dataSize; start += maxDataBytes) {
    const end = Math.min(start + maxDataBytes, dataSize);
    const chunkData = buffer.subarray(dataOffset + start, dataOffset + end);
    const out = Buffer.alloc(header.length + chunkData.length);
    header.copy(out, 0);
    out.writeUInt32LE(header.length + chunkData.length - 8, 4);
    out.writeUInt32LE(chunkData.length, dataOffset - 4);
    chunkData.copy(out, header.length);
    chunks.push(out);
  }
  return chunks;
}

async function transcribeMimo(config: AsrConfig, audioPath: string, signal?: AbortSignal): Promise<string> {
  const data = await readFile(audioPath);
  const chunks = data.length > MIMO_MAX_AUDIO_BYTES ? splitWav(data, MIMO_MAX_AUDIO_BYTES) : [data];
  const results: string[] = [];

  for (const chunk of chunks) {
    const dataUrl = `data:audio/wav;base64,${chunk.toString("base64")}`;
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify({
        model: config.model || "mimo-v2.5-asr",
        messages: [
          {
            role: "user",
            content: [{ type: "input_audio", input_audio: { data: dataUrl, format: "wav" } }],
          },
        ],
        asr_options: { language: "zh" },
        stream: false,
      }),
      signal: withTimeout(signal, 600_000),
    });
    const content = await handleChatResponse(res);
    const text = content.trim();
    if (text) results.push(text);
  }

  return results.join("\n\n");
}

async function transcribeOpenAiCompatible(config: AsrConfig, audioPath: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  const file = new Blob([await readFile(audioPath)], { type: "audio/wav" });
  form.append("file", file, `${basename(audioPath, ".wav") || "audio"}.wav`);
  form.append("model", config.model || "whisper-1");
  form.append("response_format", "json");

  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: withTimeout(signal, 600_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ASR 接口请求失败（${res.status}）${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { text?: string; error?: { message?: string }; message?: string };
  if (body.error?.message) throw new Error(body.error.message);
  const text = body.text?.trim();
  if (!text) throw new Error("ASR 接口没有返回文字");
  return text;
}
