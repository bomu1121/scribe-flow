import type { NodeRunStatus } from "@scribe-flow/shared";

/**
 * B 站来源节点「选集面板」的状态与措辞。
 *
 * 两种状态：收起（只留一行摘要，默认态，跑完一次也回到这里）/ 展开（列表 + 勾选位）。
 *
 * 勾选位**常驻可见**，不做「悬停才出现」那一套 —— 那会让鼠标划过每一行时闪一下勾选框，
 * 也让「哪几项已勾选」变成要悬停才看得见的状态。调研范围内做同一件事的成熟产品
 * （Bilibili-Evolved 的下载选集面板、Gmail、Notion、Ant Design 表格、各家下载器）
 * 用的都是常驻勾选框；这比 Material 3「次要选择不该常驻勾选框」那条通则更适合本场景。
 *
 * 为什么展开态不放在组件的 ref 里：画布开了视口裁剪，节点滚出视野会被卸载
 * （见 docs/research/canvas-viewport-culling-remount.md），本地 ref 会跟着没 ——
 * 用户刚点开的列表，拖一下画布再拖回来就自己关了。与 bili-preview-cache 同样的处置。
 */

export type PickerKind = "pages" | "season";

/**
 * 展开态的键：节点 id + 视频 bvid + 列表类型。
 * 带上 bvid 是为了「换视频就回到收起态」，而同一个视频在节点重挂载后仍保住状态；
 * 带上 kind 是因为两个列表各开各的（展开分P 不该把合集也展开）。
 */
export function pickerKey(nodeId: string, bvid: string | undefined, kind: PickerKind): string {
  return `${nodeId}|${bvid ?? ""}|${kind}`;
}

const opened = new Set<string>();

export function readPickerOpen(key: string): boolean {
  return opened.has(key);
}

/** 收起态不占键：默认就是收起，删掉比存一个 false 更省事。 */
export function writePickerOpen(key: string, open: boolean): void {
  if (open) opened.add(key);
  else opened.delete(key);
}

/**
 * 两个列表的措辞集中在这里 —— 分P 与合集各写一遍必然会漂移
 * （改造前那句「同一件事说三遍」就是这么来的：提示行 + 计数 + 按钮 title 各有一份）。
 */
export const PICKER_COPY: Record<
  PickerKind,
  {
    listTitle: string;
    /** 列表总集数。 */
    meta: (total: number) => string;
    selected: (count: number) => string;
    merge: string;
    merged: (count: number) => string;
    /** 悬停某一行时的提示：只说会发生什么，界面上不复述「点行会切换」这件事。 */
    rowHint: string;
  }
> = {
  pages: {
    listTitle: "选择分P",
    meta: (total) => `共 ${total} P`,
    selected: (count) => `已选 ${count} 项`,
    merge: "合并为一张卡片",
    merged: (count) => `已合并 ${count} 个分P为一张卡片`,
    rowHint: "把这个节点换成这一个分P（单条链接，不合并）",
  },
  season: {
    listTitle: "选择合集",
    meta: (total) => `${total} 集`,
    selected: (count) => `已选 ${count} 集`,
    merge: "合并为一张卡片",
    merged: (count) => `已合并 ${count} 集为一张卡片`,
    rowHint: "把这个节点换成这一集（换成它自己的链接，不合并）",
  },
};

/**
 * 收起态那一行写什么。
 *
 * `collapsed && selected >= 2` 时把总集数换成「已选 N 集」：面板收着的时候，
 * 「攒了一个待合并的选集」比「这一共有多少集」更需要被看见。默认只勾着当前这一项
 * （1 项），写出来不传递任何信息，所以不显示。
 */
export function pickerSummary(
  kind: PickerKind,
  args: { title?: string; total: number; selected: number; collapsed: boolean },
): { title: string; meta: string } {
  const copy = PICKER_COPY[kind];
  return {
    title: kind === "season" ? `合集《${args.title || "未命名合集"}》` : copy.listTitle,
    meta: args.collapsed && args.selected >= 2 ? copy.selected(args.selected) : copy.meta(args.total),
  };
}

/**
 * 运行结束时要不要把面板收起来。
 *
 * Android 上下文操作栏的先例：动作执行完就关闭（`mode.finish() // Action picked, so close the CAB.`）——
 * 这一轮配置结束了，面板不该继续占着画面。反面意见（WinUI「自动收起会把控制权从用户手里拿走」、
 * NN/g「状态应由用户决定」）针对的是「因为别的面板展开而自动收起」；这里是「本次运行已结束」，
 * 与用户点开它的原因已经无关。只认 done / error 两种终态：skipped 是根本没跑，cancelled 是用户自己停的。
 */
export function collapsesAfterRun(status: NodeRunStatus | undefined): boolean {
  return status === "done" || status === "error";
}
