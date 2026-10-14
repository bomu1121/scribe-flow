/**
 * Obsidian 的 callout：以 `> [!summary] 速览` 开头的一整段引用块。
 *
 * 为什么应用里要认它：内置提示词「观点提炼 · 速览版」把速览与速查写成 callout
 * （取舍与出处见 `docs/research/obsidian-note-typography.md`），而 marked 不认识这个语法——
 * 不处理的话，结果页、画布卡片预览、设置页预览里会直接显示字面的 `[!summary] 速览`。
 *
 * 复刻到什么程度：
 * - 结构（标题行 + 内容）与折叠（`-` 默认折叠、`+` 默认展开）——折叠用原生 `<details>`，
 *   不引 JS；DOMPurify 的默认白名单放行 `details` / `summary` / `open` / `data-*`。
 * - 类型的色调映射到本仓的颜色令牌（样式在 `styles/markdown.css` 的 `.markdown-body .callout`）。
 * - **不复刻** Obsidian 的图标与它自带的 13 色：那是 Obsidian 的视觉语言，应用里有自己的令牌体系；
 *   真机观感以 Obsidian 为准（把 `note-candidates/排版方案demo/` 当库打开即可对照）。
 */
import type { RendererThis, Token, Tokens, TokenizerAndRendererExtension, TokenizerThis } from "marked";

/** 应用里的四种语气 + 中性色，对应 tokens.css 的 `--color-{tone}` / `--color-{tone}-soft`。 */
type CalloutTone = "info" | "success" | "warning" | "error" | "neutral";

/**
 * 类型 → 色调。分组照 Obsidian 默认主题的类型表（见调研文档 §2.6）。
 * 没见过的类型回落中性色，而不是 Obsidian 的「回落 note」——应用里 info 已经是「提示」的语气，
 * 把未知类型也染成提示色会误导。
 */
const TONES: Record<string, CalloutTone> = {
  note: "info",
  info: "info",
  todo: "info",
  summary: "info",
  abstract: "info",
  tldr: "info",
  tip: "info",
  hint: "info",
  important: "info",
  success: "success",
  check: "success",
  done: "success",
  question: "warning",
  help: "warning",
  faq: "warning",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  danger: "error",
  error: "error",
  bug: "error",
  failure: "error",
  fail: "error",
  missing: "error",
};

interface CalloutToken extends Tokens.Generic {
  type: "callout";
  /** 小写后的类型标识符，如 `summary`。 */
  typeId: string;
  /** `-` 默认折叠 / `+` 默认展开 / 空串不折叠。 */
  fold: "-" | "+" | "";
  /** 类型标识符后写的标题；缺省时显示类型名。 */
  title: string;
  tokens: Token[];
}

/** `> [!类型]± 标题`；`±` 是折叠标记。 */
const HEAD = /^> \[!([^\]]+)\]([+-]?)[ \t]*([^\n]*)/;

/** 没给标题时显示类型名，形状与 Obsidian 一致（Title Case：`summary` → `Summary`）。 */
function titleCase(typeId: string): string {
  return typeId.replace(/(^|[- ]+)([a-z])/g, (_, separator: string, letter: string) => (separator ? " " : "") + letter.toUpperCase());
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const obsidianCallout: TokenizerAndRendererExtension = {
  name: "callout",
  level: "block",
  start(src) {
    const index = src.search(/^> \[!/m);
    return index === -1 ? undefined : index;
  },
  tokenizer(this: TokenizerThis, src: string) {
    const head = HEAD.exec(src);
    if (!head) return undefined;
    // 整个引用块一次吃掉：连续以 `>` 开头的行；块内的空行按要求写成单独一个 `>`
    const block: string[] = [];
    for (const line of src.split("\n")) {
      if (!/^>/.test(line)) break;
      block.push(line);
    }
    const token: CalloutToken = {
      type: "callout",
      raw: block.join("\n"),
      typeId: head[1].trim().toLowerCase(),
      fold: head[2] as CalloutToken["fold"],
      title: head[3].trim(),
      tokens: [],
    };
    // 内容从第二行开始：第一行是 `> [!类型] 标题` 本身，它是标题、不是内容
    this.lexer.blockTokens(block.slice(1).map((line) => line.replace(/^>[ \t]?/, "")).join("\n"), token.tokens);
    return token;
  },
  renderer(this: RendererThis, token: Tokens.Generic) {
    const callout = token as CalloutToken;
    const tone = TONES[callout.typeId] ?? "neutral";
    const title = escapeText(callout.title || titleCase(callout.typeId));
    const content = this.parser.parse(callout.tokens);
    const attrs = `class="callout" data-callout="${callout.typeId}" data-tone="${tone}"`;
    if (callout.fold === "") {
      return `<div ${attrs}><div class="callout-title">${title}</div><div class="callout-content">${content}</div></div>\n`;
    }
    const open = callout.fold === "+" ? " open" : "";
    return `<details ${attrs}${open}><summary class="callout-title">${title}</summary><div class="callout-content">${content}</div></details>\n`;
  },
};
