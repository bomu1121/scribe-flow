import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { Hono } from "hono";

const ALLOWED_EXTENSIONS = new Set([".mp4", ".m4a", ".mkv", ".flv", ".mov", ".wav", ".mp3", ".aac", ".webm", ".m4v"]);
const ALLOWED_MIME_PREFIXES = ["audio/", "video/"];

export function filesApi(uploadsDir: string, maxUploadMb: number) {
  const api = new Hono();

  api.post("/upload", (c) => {
    return new Promise<Response>((resolve) => {
      const maxBytes = maxUploadMb * 1024 * 1024;
      const contentType = c.req.header("Content-Type") ?? "";
      if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
        resolve(c.json({ error: "上传格式不正确，请使用 multipart/form-data" }, 400));
        return;
      }
      let busboy: Busboy.Busboy;
      try {
        // defParamCharset 必须 utf8：默认 latin1 会把中文文件名解成乱码
        busboy = Busboy({ headers: { "content-type": contentType }, limits: { files: 1, fields: 4, fileSize: maxBytes }, defParamCharset: "utf8" });
      } catch {
        resolve(c.json({ error: "上传格式不正确，请使用 multipart/form-data" }, 400));
        return;
      }

      // 上限内的 2GB 视频不允许撑爆内存：multipart 用 busboy 边收边写盘，
      // 不再走 formData()（undici 会把整个文件缓冲进内存）。
      // 契约与旧的 formData 实现保持一致：校验顺序、错误文案、返回字段都不变。
      let settled = false;
      const reply = (body: unknown, status: 200 | 400 | 413 | 500) => {
        if (settled) return;
        settled = true;
        resolve(c.json(body, status));
      };

      let sawFile = false;
      let invalid: { error: string } | null = null;
      let truncated = false;
      let partPath: string | null = null;
      let finalName: string | null = null;
      let fileName = "";
      let writePromise: Promise<void> = Promise.resolve();

      busboy.on("file", (name, stream, info) => {
        if (name !== "file" || sawFile) {
          stream.resume(); // 其余文件字段与所有普通字段一律排空
          return;
        }
        sawFile = true;
        const extension = extname(info.filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          invalid = { error: "仅支持常见音视频格式（mp4/m4a/mkv/flv/mov/wav/mp3/aac/webm/m4v）" };
          stream.resume();
          return;
        }
        if (!ALLOWED_MIME_PREFIXES.some((prefix) => info.mimeType.startsWith(prefix))) {
          invalid = { error: "文件类型不是音频或视频" };
          stream.resume();
          return;
        }
        const fileId = randomUUID();
        // 不假设上传目录已经存在：`loadEnv` 现在会建它，但把这件事留给启动路径意味着
        // 目录被删掉（或换个入口装配 app）时，用户看到的是 500 加一条含绝对路径的错误。
        partPath = join(uploadsDir, `.part-${fileId}`);
        finalName = `${fileId}${extension}`;
        fileName = info.filename;
        stream.on("limit", () => {
          truncated = true;
        });
        writePromise = (async () => {
          await mkdir(uploadsDir, { recursive: true });
          await pipeline(stream, createWriteStream(partPath!));
          if (stream.truncated) truncated = true;
        })();
      });

      busboy.on("close", async () => {
        try {
          await writePromise;
          if (!sawFile) {
            reply({ error: "缺少上传文件" }, 400);
            return;
          }
          if (invalid) {
            if (partPath) await rm(partPath, { force: true });
            reply(invalid, 400);
            return;
          }
          const size = (await stat(partPath!)).size;
          if (size <= 0) {
            await rm(partPath!, { force: true });
            reply({ error: "文件内容为空" }, 400);
            return;
          }
          // busboy 的 fileSize 上限会静默截断流，超限与否看 truncated 标志而不是文件大小
          if (truncated || size > maxBytes) {
            await rm(partPath!, { force: true });
            reply({ error: `文件超过 ${maxUploadMb}MB 上限` }, 413);
            return;
          }
          await rename(partPath!, join(uploadsDir, finalName!));
          reply({ fileId: finalName!.slice(0, -extname(finalName!).length), fileName, storedPath: `uploads/${finalName}`, size }, 200);
        } catch (err) {
          if (partPath) await rm(partPath, { force: true }).catch(() => undefined);
          reply({ error: `保存上传文件失败：${err instanceof Error ? err.message : String(err)}` }, 500);
        }
      });

      busboy.on("error", () => {
        if (partPath) void rm(partPath, { force: true }).catch(() => undefined);
        reply({ error: "上传格式不正确，请使用 multipart/form-data" }, 400);
      });

      const source = Readable.fromWeb(c.req.raw.body as NodeWebReadableStream);
      source.on("error", (err) => busboy.destroy(err));
      source.pipe(busboy);
    });
  });

  return api;
}
