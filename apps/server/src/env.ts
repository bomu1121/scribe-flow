import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerEnv {
  port: number;
  dataDir: string;
  uploadsDir: string;
  maxUploadMb: number;
  staticDir?: string;
  /** 项目文档目录（仓库根的 docs/），供左侧栏的文档阅读器只读访问。 */
  docsDir: string;
}

export function loadEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? 8787);
  // 默认数据目录锚定到 server 包根目录，避免因启动时 cwd 不同导致“密钥/工程丢失”。
  const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = resolve(process.env.DATA_DIR ?? join(serverRoot, "data"));
  const uploadsDir = join(dataDir, "uploads");
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 2048);
  const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;
  // 文档目录默认锚定到仓库根的 docs/；镜像里没有 COPY docs 时该目录不存在，接口会优雅降级。
  const docsDir = resolve(process.env.DOCS_DIR ?? join(serverRoot, "..", "..", "docs"));
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  return { port, dataDir, uploadsDir, maxUploadMb, staticDir, docsDir };
}
