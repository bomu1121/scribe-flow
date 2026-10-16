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

/** 一次对话调用的 token 用量；形状定义在 shared/usage.ts（设置页与运行结果页读同一份）。 */
import { addApiUsage, emptyApiUsage, type ApiUsage } from "@scribe-flow/shared";
export type { ApiUsage };

export interface ChatResult {
  content: string;
  usage: ApiUsage;
}

/** 一次语音识别的结果：文字 + 用量。 */
export interface TranscribeResult {
  text: string;
  usage: ApiUsage;
}

/**
 * 厂商响应里的 `usage`。**字段名要认好几家的写法**，理由与逐家出处见 shared/usage.ts 顶部说明。
 * 这里刻意把三种缓存字段都列出来（而不是只留我们用得上的那个），是为了让"我们认得几种写法"这件事
 * 在类型上直接可见——少认一种就等于给那一家显示一个错的 0。
 */
interface UsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** OpenAI 系（OpenAI / 智谱 / 火山 / 阿里 / OpenRouter）：明细里带缓存命中与音频 token。 */
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    audio_tokens?: number;
  };
  /** OpenAI / DeepSeek / SiliconFlow：推理 token，按输出价计费。 */
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
  };
  /** DeepSeek / SiliconFlow 的顶层写法，与 `prompt_tokens_details.cached_tokens` 同义。 */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  /** Moonshot / Kimi 的顶层写法（它两处都给）。 */
  cached_tokens?: number;
  /** 小米 MiMo 的非标准字段：音频时长（秒）。厂商报了就不用我们自己量 WAV。 */
  seconds?: number;
  /** `/audio/transcriptions` 的 usage 是另一种形状：`{type, seconds}` 或 `{type, input_tokens}`。 */
  type?: string;
  input_tokens?: number;
  /** OpenRouter 等网关直接报的金额，以及它的来源明细。 */
  cost?: number;
  cost_details?: Record<string, number>;
  is_byok?: boolean;
}

interface ChatResponseBody {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
  message?: string;
  usage?: UsageShape;
}

/** 取第一个「是有限数」的候选值。用于同一含义有多种字段名时按优先级挑一个。 */
function firstNumber(...candidates: (number | undefined)[]): number {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return 0;
}

/**
 * 把厂商响应里的 `usage` 归一成 ApiUsage。**缺失一律记 0，不按字符数瞎估。**
 *
 * 归一规则（每一处都对应一个查证过的真实字段，见 shared/usage.ts 的出处清单）：
 * - 缓存命中：`prompt_tokens_details.cached_tokens` → `prompt_cache_hit_tokens` → 顶层 `cached_tokens`
 * - 缓存写入 / 推理 token：只有明细里才有
 * - 音频秒数：MiMo 的顶层 `seconds`
 * - 金额：网关的顶层 `cost`
 */
