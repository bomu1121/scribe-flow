import {
  COMPARE_MAX_CHARS,
  clampCompareText,
  measureText,
  parseCompareAnalysis,
  type CompareAnalysis,
} from "@scribe-flow/shared";
import { chatCompletion, type AiConfig } from "./ai";

/**
 * 「对照」的 AI 差异判读。
 *
 * 为什么要有它：行级 diff 在两份「同一素材、两套做法」的 AI 产物上几乎全是噪声——措辞一换整行就算变了，
 * 实测一条真实运行的重合率只有 11%，界面上看就是一片红绿，读不出结论。机械统计（字数/结构计数）仍然保留，
 * 但「差在哪、各自适合什么」交给模型，它才是能直接读的那一层。
 *
 * 与节点配方的区别：这不是流水线上的一步，而是阅读时按需点一次的分析（内容没变就直接读缓存），
 * 所以不挂提示词块、不产生产物、不写盘。
 */

const COMPARE_SYSTEM = [
  "你是内容对照编辑。用户会给你两份**处理同一份素材得到的内容**（例如同一段视频用两套提示词加工出的两篇笔记），",
  "你的任务不是评价文笔，而是把「内容与结构上的差别」讲清楚：哪边多了什么、哪边少了什么、哪些地方两边说得不一样、",
  "以及各自更适合拿去做什麼。让读者不用读完两份就能决定用哪份、或者该把哪边的部分补到另一边。",
  "",
  "## 判断规则",
  "1. 只依据给出的两份正文判断。不许引入外部知识，不许猜测省略处的内容（正文里出现【…此处省略约 N 字…】时，",
  "   与省略区间有关的差异一律不要写，也不要说「右侧缺少后半部分」这种由省略造成的话）。",
  "2. 要具体：写「多了事实与数据表，含 182 个国家和地区的数字」而不是「多了表格」；",
  "   带原文里的专名、数字、时间、型号。detail 字段只放这类定位信息，不要复述整段。",
  "3. 区分「只有一边讲到」和「两边都讲到但说法/口径不同」：前者进 onlyLeft/onlyRight，后者进 conflicts。",
  "   只是措辞不同、意思相同的不算 conflict。",
  "4. 不评好坏、不打分：fit 里写「更适合什么场景」，让读者自己选；不要写「明显更好」这类判断。",
  "5. 两份内容几乎一样时，summary 直接说明这一点，sameNote 写清差在哪（例如只差标题与结尾），其余数组可以为空。",
  "6. 宁可少写也不要凑数：没有内容就留空数组，不要编造条目。",
  "",
  "## 输出格式",
  "只输出 JSON，不要解释，不要 Markdown 围栏：",
  '{"summary":"一句话说清两份的核心差别","onlyLeft":[{"point":"只有左边讲到的内容点","detail":"原文里的专名/数字/位置"}],'
    + '"onlyRight":[{"point":"只有右边讲到的内容点","detail":"同上"}],'
    + '"conflicts":[{"topic":"两边不一致的话题","left":"左边的说法","right":"右边的说法"}],'
    + '"shared":["两边都讲到的要点，短句"],'
    + '"fit":{"left":["左边更适合的场景"],"right":["右边更适合的场景"]},'
    + '"sameNote":"两份几乎一致时的说明，正常时省略"}',
  "",
  "字段上限：onlyLeft / onlyRight 各不超过 8 条，conflicts 不超过 5 条，shared 不超过 6 条，fit 两侧各不超过 3 条；",
  "每条 point 不超过 40 字，summary 不超过 80 字。全部用中文（正文里的专名、数字保持原样）。",
].join("\n");

interface CompareSide {
  label: string;
  text: string;
}

export interface CompareRunMeta {
  /** 是否因为超长被截断（服务端事实，不是模型自述）。 */
  truncated: { left: boolean; right: boolean; maxChars: number };
  /** 送进模型的两侧原始字数（截断前）。 */
  chars: { left: number; right: number };
}

/** 拼用户消息：两侧各带标签与体量，便于模型判断「哪边更完整」。 */
function buildCompareUserMessage(left: CompareSide, right: CompareSide): string {
  const section = (side: CompareSide) => {
    const clamped = clampCompareText(side.text);
    const metrics = measureText(side.text);
    const head = `【${side.label}】共 ${metrics.chars} 字 · ${metrics.lines} 行 · ${metrics.headings} 个标题 · ${metrics.tableRows} 个表格行`;
    return `${head}\n\n${clamped.text}`;
  };
  return [
    "请对下面两份内容做差异判读，只输出 JSON。",
    "",
    section(left),
    "",
    "---",
    "",
    section(right),
  ].join("\n");
}

interface CompareResult {
  analysis: CompareAnalysis;
  meta: CompareRunMeta;
}

/** 调模型 + 解析；解析失败按错误抛出（路由层转成 4xx/5xx 文案）。 */
export async function runCompareAnalysis(
  config: AiConfig,
  left: CompareSide,
  right: CompareSide,
  signal?: AbortSignal,
): Promise<CompareResult> {
  const raw = await chatCompletion(config, COMPARE_SYSTEM, buildCompareUserMessage(left, right), signal);
  const analysis = parseCompareAnalysis(raw);
  return {
    analysis,
    meta: {
      truncated: {
        left: left.text.length > COMPARE_MAX_CHARS,
        right: right.text.length > COMPARE_MAX_CHARS,
        maxChars: COMPARE_MAX_CHARS,
      },
      chars: { left: measureText(left.text).chars, right: measureText(right.text).chars },
    },
  };
}

/** 缓存键：同一对内容 + 同一模型才算命中（换了模型要重判）。 */
export function compareCacheKey(model: string, left: CompareSide, right: CompareSide): string {
  return `${model}\u0000${left.label}\u0000${left.text}\u0000\u0001\u0000${right.label}\u0000${right.text}`;
}
