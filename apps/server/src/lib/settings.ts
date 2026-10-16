import { eq } from "drizzle-orm";
import type { AiSettings, AppSettings, AsrSettings, GeneralSettings, NodeType, SearchProvider, TagViewMode, UpdateSettingsRequest } from "@scribe-flow/shared";
import { DEFAULT_EXTRACT_FIELDS, DEFAULT_FILE_NAME_TEMPLATE, DEFAULT_OUTPUT_DIR, DEFAULT_TAG_VIEW, GENERAL_LIMITS, NODE_TYPE_ORDER, AUTO_TAG_GROUPS, TAG_VIEW_MODES, backupLocationOf, joinBackupPath, sanitizeExtractFields, sanitizeTaxonomy } from "@scribe-flow/shared";
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
  "obsidian.tagView": DEFAULT_TAG_VIEW,
  "obsidian.autoTagEnabled": "true",
  "obsidian.sourceTagEnabled": "true",
  "obsidian.upTagEnabled": "true",
  "obsidian.allowNewTags": "false",
  "obsidian.extractFields": JSON.stringify(DEFAULT_EXTRACT_FIELDS),
  "obsidian.tagMinCount": "5",
  "obsidian.tagMaxCount": "10",
  "obsidian.autoLinkEnabled": "true",
  "obsidian.autoLinkMax": "5",
};

const NUTSTORE_DEFAULTS: Record<string, string> = {
  "nutstore.serverUrl": "https://dav.jianguoyun.com/dav/",
  "nutstore.account": "",
  "nutstore.backupDir": "/我的坚果云/ScribeFlow/backups",
  "nutstore.obsidianRemotePath": "/我的坚果云/ScribeFlow/Obsidian",
  "nutstore.obsidianMode": "false",
};

/** 旧键：以前这里存的是「备份根目录」，实际备份落在它下面的 `backups/`。 */
const LEGACY_BACKUP_ROOT_KEY = "nutstore.remoteRoot";

/**
 * 出厂词库：**只放用户维护的话题分组**。
 *
 * `来源` 与 `UP主名称` 不在里面——它们由元数据在生成笔记时自动写入，用户只能决定"要不要写"
 * （两个开关见 `obsidian.sourceTagEnabled` / `obsidian.upTagEnabled`），不参与词库编辑、
 * AI 分配与全库回补。`概念` / `状态` 也从出厂值里撤掉了：前者用户看不懂用途，
 * 后者模型不可能知道（见 CHANGELOG）。
 */
const DEFAULT_TAG_TAXONOMY: Record<string, string[]> = {
  类型: ["视频笔记", "学习笔记", "思维导图", "会议纪要"],
  领域: ["历史", "AI", "编程", "效率", "心理", "知识管理"],
};

/** 已从出厂词库退休的分组：内容还是出厂那套就一并清掉，用户自己改过就留着（不删用户的东西）。 */
const RETIRED_TAG_DEFAULTS: Record<string, string[]> = {
  概念: ["Obsidian", "PARA", "Zettelkasten", "RAG", "双链", "Templater", "Dataview"],
  状态: ["未整理", "已整理"],
};

/**
 * 单价读取（元 / 百万 token、元 / 分钟）。
 *
 * **0 是合法值**（＝没填单价，界面只显示 token 不折算金额），所以不能写 `Number(x) || fallback`。
 * 负数与解析不出来的输入一律当 0：宁可少显示一个数，也不要显示一个负的钱。
 */
