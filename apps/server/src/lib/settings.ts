import { eq } from "drizzle-orm";
import type { AiSettings, AppSettings, AsrSettings, UpdateSettingsRequest } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { appSettings } from "../db/schema";
import type { AiConfig, AsrConfig } from "./ai";
import type { NutstoreConfig } from "./nutstore";

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

const GENERAL_DEFAULTS: Record<string, string> = {
  "general.concurrency": "2",
  "general.outputDir": "outputs",
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
    general: {
      concurrency: Number(raw(db, "general.concurrency", GENERAL_DEFAULTS["general.concurrency"]) ?? 2),
      outputDir: raw(db, "general.outputDir", GENERAL_DEFAULTS["general.outputDir"]) ?? "outputs",
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
  if (patch.general) {
    if (patch.general.concurrency) set(db, "general.concurrency", String(Math.min(4, Math.max(1, patch.general.concurrency))));
    if (patch.general.outputDir) set(db, "general.outputDir", patch.general.outputDir.trim().replace(/[\\/]+$/, "") || "outputs");
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
