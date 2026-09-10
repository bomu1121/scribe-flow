import type { Assertion, RecipeStep } from "@scribe-flow/shared";

/**
 * 配方执行原语（M8-1 阶段 A）：系统模板渲染 / JSON 容错解析 / 确定性断言门。
 * 纯函数，无网络与数据库依赖；引擎在 process.prompt 配方分支中调用。
 */

export interface StepContext {
  /** 该节点的原始输入文本（步骤 0 的 user 消息，也是引用回查的比对源）。 */
  input: string;
  /** 上一步输出。 */
  prev: string;
  /** 此前所有步骤输出（带步骤标记拼接），供需要全局上下文的步骤使用。 */
  all: string;
  /** 当前输入对应的来源元信息（如《视频标题》· UP主 · 链接），由引擎注入。 */
  source?: string;
  /**
   * 节点参数指令（如「考察点数量 / 题型 / 难度」），由引擎按节点 data 生成后注入。
   * 刻意与 input 分离：断言门的引用回查以 input 为比对源，参数不能混进原文。
   */
  params?: string;
}

const TEMPLATE_VARS = ["{{input}}", "{{prev}}", "{{all}}", "{{source}}", "{{params}}"] as const;

/** 展开 {{input}} / {{prev}} / {{all}} / {{source}} / {{params}}；其余 {{...}} 原样保留（避免误伤老提示词）。 */
export function renderStepSystem(template: string, ctx: StepContext): string {
  return template
    .replace(/\{\{input\}\}/g, ctx.input)
    .replace(/\{\{prev\}\}/g, ctx.prev)
    .replace(/\{\{all\}\}/g, ctx.all)
    .replace(/\{\{source\}\}/g, ctx.source ?? "")
    .replace(/\{\{params\}\}/g, ctx.params ?? "");
}

/** 把某一步的输出拼接进“全部产物”上下文。 */
export function appendAllOutput(prevAll: string, step: RecipeStep, text: string): string {
  const label = `【步骤：${step.label}】`;
  return prevAll ? `${prevAll}\n\n${label}\n${text}` : `${label}\n${text}`;
}

/** JSON 容错解析：裸 JSON → 剥离 Markdown 围栏 → 截取首尾大括号；全部失败抛中文错误。 */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fallthrough
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fallthrough
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fallthrough
    }
  }
  throw new Error(`输出不是合法 JSON：${trimmed.slice(0, 80)}…`);
}

interface FieldToken {
  key: string;
  array: boolean;
}

function tokenizePath(path: string): FieldToken[] {
  const tokens: FieldToken[] = [];
  for (const part of path.split(".")) {
    if (!part) continue;
    if (part.endsWith("[]")) tokens.push({ key: part.slice(0, -2), array: true });
    else tokens.push({ key: part, array: false });
  }
  return tokens;
}

/** 按 "blocks[].quotes[]" 这类路径收集全部字符串叶子（数组逐层展开）。 */
export function collectFieldStrings(root: unknown, path: string): string[] {
  const tokens = tokenizePath(path);
  const out: string[] = [];
  const walk = (value: unknown, index: number): void => {
    if (index >= tokens.length) {
      if (typeof value === "string") out.push(value);
      return;
    }
    const token = tokens[index];
    if (token.array) {
      const arr = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[token.key] : undefined;
      if (!Array.isArray(arr)) return;
      for (const item of arr) walk(item, index + 1);
      return;
    }
    if (value === null || typeof value !== "object") return;
    walk((value as Record<string, unknown>)[token.key], index + 1);
  };
  walk(root, 0);
  return out;
}

/** 中文引号/破折号写法各异的归一：只消除标点差异，不改动任何正文字符。 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "—");
}

function normalizeForMatch(text: string): string {
  return normalizeQuotes(text).replace(/\s/g, "");
}

/**
 * 引用开头的句内连接词/前导虚词：模型从分句中间起抄时会顺带改写或丢掉它们
 * （实测把「因为它不需要消灭…」抄成「但它不需要消灭…」），这不改变引用实质，
 * 但会让严格子串匹配失败。只剥离这些无语义的虚词，正文仍须逐字命中。
 */
