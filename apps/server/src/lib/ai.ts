import { openAsBlob } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AsrEngine } from "@scribe-flow/shared";

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

/** 一次对话调用的 token 用量；形状定义在 shared/taxonomy.ts（设置页也要读同一份）。 */
import type { ChatUsage } from "@scribe-flow/shared";
export type { ChatUsage };

export interface ChatResult {
  content: string;
  usage: ChatUsage;
}

interface ChatResponseBody {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
  message?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
  };
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (!signal) return AbortSignal.timeout(ms);
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

async function requestChat(config: AiConfig, system: string, user: string, signal?: AbortSignal): Promise<ChatResponseBody> {
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
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
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI 接口请求失败（${res.status}）${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as ChatResponseBody;
  if (body.error?.message) throw new Error(body.error.message);
  return body;
}

function contentOf(body: ChatResponseBody): string {
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI 接口没有返回内容");
  return content;
}

export function chatCompletion(config: AiConfig, system: string, user: string, signal?: AbortSignal): Promise<string> {
  return requestChat(config, system, user, signal).then(contentOf);
}

/** 与 `chatCompletion` 同一请求，但把用量一并带回来（打标要按它统计实际花费）。 */
export function chatCompletionWithUsage(config: AiConfig, system: string, user: string, signal?: AbortSignal): Promise<ChatResult> {
  return requestChat(config, system, user, signal).then((body) => ({
    content: contentOf(body),
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
      cachedTokens: body.usage?.prompt_cache_hit_tokens ?? 0,
    },
  }));
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

/** WAV 头部探测窗口：ffmpeg 产出的头远小于这个值；超出视为非常规 WAV，退回整读。 */
const WAV_HEADER_PROBE_BYTES = 64 * 1024;

/**
 * 从盘上按块读 WAV：找 data 区后逐块「复制头部 + 读一段 PCM」，内存里同一时刻只有一个块。
 * 三种情况退回整读（与旧的整文件行为一致）：小文件、非标准 WAV、头部长得探测不到 data 区。
 */
async function* mimoAudioChunks(audioPath: string, maxDataBytes: number): AsyncGenerator<Buffer> {
  const handle = await open(audioPath, "r");
  try {
    const fileSize = (await handle.stat()).size;
    if (fileSize <= maxDataBytes) {
      yield await readFile(audioPath);
      return;
    }
    const probe = Buffer.alloc(WAV_HEADER_PROBE_BYTES);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    const head = probe.subarray(0, bytesRead);
    if (head.length < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
      yield await readFile(audioPath);
      return;
    }
    let offset = 12;
    let dataOffset = -1;
    while (offset + 8 <= head.length) {
      const id = head.toString("ascii", offset, offset + 4);
      const size = head.readUInt32LE(offset + 4);
      if (id === "data") {
        dataOffset = offset + 8;
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (dataOffset < 0) {
      yield await readFile(audioPath);
      return;
    }
    const dataSize = Math.min(head.readUInt32LE(dataOffset - 4), fileSize - dataOffset);
    if (dataSize <= 0) {
      yield await readFile(audioPath);
      return;
    }
    const header = Buffer.alloc(dataOffset);
    await handle.read(header, 0, dataOffset, 0);
    for (let start = 0; start < dataSize; start += maxDataBytes) {
      const chunkLength = Math.min(maxDataBytes, dataSize - start);
      // 每块仍是合法 WAV：头部照抄，RIFF 与 data 长度字段按本块改写
      const out = Buffer.alloc(header.length + chunkLength);
      header.copy(out, 0);
      out.writeUInt32LE(header.length + chunkLength - 8, 4);
      out.writeUInt32LE(chunkLength, dataOffset - 4);
      await handle.read(out, header.length, chunkLength, dataOffset + start);
      yield out;
    }
  } finally {
    await handle.close();
  }
}

async function transcribeMimo(config: AsrConfig, audioPath: string, signal?: AbortSignal): Promise<string> {
  const results: string[] = [];

  for await (const chunk of mimoAudioChunks(audioPath, MIMO_MAX_AUDIO_BYTES)) {
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
  // openAsBlob 让 FormData 直接引用磁盘文件，不再把整段音频读进 JS 堆
  const file = await openAsBlob(audioPath, { type: "audio/wav" });
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
