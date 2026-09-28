import { eq } from "drizzle-orm";
import type { AiSettings, AppSettings, AsrSettings, GeneralSettings, SearchProvider, UpdateSettingsRequest } from "@scribe-flow/shared";
import { DEFAULT_FILE_NAME_TEMPLATE, DEFAULT_OUTPUT_DIR, GENERAL_LIMITS } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { appSettings } from "../db/schema";
import type { AiConfig, AsrConfig } from "./ai";
import type { NutstoreConfig } from "./nutstore";
import { resolveOutputRoot } from "./storage";

const AI_DEFAULTS: Record<string, string> = {
  "ai.provider": "deepseek",
  "ai.baseUrl": "https://api.deepseek.com/v1",
  "ai.model": "deepseek-chat",
};

const ASR_DEFAULTS: Record<string, string> = {
  "asr.engine": "mimo",
  "asr.baseUrl": "https://api.xiaomimimo.com/v1",
  "asr.model": "mimo-v2.5-asr",
};

const SEARCH_DEFAULTS: Record<string, string> = {
  "search.provider": "zhipu",
  "search.maxResults": "5",
};

const GENERAL_DEFAULTS: Record<string, string> = {
  "general.concurrency": "2",
  "general.outputDir": DEFAULT_OUTPUT_DIR,
  "general.fileNameTemplate": DEFAULT_FILE_NAME_TEMPLATE,
  "general.maxRetries": "2",
  "general.retryBackoffSec": "3",
  "general.runEndNotify": "true",
  "general.runEndSound": "false",
};

const OBSIDIAN_DEFAULTS: Record<string, string> = {
  "obsidian.vaultPath": "",
  "obsidian.folder": "00-Inbox",
  "obsidian.autoTagEnabled": "true",
  "obsidian.tagMinCount": "5",
  "obsidian.tagMaxCount": "10",
  "obsidian.autoLinkEnabled": "true",
  "obsidian.autoLinkMax": "5",
  "obsidian.autoLinkBidirectional": "false",
};

const NUTSTORE_DEFAULTS: Record<string, string> = {
  "nutstore.serverUrl": "https://dav.jianguoyun.com/dav/",
  "nutstore.account": "",
  "nutstore.remoteRoot": "/我的坚果云/ScribeFlow",
  "nutstore.obsidianRemotePath": "/我的坚果云/ScribeFlow/Obsidian",
  "nutstore.obsidianMode": "false",
};

const DEFAULT_TAG_TAXONOMY: Record<string, string[]> = {
  来源: ["B站", "文稿", "本地视频", "网页", "播客"],
  类型: ["视频笔记", "学习笔记", "思维导图", "会议纪要"],
  领域: ["历史", "AI", "编程", "效率", "心理", "知识管理"],
  概念: ["Obsidian", "PARA", "Zettelkasten", "RAG", "双链", "Templater", "Dataview"],
  状态: ["未整理", "已整理"],
};

function raw(db: AppDatabase, key: string, fallback: string): string {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? fallback;
}

