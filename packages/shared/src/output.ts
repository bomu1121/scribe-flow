/**
 * 产物落盘相关的共享规则：输出目录默认值、文件名模板的占位符与渲染。
 *
 * 之所以放在 shared：服务端用它决定「写到哪个文件」，设置页用它把模板渲染成示例文件名给用户看。
 * 两边各写一份必然漂移——用户看到的示例与真正落盘的名字对不上，是比没有示例更糟的事。
 */

/**
 * 多产物节点合并主输出时的连接串。
 *
 * 这是**跨包契约**：服务端引擎按它把「一个输入一份结果」的多份产物拼成一份主输出
 * （`engine.ts` 的 `combineOutputs`），前端结果页按它再切回来（练一练解析、输入对比、溯源导出）。
 * 两边各写一份字面量时不会报错，只会静默对不上——所以值只有这一处，调用点一律引用它。
 * 换行写成转义序列而不是真实换行：真实换行会随格式化/编辑器缩进漂移，而这个值必须逐字节稳定。
 */
export const MULTI_PRODUCT_SEPARATOR = "\n\n---\n\n";

/** 产物根目录的默认名（相对数据目录）。 */
export const DEFAULT_OUTPUT_DIR = "outputs";

/** 自动落盘文件名的默认模板：只用工程名，与历史行为一致。 */
export const DEFAULT_FILE_NAME_TEMPLATE = "{project}";

/** 文件名模板支持的占位符；设置页的说明文字与示例都从这里取。 */
export const FILE_NAME_TOKENS = [
  { token: "{project}", label: "工程名", sample: "某期视频笔记" },
  { token: "{date}", label: "日期", sample: "2026-09-28" },
  { token: "{time}", label: "时间", sample: "143005" },
  { token: "{node}", label: "节点名", sample: "观点提炼" },
] as const;

/** 文件名里不能出现的字符（Windows 与 Obsidian 都不接受）。与引擎侧的路径转义同一份规则。 */
export function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 80);
}

export interface FileNameContext {
  /** 工程名，供 {project} 使用。 */
  project: string;
  /** 产出这份文档的节点名，供 {node} 使用；单产物链路可省略。 */
  node?: string;
  /** 渲染 {date} / {time} 的时间点，由调用方传入以便测试。 */
  now: Date;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * 本地时间的 YYYY-MM-DD。
 * 刻意不用 toISOString：那会换算成 UTC，在东八区晚上 8 点之后会得到「昨天」的文件名。
 */
export function formatFileNameDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 本地时间的 HHmmss；不带冒号，因为冒号在 Windows 文件名里非法。 */
export function formatFileNameTime(now: Date): string {
  return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 渲染文件名模板（不含扩展名）。
 *
 * 认不出来的占位符原样保留——用户能一眼看出自己写错了，而不是被静默吃掉一截。
 * 整串渲染成空时回落到工程名，最后兜底「笔记」，保证永远能写出一个文件。
 */
export function renderFileNameTemplate(template: string, ctx: FileNameContext): string {
  const source = (template ?? "").trim() || DEFAULT_FILE_NAME_TEMPLATE;
  const rendered = source
    .replaceAll("{project}", ctx.project)
    .replaceAll("{date}", formatFileNameDate(ctx.now))
    .replaceAll("{time}", formatFileNameTime(ctx.now))
    .replaceAll("{node}", ctx.node ?? "");
  // 用户自己在模板里写了 .md 也不该得到 a.md.md。
  const stem = sanitizeFileName(rendered).replace(/\.md$/i, "");
  return stem || sanitizeFileName(ctx.project) || "笔记";
}

/** 「同名不覆盖」时最多退让到第几号。到顶还撞就报错——目录里真堆到这个数，该让人去整理了。 */
const MAX_SAME_NAME_SUFFIX = 99;

/**
 * 挑一个没被占用的笔记文件名：`标题.md` → `标题 (2).md` → `标题 (3).md`……
 *
 * 括号用半角，跟文件管理器（资源管理器 / 访达）的形状一致；标题里自带的括号多是全角，
 * 两者挨着出现时不会混。`isTaken` 由调用方给——本地是列一遍保存目录，坚果云是把远端目录列一次——
 * 这里只管挑名字，不碰文件系统，所以能直接对拍。
 *
 * 到 `MAX_SAME_NAME_SUFFIX` 还撞就抛错，而不是继续往下试：真出现这种情况说明保存目录已经乱了，
 * 报错让人去整理，比悄悄再写一篇更有用。
 */
export function uniqueNoteFileName(stem: string, isTaken: (fileName: string) => boolean): string {
  if (!isTaken(`${stem}.md`)) return `${stem}.md`;
  for (let suffix = 2; suffix <= MAX_SAME_NAME_SUFFIX; suffix += 1) {
    const candidate = `${stem} (${suffix}).md`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`保存目录里的同名笔记已排到「${stem} (${MAX_SAME_NAME_SUFFIX}).md」，请先整理该目录`);
}
