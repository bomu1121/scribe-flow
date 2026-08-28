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

export function chatCompletion(config: AiConfig, system: string, user: string): Promise<string> {
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
    signal: AbortSignal.timeout(300_000),
  }).then(handleChatResponse);
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
export async function transcribeAudio(config: AsrConfig, audioPath: string): Promise<string> {
  if (config.engine === "mimo") {
    return transcribeMimo(config, audioPath);
  }
  return transcribeOpenAiCompatible(config, audioPath);
}

async function transcribeMimo(config: AsrConfig, audioPath: string): Promise<string> {
  const data = await readFile(audioPath);
  const dataUrl = `data:audio/wav;base64,${data.toString("base64")}`;
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
    signal: AbortSignal.timeout(600_000),
  });
  const content = await handleChatResponse(res);
  return content;
}

async function transcribeOpenAiCompatible(config: AsrConfig, audioPath: string): Promise<string> {
  const form = new FormData();
  const file = new Blob([await readFile(audioPath)], { type: "audio/wav" });
  form.append("file", file, `${basename(audioPath, ".wav") || "audio"}.wav`);
  form.append("model", config.model || "whisper-1");
  form.append("response_format", "json");

  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(600_000),
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