function rawJson<T>(db: AppDatabase, key: string, fallback: T): T {
  const value = raw(db, key, "");
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** 把旧版默认路径 /ScribeFlow 迁移到坚果云本地同步文件夹内，避免备份“传到同步文件夹外”。 */
function migrateNutstorePath(value: string, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (normalized === "ScribeFlow") return fallback;
  if (normalized === "ScribeFlow/Obsidian") return fallback;
  return value;
}

const SEARCH_PROVIDERS: SearchProvider[] = ["zhipu", "tavily"];

/**
 * 读取外部检索渠道。
 * 旧版本把渠道硬编码为 Tavily，界面上也始终写 provider=tavily；只存了 Key 而没有 provider 的安装
 * 继续按 Tavily 解释那把密钥，否则升级后会用 Tavily 的 Key 去请求智谱并静默失败。
 */
function searchProviderOf(db: AppDatabase): SearchProvider {
  const stored = raw(db, "search.provider", "");
  if ((SEARCH_PROVIDERS as string[]).includes(stored)) return stored as SearchProvider;
  return raw(db, "search.apiKey", "") ? "tavily" : (SEARCH_DEFAULTS["search.provider"] as SearchProvider);
}

export function getSettings(db: AppDatabase): AppSettings {
  return {
    ai: {
      provider: (raw(db, "ai.provider", AI_DEFAULTS["ai.provider"]) ?? "deepseek") as AiSettings["provider"],
      baseUrl: raw(db, "ai.baseUrl", AI_DEFAULTS["ai.baseUrl"]) ?? "",
      model: raw(db, "ai.model", AI_DEFAULTS["ai.model"]) ?? "",
      hasKey: Boolean(raw(db, "ai.apiKey", "")),
    },
    asr: {
      engine: (raw(db, "asr.engine", ASR_DEFAULTS["asr.engine"]) ?? "mimo") as AsrSettings["engine"],
      baseUrl: raw(db, "asr.baseUrl", ASR_DEFAULTS["asr.baseUrl"]) ?? "",
      model: raw(db, "asr.model", ASR_DEFAULTS["asr.model"]) ?? "",
      hasKey: Boolean(raw(db, "asr.apiKey", "")),
    },
    search: {
      provider: searchProviderOf(db),
      hasKey: Boolean(raw(db, "search.apiKey", "")),
      maxResults: Number(raw(db, "search.maxResults", SEARCH_DEFAULTS["search.maxResults"]) ?? 5) || 5,
    },
    general: {
      concurrency: Number(raw(db, "general.concurrency", GENERAL_DEFAULTS["general.concurrency"]) ?? 2),
      outputDir: raw(db, "general.outputDir", GENERAL_DEFAULTS["general.outputDir"]) ?? DEFAULT_OUTPUT_DIR,
      fileNameTemplate: raw(db, "general.fileNameTemplate", GENERAL_DEFAULTS["general.fileNameTemplate"]) || DEFAULT_FILE_NAME_TEMPLATE,
      maxRetries: Number(raw(db, "general.maxRetries", GENERAL_DEFAULTS["general.maxRetries"]) ?? 2) || 0,
      retryBackoffSec: Number(raw(db, "general.retryBackoffSec", GENERAL_DEFAULTS["general.retryBackoffSec"]) ?? 3) || 3,
      runEndNotify: raw(db, "general.runEndNotify", GENERAL_DEFAULTS["general.runEndNotify"]) === "true",
      runEndSound: raw(db, "general.runEndSound", GENERAL_DEFAULTS["general.runEndSound"]) === "true",
    },
    obsidian: {
      vaultPath: raw(db, "obsidian.vaultPath", OBSIDIAN_DEFAULTS["obsidian.vaultPath"]) ?? "",
      folder: raw(db, "obsidian.folder", OBSIDIAN_DEFAULTS["obsidian.folder"]) ?? "00-Inbox",
      tagTaxonomy: rawJson<Record<string, string[]>>(db, "obsidian.tagTaxonomy", DEFAULT_TAG_TAXONOMY),
      autoTagEnabled: raw(db, "obsidian.autoTagEnabled", OBSIDIAN_DEFAULTS["obsidian.autoTagEnabled"]) === "true",
      tagMinCount: Number(raw(db, "obsidian.tagMinCount", OBSIDIAN_DEFAULTS["obsidian.tagMinCount"]) ?? 5) || 5,
      tagMaxCount: Number(raw(db, "obsidian.tagMaxCount", OBSIDIAN_DEFAULTS["obsidian.tagMaxCount"]) ?? 10) || 10,
      autoLinkEnabled: raw(db, "obsidian.autoLinkEnabled", OBSIDIAN_DEFAULTS["obsidian.autoLinkEnabled"]) === "true",
      autoLinkMax: Number(raw(db, "obsidian.autoLinkMax", OBSIDIAN_DEFAULTS["obsidian.autoLinkMax"]) ?? 5) || 5,
      autoLinkBidirectional: raw(db, "obsidian.autoLinkBidirectional", OBSIDIAN_DEFAULTS["obsidian.autoLinkBidirectional"]) === "true",
    },
    nutstore: {
      serverUrl: raw(db, "nutstore.serverUrl", NUTSTORE_DEFAULTS["nutstore.serverUrl"]) ?? "https://dav.jianguoyun.com/dav/",
      account: raw(db, "nutstore.account", NUTSTORE_DEFAULTS["nutstore.account"]) ?? "",
      hasPassword: Boolean(raw(db, "nutstore.password", "")),
      remoteRoot: migrateNutstorePath(raw(db, "nutstore.remoteRoot", NUTSTORE_DEFAULTS["nutstore.remoteRoot"]) ?? "/我的坚果云/ScribeFlow", "/我的坚果云/ScribeFlow"),
      obsidianRemotePath: migrateNutstorePath(raw(db, "nutstore.obsidianRemotePath", NUTSTORE_DEFAULTS["nutstore.obsidianRemotePath"]) ?? "/我的坚果云/ScribeFlow/Obsidian", "/我的坚果云/ScribeFlow/Obsidian"),
      obsidianMode: raw(db, "nutstore.obsidianMode", NUTSTORE_DEFAULTS["nutstore.obsidianMode"]) === "true",
    },
  };
}

export function getAiConfig(db: AppDatabase): AiConfig {
  const settings = getSettings(db);
  return {
    provider: settings.ai.provider,
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    apiKey: raw(db, "ai.apiKey", ""),
  };
}

export function getAsrConfig(db: AppDatabase): AsrConfig {
  const settings = getSettings(db);
  return {
    engine: settings.asr.engine,
    baseUrl: settings.asr.baseUrl,
    model: settings.asr.model,
    apiKey: raw(db, "asr.apiKey", ""),
  };
}

export interface SearchConfig {
  provider: SearchProvider;
  apiKey: string;
  maxResults: number;
}

export function getSearchConfig(db: AppDatabase): SearchConfig {
  const settings = getSettings(db);
  return {
    provider: settings.search.provider,
    apiKey: raw(db, "search.apiKey", ""),
    maxResults: Math.max(1, Math.min(10, settings.search.maxResults || 5)),
  };
}

export function getNutstoreConfig(db: AppDatabase): NutstoreConfig {
  const settings = getSettings(db);
  return {
    serverUrl: settings.nutstore.serverUrl.trim().replace(/\/+$/, "") + "/",
    account: settings.nutstore.account.trim(),
    password: raw(db, "nutstore.password", ""),
  };
}

function set(db: AppDatabase, key: string, value: string) {
  if (!value) return;
  db.insert(appSettings).values({ key, value, updatedAt: Date.now() }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: Date.now() } }).run();
}

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

