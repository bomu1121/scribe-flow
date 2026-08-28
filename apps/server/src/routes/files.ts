import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Hono } from "hono";

const ALLOWED_EXTENSIONS = new Set([".mp4", ".m4a", ".mkv", ".flv", ".mov", ".wav", ".mp3", ".aac", ".webm", ".m4v"]);
const ALLOWED_MIME_PREFIXES = ["audio/", "video/"];

export function filesApi(uploadsDir: string, maxUploadMb: number) {
  const api = new Hono();

  api.post("/upload", async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "上传格式不正确，请使用 multipart/form-data" }, 400);

    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "缺少上传文件" }, 400);

    const extension = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return c.json({ error: "仅支持常见音视频格式（mp4/m4a/mkv/flv/mov/wav/mp3/aac/webm/m4v）" }, 400);
    }
    if (!ALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) {
      return c.json({ error: "文件类型不是音频或视频" }, 400);
    }

    const maxBytes = maxUploadMb * 1024 * 1024;
    if (file.size <= 0) return c.json({ error: "文件内容为空" }, 400);
    if (file.size > maxBytes) {
      return c.json({ error: `文件超过 ${maxUploadMb}MB 上限` }, 413);
    }

    const fileId = randomUUID();
    const storedName = `${fileId}${extension}`;
    const storedPath = join(uploadsDir, storedName);
    await writeFile(storedPath, Buffer.from(await file.arrayBuffer()));

    return c.json({
      fileId,
      fileName: file.name,
      storedPath: `uploads/${storedName}`,
      size: file.size,
    });
  });

  return api;
}
