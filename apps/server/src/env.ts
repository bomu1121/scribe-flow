import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerEnv {
  port: number;
  dataDir: string;
}

export function loadEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? 8787);
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });
  return { port, dataDir };
}