/**
 * 补上「只有服务端知道」的字段：产物根目录的绝对路径。
 * 数据目录是启动参数而不是设置项，所以 getSettings 里算不出来，只能在接口层现算。
 * 其余内部调用（engine 等）自己知道 dataDir，不需要绕这一圈。
 */
export function withResolvedPaths(settings: AppSettings, dataDir: string): AppSettings {
  return { ...settings, general: { ...settings.general, resolvedOutputDir: resolveOutputRoot(dataDir, settings.general.outputDir) } };
}

/** engine 侧读取运行默认值用的收口：一次拿到落盘目录与重试策略。 */
export function getGeneralSettings(db: AppDatabase, dataDir: string): GeneralSettings {
  const general = getSettings(db).general;
  return { ...general, resolvedOutputDir: resolveOutputRoot(dataDir, general.outputDir) };
}

export function updateSettings(db: AppDatabase, patch: UpdateSettingsRequest) {
  if (patch.ai) {
    if (patch.ai.provider) set(db, "ai.provider", patch.ai.provider);
    if (patch.ai.baseUrl) set(db, "ai.baseUrl", patch.ai.baseUrl.trim().replace(/\/+$/, ""));
    if (patch.ai.model) set(db, "ai.model", patch.ai.model.trim());
    if (patch.ai.apiKey) set(db, "ai.apiKey", patch.ai.apiKey.trim());
  }
  if (patch.asr) {
    if (patch.asr.engine) set(db, "asr.engine", patch.asr.engine);
    if (patch.asr.baseUrl) set(db, "asr.baseUrl", patch.asr.baseUrl.trim().replace(/\/+$/, ""));
    if (patch.asr.model) set(db, "asr.model", patch.asr.model.trim());
    if (patch.asr.apiKey) set(db, "asr.apiKey", patch.asr.apiKey.trim());
  }
  if (patch.search) {
    if (patch.search.provider && (SEARCH_PROVIDERS as string[]).includes(patch.search.provider)) {
      set(db, "search.provider", patch.search.provider);
    }
    if (patch.search.apiKey !== undefined && patch.search.apiKey.trim()) set(db, "search.apiKey", patch.search.apiKey.trim());
    if (patch.search.maxResults !== undefined) set(db, "search.maxResults", String(Math.max(1, Math.min(10, patch.search.maxResults))));
  }
  if (patch.general) {
    if (patch.general.concurrency !== undefined) {
      set(db, "general.concurrency", String(clamp(patch.general.concurrency, GENERAL_LIMITS.concurrency)));
    }
    if (patch.general.outputDir !== undefined) {
      // 留空即「用回默认目录」，否则 set() 会因空串直接跳过，用户清空后仍看到旧值。
      set(db, "general.outputDir", patch.general.outputDir.trim().replace(/[\\/]+$/, "") || DEFAULT_OUTPUT_DIR);
    }
    if (patch.general.fileNameTemplate !== undefined) {
      set(db, "general.fileNameTemplate", patch.general.fileNameTemplate.trim() || DEFAULT_FILE_NAME_TEMPLATE);
    }
    if (patch.general.maxRetries !== undefined) {
      set(db, "general.maxRetries", String(clamp(patch.general.maxRetries, GENERAL_LIMITS.maxRetries)));
    }
    if (patch.general.retryBackoffSec !== undefined) {
      set(db, "general.retryBackoffSec", String(clamp(patch.general.retryBackoffSec, GENERAL_LIMITS.retryBackoffSec)));
    }
    if (patch.general.runEndNotify !== undefined) set(db, "general.runEndNotify", patch.general.runEndNotify ? "true" : "false");
    if (patch.general.runEndSound !== undefined) set(db, "general.runEndSound", patch.general.runEndSound ? "true" : "false");
  }
  if (patch.obsidian) {
    if (patch.obsidian.vaultPath !== undefined) set(db, "obsidian.vaultPath", patch.obsidian.vaultPath.trim().replace(/[\\/]+$/, ""));
    if (patch.obsidian.folder !== undefined) set(db, "obsidian.folder", patch.obsidian.folder.trim().replace(/^[\\/]+|[\\/]+$/g, "") || "00-Inbox");
    if (patch.obsidian.tagTaxonomy !== undefined) set(db, "obsidian.tagTaxonomy", JSON.stringify(patch.obsidian.tagTaxonomy));
    if (patch.obsidian.autoTagEnabled !== undefined) set(db, "obsidian.autoTagEnabled", patch.obsidian.autoTagEnabled ? "true" : "false");
    if (patch.obsidian.tagMinCount !== undefined) set(db, "obsidian.tagMinCount", String(Math.max(1, Math.min(20, patch.obsidian.tagMinCount))));
    if (patch.obsidian.tagMaxCount !== undefined) set(db, "obsidian.tagMaxCount", String(Math.max(1, Math.min(30, patch.obsidian.tagMaxCount))));
    if (patch.obsidian.autoLinkEnabled !== undefined) set(db, "obsidian.autoLinkEnabled", patch.obsidian.autoLinkEnabled ? "true" : "false");
    if (patch.obsidian.autoLinkMax !== undefined) set(db, "obsidian.autoLinkMax", String(Math.max(0, Math.min(20, patch.obsidian.autoLinkMax))));
    if (patch.obsidian.autoLinkBidirectional !== undefined) set(db, "obsidian.autoLinkBidirectional", patch.obsidian.autoLinkBidirectional ? "true" : "false");
  }
  if (patch.nutstore) {
    if (patch.nutstore.serverUrl !== undefined) {
      const value = patch.nutstore.serverUrl.trim().replace(/\/+$/, "") || "https://dav.jianguoyun.com/dav";
      set(db, "nutstore.serverUrl", `${value}/`);
    }
    if (patch.nutstore.account !== undefined) set(db, "nutstore.account", patch.nutstore.account.trim());
    if (patch.nutstore.password !== undefined && patch.nutstore.password.trim()) set(db, "nutstore.password", patch.nutstore.password.trim());
    if (patch.nutstore.remoteRoot !== undefined) {
      const value = patch.nutstore.remoteRoot.trim().replace(/\/+$/, "");
      set(db, "nutstore.remoteRoot", value ? (value.startsWith("/") ? value : `/${value}`) : "/我的坚果云/ScribeFlow");
    }
    if (patch.nutstore.obsidianRemotePath !== undefined) {
      const value = patch.nutstore.obsidianRemotePath.trim().replace(/\/+$/, "");
      set(db, "nutstore.obsidianRemotePath", value ? (value.startsWith("/") ? value : `/${value}`) : "/我的坚果云/ScribeFlow/Obsidian");
    }
    if (patch.nutstore.obsidianMode !== undefined) set(db, "nutstore.obsidianMode", patch.nutstore.obsidianMode ? "true" : "false");
  }
}
