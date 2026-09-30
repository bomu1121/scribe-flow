import { formatBytes } from "@/lib/bytes";
import { fmtDuration } from "@/utils/run-segments";

/**
 * 结果页「链路输入」面板的行文案规则。
 *
 * 抽成纯函数是为了能拿真实运行的数据对拍：面板上这几行字以前写在视图里，
 * 「标签与类型重复」「没有摘要时补一个破折号占位」这类问题只能靠肉眼发现。
 */

/** 阶段标题：0=原始素材；最深一层=最终输入（只有一层时叫「加工结果」）；中间按序号。 */
export function chainStageTitle(depth: number, maxDepth: number): string {
  if (depth === 0) return "原始素材";
  if (depth !== maxDepth) return `加工步骤 ${depth}`;
  return maxDepth === 1 ? "加工结果" : "最终输入";
}

/**
 * 类型后缀：节点名里已经写了这个类型就不再重复。
 *
 * 「转写 · 转写」「AI 校对 · 校对」「输出 · 输出」都是同一个信息写两遍——
 * 类型只在它补充了节点名没说的东西时才出现（节点名「我的处理」配类型「工具」）。
 */
export function chainTypeSuffix(label: string, typeLabel: string): string {
  const name = label.trim();
  const type = typeLabel.trim();
  if (!type || type === name) return "";
  return name.includes(type) ? "" : type;
}

/** 计算副标题需要的字段（结构性子集，避免把视图里的 InputItem 搬进工具函数）。 */
export interface ChainMetaInput {
  nodeType: string;
  summary?: string;
  status?: string;
  error?: string;
  items?: readonly unknown[];
  title?: string;
  uploader?: string;
  duration?: number;
  fileName?: string;
  size?: number;
  text?: string;
}

/**
 * 来源素材的身份：条目标题 / 文件名 / 条目数，加上上传者与时长。
 *
 * 多选卡片只报条目数：卡片 data 里的 `title`、`duration` 存的是其中一条（实测 8 个视频的卡，
 * `title` 是第 4 个视频的标题、`duration` 是第 1 个视频的时长），拿它代表整张卡等于说谎。
 */
function sourceIdentity(input: ChainMetaInput): string[] {
  if (input.nodeType === "source.bili") {
    const parts: string[] = [];
    const count = input.items?.length ?? 0;
    if (count > 1) parts.push(`${count} 个视频`);
    else if (input.title) parts.push(`《${input.title}》`);
    if (input.uploader) parts.push(input.uploader);
    if (count <= 1 && input.duration) parts.push(fmtDuration(input.duration));
    return parts;
  }
  if (input.nodeType === "source.file") {
    const parts: string[] = [];
    if (input.fileName) parts.push(input.fileName);
    if (input.size) parts.push(formatBytes(input.size));
    return parts;
  }
  if (input.nodeType === "source.text") {
    const chars = (input.text ?? "").replace(/\s/g, "").length;
    return chars > 0 ? [`${chars} 字`] : [];
  }
  return [];
}

/**
 * 链路行的副标题：优先用运行摘要；没有摘要时按节点类型把素材事实拼出来。
 *
 * 来源卡**先身份、后状态**：一张链路上常挂着好几张同类来源卡，实测四个「B站链接」的
 * 摘要都是「音轨已就绪」——只给状态的话，四行字一模一样，看不出哪个是哪个。运行摘要
 * 里已经说过的部分不重复（三视频的卡摘要本身就是「3 个视频 · UP 主 · 时长」）。
 *
 * 取不到任何信息时返回**空串**，由调用方省略这一行——「—」占着与真内容同样的位置，
 * 却只说明「这里没东西」，多一层视觉噪音。
 */
export function chainRowMeta(input: ChainMetaInput): string {
  const summary = (input.summary ?? "").trim();
  const parts: string[] = [];
  if (input.nodeType.startsWith("source.")) {
    const identity = sourceIdentity(input);
    parts.push(...identity);
    // 摘要里与身份重复的那一段不再写第二遍（服务端摘要有时就是「3 个视频 · UP 主 · 时长」）。
    const seen = new Set(identity.map((part) => part.trim()));
    for (const part of summary.split("·").map((piece) => piece.trim())) {
      if (part && !seen.has(part)) parts.push(part);
    }
  } else if (summary) {
    parts.push(summary);
  } else if (input.text) {
    const chars = input.text.replace(/\s/g, "").length;
    if (chars > 0) parts.push(`${chars} 字`);
  }
  if (input.status === "error" && input.error) parts.push(input.error);
  if (parts.length > 0) return parts.join(" · ");
  return input.nodeType === "source.text" ? "空文稿" : "";
}
