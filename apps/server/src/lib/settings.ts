import { eq } from "drizzle-orm";
import type { AiSettings, AppSettings, AsrSettings, UpdateSettingsRequest } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { appSettings } from "../db/schema";
import type { AiConfig, AsrConfig } from "./ai";

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

function raw(db: AppDatabase, key: string, fallback: string): string {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? fallback;
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
}
