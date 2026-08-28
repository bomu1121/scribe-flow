import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ServerEnv {
  port: number;
  dataDir: string;
  uploadsDir: string;
  maxUploadMb: number;
  staticDir?: string;
}

export function loadEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? 8787);
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  const uploadsDir = join(dataDir, "uploads");
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 2048);
  const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  return { port, dataDir, uploadsDir, maxUploadMb, staticDir };
}
