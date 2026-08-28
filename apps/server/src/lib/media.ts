import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";

export const BILI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });
}

/** 任意音视频转 16k 单声道 wav（云 ASR 输入格式）。 */
export async function toAsrWav(inputPath: string, outputPath: string) {
  await runFfmpeg(["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath]);
}

interface DashAudio {
  id: number;
  bandwidth: number;
  baseUrl: string;
}

interface PlayUrlResponse {
  code: number;
  message?: string;
  data?: {
    dash?: { audio?: DashAudio[]; duration?: number };
    durl?: { url: string }[];
    accept_quality?: number[];
  };
}

/**
 * 下载 B 站视频音轨：优先 DASH 最高码率，失败回退 durl。
 * 返回本地 m4s 路径（后续统一转 wav）。
 */
export async function downloadBiliAudio(bvid: string, cid: number, cookie: string | undefined, destDir: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": BILI_USER_AGENT,
    Referer: "https://www.bilibili.com/",
    Accept: "application/json",
  };
  if (cookie) headers.Cookie = cookie;

  const url = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&fnver=0&fourk=1&qn=64`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`B 站播放地址请求失败（${res.status}）`);
  const body = (await res.json()) as PlayUrlResponse;
  if (body.code !== 0 || !body.data) throw new Error(body.message || "获取播放地址失败");

  const audios = (body.data.dash?.audio ?? []).sort((a, b) => b.bandwidth - a.bandwidth);
  const audioUrl = audios[0]?.baseUrl ?? body.data.durl?.[0]?.url;
  if (!audioUrl) throw new Error("该视频没有可下载的音轨");

  const outPath = join(destDir, "audio.m4s");
  const audioRes = await fetch(audioUrl, {
    headers: {
      "User-Agent": BILI_USER_AGENT,
      Referer: "https://www.bilibili.com/",
    },
    signal: AbortSignal.timeout(600_000),
  });
  if (!audioRes.ok || !audioRes.body) throw new Error(`音轨下载失败（${audioRes.status}）`);
  await pipeline(Readable.fromWeb(audioRes.body as never), createWriteStream(outPath));
  return outPath;
}
