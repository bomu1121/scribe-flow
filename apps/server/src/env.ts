import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerEnv {
  port: number;
  dataDir: string;
  uploadsDir: string;
  maxUploadMb: number;
  staticDir?: string;
}

export function loadEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? 8787);
  // 默认数据目录锚定到 server 包根目录，避免因启动时 cwd 不同导致“密钥/工程丢失”。
  const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = resolve(process.env.DATA_DIR ?? join(serverRoot, "data"));
  const uploadsDir = join(dataDir, "uploads");
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 2048);
  const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  return { port, dataDir, uploadsDir, maxUploadMb, staticDir };
}