const LEADING_CONNECTIVES = [
  "但如果",
  "甚至",
  "因此",
  "所以",
  "但是",
  "因为",
  "而且",
  "并且",
  "不过",
  "而",
  "但",
  "它",
];

/** 引用是否为「仅开头被截断」：剥离最多 4 个前导虚词后能在原文逐字找到。 */
function matchesAfterTrimmedLead(normInput: string, normQuote: string): boolean {
  const candidates: string[] = [];
  let current = normQuote;
  for (let step = 0; step < 4; step += 1) {
    const connective = LEADING_CONNECTIVES.find((word) => current.startsWith(word));
    if (!connective) break;
    current = current.slice(connective.length);
    if (current.length >= 6) candidates.push(current);
  }
  return candidates.some((candidate) => normInput.includes(candidate));
}

export interface AssertResult {
  ok: boolean;
  errors: string[];
}

/**
 * 确定性断言门。引用回查的宽容规则（均只豁免「不改变实质」的差异）：
 * 短引用（<6 字）、省略号结尾（模型截断常见）、引用符号写法归一、仅开头虚词被改写的截断引用。
 */
export function evaluateAsserts(step: RecipeStep, outputText: string, ctx: StepContext): AssertResult {
  const asserts = step.expects?.asserts;
  if (!asserts || asserts.length === 0) return { ok: true, errors: [] };
  const errors: string[] = [];
  const inputNorm = normalizeForMatch(ctx.input);

  for (const assert of asserts) {
    const describe = `[${assert.op}]`;
    switch (assert.op) {
      case "contains":
        if (!outputText.includes(assert.value)) errors.push(`${describe} 输出缺少「${assert.value}」`);
        break;
      case "notContains":
        if (outputText.includes(assert.value)) errors.push(`${describe} 输出不应包含「${assert.value}」`);
        break;
      case "lengthGte":
        if (outputText.length < assert.value) errors.push(`${describe} 输出长度 ${outputText.length} < ${assert.value}`);
        break;
      case "lengthLte":
        if (outputText.length > assert.value) errors.push(`${describe} 输出长度 ${outputText.length} > ${assert.value}`);
        break;
      case "jsonRootKeys": {
        let parsed: unknown;
        try {
          parsed = parseJsonLoose(outputText);
        } catch (error) {
          errors.push(`${describe} ${error instanceof Error ? error.message : "JSON 解析失败"}`);
          break;
        }
        const missing = assert.value.filter((key) => {
          const root = parsed as Record<string, unknown> | null;
          return root === null || typeof root !== "object" || !(key in root);
        });
        if (missing.length > 0) errors.push(`${describe} 缺少根键：${missing.join("、")}`);
        break;
      }
      case "citationsInOriginal": {
        let parsed: unknown;
        try {
          parsed = parseJsonLoose(outputText);
        } catch (error) {
          errors.push(`${describe} ${error instanceof Error ? error.message : "JSON 解析失败"}`);
          break;
        }
        const quotes = collectFieldStrings(parsed, assert.field);
        const misses: string[] = [];
        for (const quote of quotes) {
          const raw = quote.trim();
          if (!raw || raw.length < 6 || raw.endsWith("…") || raw.endsWith("...") || raw.endsWith("……")) continue;
          const normQuote = normalizeForMatch(raw);
          if (!inputNorm.includes(normQuote) && !matchesAfterTrimmedLead(inputNorm, normQuote)) {
            misses.push(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
          }
        }
        const report = misses.slice(0, assert.maxMiss + 3);
        if (misses.length > assert.maxMiss) {
          errors.push(`${describe} 有 ${misses.length} 条引用未在原文找到${report.length > 0 ? `：${report.join("；")}` : ""}`);
        }
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 单步校验入口：kind=json 先容错解析；断言不通过抛带步骤标签的中文错误（非自动重试类）。 */
export function assertStepOutput(step: RecipeStep, outputText: string, ctx: StepContext): void {
  if (step.expects?.kind === "json") {
    parseJsonLoose(outputText);
  }
  const result = evaluateAsserts(step, outputText, ctx);
  if (!result.ok) {
    throw new Error(`步骤「${step.label}」断言未通过：${result.errors.slice(0, 3).join("；")}`);
  }
}