function readPrice(db: AppDatabase, key: string): number {
  const parsed = Number(raw(db, key, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** 单价入库。非有限值或负数一律落成 0（＝清空）。 */
function writePrice(db: AppDatabase, key: string, value: number) {
  set(db, key, String(Number.isFinite(value) && value > 0 ? value : 0));
}

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

/**
 * 「每篇最多关联几篇」的读取。
 *
 * 这里不能用 `Number(...) || 5` 那种兜底写法：**0 是合法值**（＝不关联，界面上可以调到 0），
 * 而 `0 || 5` 会把它悄悄变成 5，于是"关掉"这个动作在服务端根本没生效——用户调到 0、
 * 保存、看起来成功了，保存时却还在给他连笔记。只能判"读出来的是不是个数"。
 */
function readAutoLinkMax(db: AppDatabase): number {
  const parsed = Number(raw(db, "obsidian.autoLinkMax", OBSIDIAN_DEFAULTS["obsidian.autoLinkMax"]));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(20, Math.trunc(parsed))) : 5;
}

/**
 * 词库读取时的收口：规范化 + 把**不再属于词库的分组**摘掉。
 *
 * 老安装的 `obsidian.tagTaxonomy` 里存着整套出厂值（设置页整表回写），所以改默认值对它不生效——
 * 只能在这里收口。读的时候收口而不是写迁移脚本，是为了让"没保存过的人"也立刻看到新口径，
 * 而且下次保存时自然落库。摘两类：
 * - **自动分组**（`来源` / `UP主名称`）：它们改由元数据写、只留开关，留在词库里会让 AI 重复分配；
 * - **退休分组**（`概念` / `状态`）：只在其内容仍是出厂那套时摘掉，用户自己加过的就留着。
 */
function readTagTaxonomy(db: AppDatabase): Record<string, string[]> {
  const taxonomy = sanitizeTaxonomy(rawJson<Record<string, string[]>>(db, "obsidian.tagTaxonomy", DEFAULT_TAG_TAXONOMY));
  const isRetiredDefault = (group: string, children: string[]): boolean => {
    const retired = RETIRED_TAG_DEFAULTS[group];
    if (!retired) return false;
    const current = new Set(children.map((child) => child.toLowerCase()));
    return retired.length === current.size && retired.every((name) => current.has(name.toLowerCase()));
  };
  const out: Record<string, string[]> = {};
  for (const [group, children] of Object.entries(taxonomy)) {
    if (AUTO_TAG_GROUPS.includes(group)) continue;
    if (isRetiredDefault(group, children)) continue;
    out[group] = children;
  }
  return out;
}

/**
 * 读词库编辑器的显示样式。
 *
 * 只认三种已知值：手改过库、或将来删掉某个模式之后，坏值一律回落默认——
 * 这一格是纯展示设置，不值得因为它让设置页打不开。
 */
function readTagView(db: AppDatabase): TagViewMode {
  const stored = raw(db, "obsidian.tagView", "");
  const hit = TAG_VIEW_MODES.find((mode) => mode.id === stored);
  return hit ? hit.id : DEFAULT_TAG_VIEW;
}

/**
 * 读备份目录。
 *
 * 老键 `nutstore.remoteRoot` 存的是"根目录"，当时备份落在它下面的 `backups/`；
 * 迁移时把这个落点保留下来（补上 `/backups`），否则升级后备份会跑到别处去。
 */
function readBackupDir(db: AppDatabase): string {
  const stored = raw(db, "nutstore.backupDir", "").trim();
  if (stored) return stored;
  const legacy = raw(db, LEGACY_BACKUP_ROOT_KEY, "").trim();
  if (!legacy) return NUTSTORE_DEFAULTS["nutstore.backupDir"] as string;
  return joinBackupPath(migrateNutstorePath(legacy, "/我的坚果云/ScribeFlow"), "backups");
}

export function getSettings(db: AppDatabase): AppSettings {
  return {
    ai: {
      provider: (raw(db, "ai.provider", AI_DEFAULTS["ai.provider"]) ?? "deepseek") as AiSettings["provider"],
      baseUrl: raw(db, "ai.baseUrl", AI_DEFAULTS["ai.baseUrl"]) ?? "",
      model: raw(db, "ai.model", AI_DEFAULTS["ai.model"]) ?? "",
      hasKey: Boolean(raw(db, "ai.apiKey", "")),
      inputPricePerMillion: readPrice(db, "ai.inputPricePerMillion"),
      outputPricePerMillion: readPrice(db, "ai.outputPricePerMillion"),
      cachedInputPricePerMillion: readPrice(db, "ai.cachedInputPricePerMillion"),
      priceCurrency: raw(db, "ai.priceCurrency", "CNY") === "USD" ? "USD" : "CNY",
    },
    asr: {
      engine: (raw(db, "asr.engine", ASR_DEFAULTS["asr.engine"]) ?? "mimo") as AsrSettings["engine"],
      baseUrl: raw(db, "asr.baseUrl", ASR_DEFAULTS["asr.baseUrl"]) ?? "",
      model: raw(db, "asr.model", ASR_DEFAULTS["asr.model"]) ?? "",
      hasKey: Boolean(raw(db, "asr.apiKey", "")),
      pricePerMinute: readPrice(db, "asr.pricePerMinute"),
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
    visibility: {
      hiddenNodes: parseHiddenNodes(raw(db, "visibility.hiddenNodes", "[]") ?? "[]"),
    },
    obsidian: {
      vaultPath: raw(db, "obsidian.vaultPath", OBSIDIAN_DEFAULTS["obsidian.vaultPath"]) ?? "",
      folder: raw(db, "obsidian.folder", OBSIDIAN_DEFAULTS["obsidian.folder"]) ?? "00-Inbox",
      tagView: readTagView(db),
      tagTaxonomy: readTagTaxonomy(db),
      autoTagEnabled: raw(db, "obsidian.autoTagEnabled", OBSIDIAN_DEFAULTS["obsidian.autoTagEnabled"]) === "true",
      sourceTagEnabled: raw(db, "obsidian.sourceTagEnabled", OBSIDIAN_DEFAULTS["obsidian.sourceTagEnabled"]) === "true",
      upTagEnabled: raw(db, "obsidian.upTagEnabled", OBSIDIAN_DEFAULTS["obsidian.upTagEnabled"]) === "true",
      allowNewTags: raw(db, "obsidian.allowNewTags", OBSIDIAN_DEFAULTS["obsidian.allowNewTags"]) === "true",
      extractFields: sanitizeExtractFields(rawJson<unknown>(db, "obsidian.extractFields", DEFAULT_EXTRACT_FIELDS)),
      tagMinCount: Number(raw(db, "obsidian.tagMinCount", OBSIDIAN_DEFAULTS["obsidian.tagMinCount"]) ?? 5) || 5,
      tagMaxCount: Number(raw(db, "obsidian.tagMaxCount", OBSIDIAN_DEFAULTS["obsidian.tagMaxCount"]) ?? 10) || 10,
      autoLinkEnabled: raw(db, "obsidian.autoLinkEnabled", OBSIDIAN_DEFAULTS["obsidian.autoLinkEnabled"]) === "true",
      autoLinkMax: readAutoLinkMax(db),
    },
    nutstore: {
      serverUrl: raw(db, "nutstore.serverUrl", NUTSTORE_DEFAULTS["nutstore.serverUrl"]) ?? "https://dav.jianguoyun.com/dav/",
      account: raw(db, "nutstore.account", NUTSTORE_DEFAULTS["nutstore.account"]) ?? "",
      hasPassword: Boolean(raw(db, "nutstore.password", "")),
      backupDir: readBackupDir(db),
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

/**
 * 解析展示范围里存着的节点类型列表。
 * 坏数据（手改过库、旧版本写过别的形状）一律当作「什么都没隐藏」，不让设置页因此打不开。
 */
function parseHiddenNodes(value: string): NodeType[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is NodeType => typeof item === "string" && NODE_TYPE_ORDER.includes(item as NodeType)))];
  } catch {
    return [];
  }
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
    // 判 undefined 不判真值：0 是「清空单价」这个合法动作，用真值判断会让它永远清不掉。
    if (patch.ai.inputPricePerMillion !== undefined) writePrice(db, "ai.inputPricePerMillion", patch.ai.inputPricePerMillion);
    if (patch.ai.outputPricePerMillion !== undefined) writePrice(db, "ai.outputPricePerMillion", patch.ai.outputPricePerMillion);
    if (patch.ai.cachedInputPricePerMillion !== undefined) writePrice(db, "ai.cachedInputPricePerMillion", patch.ai.cachedInputPricePerMillion);
    if (patch.ai.priceCurrency !== undefined) set(db, "ai.priceCurrency", patch.ai.priceCurrency === "USD" ? "USD" : "CNY");
  }
  if (patch.asr) {
    if (patch.asr.engine) set(db, "asr.engine", patch.asr.engine);
    if (patch.asr.baseUrl) set(db, "asr.baseUrl", patch.asr.baseUrl.trim().replace(/\/+$/, ""));
    if (patch.asr.model) set(db, "asr.model", patch.asr.model.trim());
    if (patch.asr.apiKey) set(db, "asr.apiKey", patch.asr.apiKey.trim());
    if (patch.asr.pricePerMinute !== undefined) writePrice(db, "asr.pricePerMinute", patch.asr.pricePerMinute);
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
  if (patch.visibility) {
    if (patch.visibility.hiddenNodes !== undefined) {
      // 只留认识的节点类型：老设置里出现的已废弃类型不该把界面搞坏。
      const unique = [...new Set(patch.visibility.hiddenNodes.filter((type) => NODE_TYPE_ORDER.includes(type)))];
      set(db, "visibility.hiddenNodes", JSON.stringify(unique));
    }
  }
  if (patch.obsidian) {
    if (patch.obsidian.vaultPath !== undefined) set(db, "obsidian.vaultPath", patch.obsidian.vaultPath.trim().replace(/[\\/]+$/, ""));
    if (patch.obsidian.folder !== undefined) set(db, "obsidian.folder", patch.obsidian.folder.trim().replace(/^[\\/]+|[\\/]+$/g, "") || "00-Inbox");
    // 显示样式只认三种已知值：不认识的输入直接丢掉，别把设置页写成一个打不开的状态
    const nextTagView = patch.obsidian.tagView;
    if (nextTagView !== undefined && TAG_VIEW_MODES.some((mode) => mode.id === nextTagView)) {
      set(db, "obsidian.tagView", nextTagView);
    }
    if (patch.obsidian.tagTaxonomy !== undefined) set(db, "obsidian.tagTaxonomy", JSON.stringify(sanitizeTaxonomy(patch.obsidian.tagTaxonomy)));
    if (patch.obsidian.autoTagEnabled !== undefined) set(db, "obsidian.autoTagEnabled", patch.obsidian.autoTagEnabled ? "true" : "false");
    if (patch.obsidian.sourceTagEnabled !== undefined) set(db, "obsidian.sourceTagEnabled", patch.obsidian.sourceTagEnabled ? "true" : "false");
    if (patch.obsidian.upTagEnabled !== undefined) set(db, "obsidian.upTagEnabled", patch.obsidian.upTagEnabled ? "true" : "false");
    if (patch.obsidian.allowNewTags !== undefined) set(db, "obsidian.allowNewTags", patch.obsidian.allowNewTags ? "true" : "false");
    // 空数组是合法值（＝不抽），但 set() 会跳过空串，所以这里序列化成 "[]" 才存得进去。
    if (patch.obsidian.extractFields !== undefined) {
      set(db, "obsidian.extractFields", JSON.stringify(sanitizeExtractFields(patch.obsidian.extractFields)));
    }
    if (patch.obsidian.tagMinCount !== undefined) set(db, "obsidian.tagMinCount", String(Math.max(1, Math.min(20, patch.obsidian.tagMinCount))));
    if (patch.obsidian.tagMaxCount !== undefined) set(db, "obsidian.tagMaxCount", String(Math.max(1, Math.min(30, patch.obsidian.tagMaxCount))));
    if (patch.obsidian.autoLinkEnabled !== undefined) set(db, "obsidian.autoLinkEnabled", patch.obsidian.autoLinkEnabled ? "true" : "false");
    if (patch.obsidian.autoLinkMax !== undefined) set(db, "obsidian.autoLinkMax", String(Math.max(0, Math.min(20, patch.obsidian.autoLinkMax))));
  }
  if (patch.nutstore) {
    if (patch.nutstore.serverUrl !== undefined) {
      const value = patch.nutstore.serverUrl.trim().replace(/\/+$/, "") || "https://dav.jianguoyun.com/dav";
      set(db, "nutstore.serverUrl", `${value}/`);
    }
    if (patch.nutstore.account !== undefined) set(db, "nutstore.account", patch.nutstore.account.trim());
    if (patch.nutstore.password !== undefined && patch.nutstore.password.trim()) set(db, "nutstore.password", patch.nutstore.password.trim());
    if (patch.nutstore.backupDir !== undefined) {
      // 本地路径原样保留（去尾分隔符）；云端路径补上开头的 /。空串回落默认值。
      const value = patch.nutstore.backupDir.trim().replace(/[\\/]+$/, "");
      const fallback = NUTSTORE_DEFAULTS["nutstore.backupDir"] as string;
      if (!value) set(db, "nutstore.backupDir", fallback);
      else if (backupLocationOf(value) === "local") set(db, "nutstore.backupDir", value);
      else set(db, "nutstore.backupDir", value.startsWith("/") ? value : `/${value}`);
    }
    if (patch.nutstore.obsidianRemotePath !== undefined) {
      const value = patch.nutstore.obsidianRemotePath.trim().replace(/\/+$/, "");
      set(db, "nutstore.obsidianRemotePath", value ? (value.startsWith("/") ? value : `/${value}`) : "/我的坚果云/ScribeFlow/Obsidian");
    }
    if (patch.nutstore.obsidianMode !== undefined) set(db, "nutstore.obsidianMode", patch.nutstore.obsidianMode ? "true" : "false");
  }
}
