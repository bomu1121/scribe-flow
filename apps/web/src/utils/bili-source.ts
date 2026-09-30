import { nextNodeId, type BiliSourceData, type BiliSourceItem, type GraphNode, type SourceVideoItem, type WorkflowGraph } from "@scribe-flow/shared";

/**
 * 「勾选的 B 站视频」怎么写进来源节点。
 *
 * 三条入口共用这一份映射：画布节点面板的「B站收藏」动作、来源卡片上的「从我的 B 站选择」、
 * 新建工程时选「B站收藏」来源。写歪一处的后果是一个「卡片上看着有视频、运行时找不到 cid」的节点，
 * 而它不报错、只是跑出空产物，所以「1 个」与「多个」两种数量的形状判断只留在这里。
 */

/** 来源节点（`source.bili`）的数据形状：与 `BiliSourceData` 一致，多选卡片另有卡片标题 `label`。 */
export type BiliSourcePatch = BiliSourceData & { label?: string } & Record<string, unknown>;

/** 单个视频：写成普通来源卡片的字段。 */
function sourcePatchFor(video: SourceVideoItem): BiliSourcePatch {
  const patch: BiliSourcePatch = {
    url: `https://www.bilibili.com/video/${video.bvid}`,
    bvid: video.bvid,
    title: video.title,
    cover: video.cover,
    uploader: video.uploader,
    duration: video.duration,
  };
  const firstPage = video.pages?.find((p) => p.cid) ?? video.pages?.[0];
  if (firstPage?.cid) {
    patch.pageInfo = firstPage;
  } else if (video.cid) {
    patch.pageInfo = { cid: video.cid, page: 1, part: "", duration: video.duration };
  }
  return patch;
}

/** 单个视频压成多选列表里的一项。 */
function sourceItemFor(video: SourceVideoItem): BiliSourceItem {
  const page = video.pages?.find((p) => p.cid) ?? video.pages?.[0] ?? (video.cid ? { cid: video.cid, page: 1, part: "", duration: video.duration } : undefined);
  return {
    bvid: video.bvid,
    cid: page?.cid ?? 0,
    page: page?.page ?? 1,
    part: page?.part ?? "",
    title: video.title,
    cover: video.cover,
    uploader: video.uploader,
    duration: page?.duration ?? video.duration,
  };
}

export function sourceItemsFor(videos: SourceVideoItem[]): BiliSourceItem[] {
  return videos.map(sourceItemFor);
}

/**
 * 多选合并：一张“多选卡片”。
 * 首个视频同时写进卡片自身的单值字段，让只读 `url` / `bvid` / `pageInfo` 的老逻辑照常成立。
 */
export function multiSourcePatch(items: BiliSourceItem[], label = "B站多选"): BiliSourcePatch {
  const first = items[0];
  return {
    label,
    items,
    url: `https://www.bilibili.com/video/${first.bvid}`,
    bvid: first.bvid,
    title: first.title,
    cover: first.cover,
    uploader: first.uploader,
    duration: first.duration,
    pageInfo: { cid: first.cid, page: first.page, part: first.part, duration: first.duration ?? 0 },
  };
}

/** 勾选的视频 → 来源节点数据：1 个是普通卡片，多个合并成一张多选卡片。 */
export function biliSourceData(videos: SourceVideoItem[], multiLabel?: string): BiliSourcePatch {
  return videos.length === 1 ? sourcePatchFor(videos[0]) : multiSourcePatch(sourceItemsFor(videos), multiLabel);
}

/**
 * 把勾选的视频写进图里已有的 B 站来源节点；图里一个都没有（空白画布）就补一个。
 * 返回新图，不动传入的那个（调用方可能还拿它当撤销栈里的快照）。
 */
export function applyBiliVideos(graph: WorkflowGraph, videos: SourceVideoItem[], multiLabel?: string): WorkflowGraph {
  if (videos.length === 0) return graph;
  const data = biliSourceData(videos, multiLabel);
  const hasSource = graph.nodes.some((node) => node.type === "source.bili");
  if (!hasSource) {
    const node: GraphNode = { id: nextNodeId("n"), type: "source.bili", position: { x: 0, y: 0 }, data };
    return { ...graph, nodes: [...graph.nodes, node] };
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.type === "source.bili" ? { ...node, data: { ...node.data, ...data } } : node)),
  };
}