function usageOf(body: { usage?: UsageShape }, calls = 1): ApiUsage {
  const usage = body.usage ?? {};
  const details = usage.prompt_tokens_details ?? {};
  const completion = usage.completion_tokens_details ?? {};
  const billedCost = typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : undefined;
  return {
    calls,
    promptTokens: firstNumber(usage.prompt_tokens, usage.input_tokens),
    completionTokens: firstNumber(usage.completion_tokens),
    cachedTokens: firstNumber(details.cached_tokens, usage.prompt_cache_hit_tokens, usage.cached_tokens),
    cacheWriteTokens: firstNumber(details.cache_write_tokens),
    reasoningTokens: firstNumber(completion.reasoning_tokens),
    audioSeconds: firstNumber(usage.seconds),
    ...(billedCost === undefined ? {} : { billedCost }),
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

/**
 * 对话补全。**唯一入口，一定把用量带回来**——整个仓库没有"只拿正文、扔掉 usage"的版本，
 * 所以不存在"某处又漏统计"的可能（这是刻意的：加一个不带用量的重载，迟早会有人图省事用错）。
 *
 * 返回 200 但正文为空时同样抛错（上层按失败处理），**但会把已经拿到的 usage 挂在错误上**：
 * 这一次请求是真发出去、真花了钱的，把它丢掉会让"这个节点失败了"看起来像"这个节点没花钱"。
 * 调用方用 `usageFromError` 取回来记上。
 */
export function chatCompletion(config: AiConfig, system: string, user: string, signal?: AbortSignal): Promise<ChatResult> {
  return requestChat(config, system, user, signal).then((body) => {
    const usage = usageOf(body);
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw Object.assign(new Error("AI 接口没有返回内容"), { usage });
    return { content, usage };
  });
}

/**
 * 从一次失败的调用里取回它已经花掉的用量。取不到（不是我们挂上去的错误）时返回 undefined。
 *
 * 目前只有"返回 200 但正文为空"这一种情况会挂用量；网络层失败没有响应体，拿不到数。
 */
export function usageFromError(error: unknown): ApiUsage | undefined {
  const usage = (error as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  return typeof (usage as ApiUsage).calls === "number" ? (usage as ApiUsage) : undefined;
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

interface ChatTextBody extends ChatResponseBody {
  choices?: { message?: { content?: string } }[];
}

async function handleChatResponse(res: Response): Promise<{ content: string; usage: ApiUsage }> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI 接口请求失败（${res.status}）${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as ChatTextBody;
  if (body.error?.message) throw new Error(body.error.message);
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI 接口没有返回内容");
  return { content, usage: usageOf(body) };
}

/** 云 ASR：MiMo 走 input_audio 的 chat/completions；OpenAI 兼容走 /audio/transcriptions。 */
export async function transcribeAudio(config: AsrConfig, audioPath: string, signal?: AbortSignal): Promise<TranscribeResult> {
  // 音频时长先量一次，**只作兜底**：厂商在响应里报了秒数就用厂商的（MiMo 会报 `usage.seconds`），
  // 它不报才用这个。量不出来记 0——宁可界面少显示一个数，也不要拿码率反推一个假时长。
  const measuredSeconds = await wavDataSeconds(audioPath);
  if (config.engine === "mimo") {
    return transcribeMimo(config, audioPath, measuredSeconds, signal);
  }
  return transcribeOpenAiCompatible(config, audioPath, measuredSeconds, signal);
}

// MiMo 的 input_audio 把整段音频塞进 base64 data URL，官方文档限制编码后字符串最大 10MB。
// 按原始 PCM 7MB（base64 约 9.3MB）切块，留出 data URL 前缀余量。
const MIMO_MAX_AUDIO_BYTES = 7 * 1024 * 1024;

/** WAV 头部探测窗口：ffmpeg 产出的头远小于这个值；超出视为非常规 WAV，退回整读。 */
const WAV_HEADER_PROBE_BYTES = 64 * 1024;

/**
 * 从 WAV 头量出音频时长（秒）。量不出来返回 0。
 *
 * 这是**兜底**：OpenAI 的 `/audio/transcriptions` 在 `verbose_json` 下会带 `usage`（可能含 `duration`），
 * MiMo 会带 `usage.seconds`，那些都优先。只有厂商不报时才用这里量出来的值。
 * 送进来的是本项目自己用 ffmpeg 归一化出的 WAV（见 media.ts 的 `toAsrWav`），头是规整的；
 * 但用户也可能把别的 wav 塞进来，所以解析失败一律返回 0，不抛错、不影响转写本身。
 */
export async function wavDataSeconds(audioPath: string): Promise<number> {
  const handle = await open(audioPath, "r");
  try {
    const fileSize = (await handle.stat()).size;
    const probe = Buffer.alloc(WAV_HEADER_PROBE_BYTES);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    const head = probe.subarray(0, bytesRead);
    if (head.length < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return 0;
    let offset = 12;
    let byteRate = 0;
    let dataSize = -1;
    let dataOffset = -1;
    while (offset + 8 <= head.length) {
      const id = head.toString("ascii", offset, offset + 4);
      const size = head.readUInt32LE(offset + 4);
      // fmt 块：byteRate 在「块头 8 字节 + 格式 8 字节（audioFormat/声道/采样率）」之后。
      if (id === "fmt " && offset + 24 <= head.length) byteRate = head.readUInt32LE(offset + 16);
      if (id === "data") {
        dataOffset = offset + 8;
        dataSize = Math.min(size, Math.max(0, fileSize - dataOffset));
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (byteRate <= 0 || dataSize <= 0) return 0;
    return dataSize / byteRate;
  } catch {
    return 0;
  } finally {
    await handle.close();
  }
}

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

async function transcribeMimo(config: AsrConfig, audioPath: string, measuredSeconds: number, signal?: AbortSignal): Promise<TranscribeResult> {
  const results: string[] = [];
  let total = emptyApiUsage();
  let announcedSeconds = false;

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
    const { content, usage } = await handleChatResponse(res);
    // 每块一次调用、各自计一次钱。音频秒数只记一遍——它是**整段文件**的时长，不是单块的。
    // 厂商报的（`usage.seconds`）优先；它没报才用我们量出来的那个。
    if (!announcedSeconds) {
      usage.audioSeconds = usage.audioSeconds > 0 ? usage.audioSeconds : measuredSeconds;
      announcedSeconds = true;
    } else {
      usage.audioSeconds = 0;
    }
    total = addApiUsage(total, usage);
    const text = content.trim();
    if (text) results.push(text);
  }

  return { text: results.join("\n\n"), usage: total };
}

/**
 * OpenAI 兼容的 `/audio/transcriptions`。
 *
 * 用 `verbose_json` 而不是 `json`：官方 spec 里两者**都**带 `usage`，但只有 `verbose_json` 多一个
 * 顶层 `duration`，而 usage 本身有两种形态——`{type:"duration", seconds}`（按音频时长计费）
 * 与 `{type:"tokens", input_tokens}`（按 token 计费），正好对应两类模型。
 * 上一版用 `json` 并断言"不返回 usage"，那是只对着自己的 mock 测出来的错误结论。
 *
 * `verbose_json` 并非所有兼容实现都支持，所以失败时**退回 `json` 重试一次**——转写是最贵的一步，
 * 不该因为要多拿一个用量字段就把它整个丢掉。退回后用量只剩自己量出来的秒数。
 */
async function transcribeOpenAiCompatible(config: AsrConfig, audioPath: string, measuredSeconds: number, signal?: AbortSignal): Promise<TranscribeResult> {
  const send = async (format: "verbose_json" | "json") => {
    const form = new FormData();
    // openAsBlob 让 FormData 直接引用磁盘文件，不再把整段音频读进 JS 堆
    const file = await openAsBlob(audioPath, { type: "audio/wav" });
    form.append("file", file, `${basename(audioPath, ".wav") || "audio"}.wav`);
    form.append("model", config.model || "whisper-1");
    form.append("response_format", format);
    return fetch(`${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: withTimeout(signal, 600_000),
    });
  };

  let res = await send("verbose_json");
  if (!res.ok) res = await send("json");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ASR 接口请求失败（${res.status}）${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as { text?: string; duration?: number; error?: { message?: string }; message?: string; usage?: UsageShape };
  if (body.error?.message) throw new Error(body.error.message);
  const text = body.text?.trim();
  if (!text) throw new Error("ASR 接口没有返回文字");

  const usage = { ...emptyApiUsage(), ...usageOf(body) };
  // 秒数两处兜底：厂商报的（`usage.seconds`，按秒计费那类模型）→ verbose_json 的顶层 `duration`
  // → 我们自己从 WAV 头量的。都没有就记 0，**不影响转写结果**——宁可少显示一个数。
  if (usage.audioSeconds <= 0 && typeof body.duration === "number") usage.audioSeconds = body.duration;
  if (usage.audioSeconds <= 0) usage.audioSeconds = measuredSeconds;
  return { text, usage };
}
