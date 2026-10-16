import { blockArtifact, nodeArtifact, type PromptArtifact, type PromptBlock } from "@scribe-flow/shared";

/**
 * 出口卡（Obsidian 笔记）上的「本次将写入什么」预告。
 *
 * 起因（2026-10-16）：用户看着自己画布上两张并排的「AI 加工」卡——一张出普通笔记、一张出溯源报告——
 * 问「这种情况对一个用户来说他完全会发生」。结论是产物类别缺一份契约：做法自己声明（`PromptBlock.produces`），
 * 卡片上可见（标题旁的徽章），出口处可见（这份预告）。这里只算出口那一处。
 *
 * 预告**只是读画布**：不跑引擎、不落任何状态，改一条连线它就跟着变。
 */

/** 直连上游送给出口卡的一份产物。 */
export interface OutletPiece {
  /** 产出方的节点 id。 */
  nodeId: string;
  /** 这份输入的产物类别。穿过多输入节点（合并、输出）时可能不止一类。 */
  kinds: PromptArtifact[];
  /** 产出方的做法名（「速览版」「上网查证」）；上游不是 AI 加工、或没选提示词时为空。 */
  blockName?: string;
}

export interface OutletPlan {
  /** 将写入的篇数。 */
  count: number;
  /** 按件成篇：卡片上的「每个输入一篇」开着且有多份输入。关掉时所有输入合成一篇。 */
  perPiece: boolean;
  /** 每份输入一条，按连线的顺序。 */
  pieces: OutletPiece[];
  /** 写入后两份会互相链接（溯源报告 ←→ 同源笔记）。合成一篇时不做配对，所以恒为 false。 */
  interlink: boolean;
}

export interface OutletPlanInput {
  nodeId: string;
  nodes: { id: string; type?: string; data?: unknown }[];
  edges: { source: string; target: string }[];
  /** 提示词块集合（内置 + 用户自定义），与画布下拉里那一份相同。 */
  blocks: PromptBlock[];
  /** 卡片上的「每个输入一篇」开关；缺省＝开，与引擎口径一致。 */
  splitByInput?: boolean;
}

export function buildOutletPlan(input: OutletPlanInput): OutletPlan | undefined {
  const { nodeId, nodes, edges, blocks } = input;
  const incoming = edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
  // 还没连线时什么都不说：一张空预告比没有预告更容易被当成真的
  if (incoming.length === 0) return undefined;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors = (id: string): Set<string> => {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.target !== current || seen.has(edge.source)) continue;
        seen.add(edge.source);
        queue.push(edge.source);
      }
    }
    return seen;
  };

  /**
   * 一份输入的类别：直连的是 AI 加工就读它自己，否则往上游找。
   *
   * 往上游找是给「两份产物先合并、再进出口卡」这类连线兜底：合并节点自己声明不了产物，
   * 但用户仍要知道这一篇里混着哪几类东西。找得到几个做法就报几类；一个都找不到
   * （比如直接从来源卡接进出口卡）按普通笔记算——缺省就是笔记，与 `blockArtifact` 同一口径。
   */
  const pieceOf = (sourceId: string): OutletPiece => {
    const direct = byId.get(sourceId);
    if (direct && direct.type === "process.prompt") {
      const blockId = (direct.data as { promptBlockId?: unknown } | undefined)?.promptBlockId;
      const block = typeof blockId === "string" ? blocks.find((item) => item.id === blockId) : undefined;
      return { nodeId: sourceId, kinds: [nodeArtifact(blocks, direct)], blockName: block?.name };
    }
    const found: { artifact: PromptArtifact; name?: string }[] = [];
    for (const id of ancestors(sourceId)) {
      const node = byId.get(id);
      if (!node || node.type !== "process.prompt") continue;
      const blockId = (node.data as { promptBlockId?: unknown } | undefined)?.promptBlockId;
      const block = typeof blockId === "string" ? blocks.find((item) => item.id === blockId) : undefined;
      if (!block) continue;
      found.push({ artifact: blockArtifact(block), name: block.name });
    }
    const kinds = [...new Set(found.map((item) => item.artifact))];
    if (kinds.length === 0) return { nodeId: sourceId, kinds: ["note"] };
    // 只有「一路只有一个做法」时名字才确凿：合并节点上游挂着两个做法时，这一篇到底哪来的说不准
    const only = found.length === 1 ? found[0] : undefined;
    return { nodeId: sourceId, kinds, blockName: only?.name };
  };

  const pieces = incoming.map(pieceOf);
  const perPiece = input.splitByInput !== false && pieces.length > 1;
  const kinds = new Set(pieces.flatMap((piece) => piece.kinds));

  /*
   * 互链的成立条件比「两类都在」严一档：配对是**两份产物之间**的事（引擎按素材来源配对），
   * 所以合成一篇（perPiece 为假）时不成立；两份产物还得追到同一个上游素材，
   * 否则那是两个视频的笔记与报告接进了同一张卡，它们不会被配到一起。
   */
  let interlink = false;
  if (perPiece) {
    const ancestorSets = incoming.map(ancestors);
    for (let i = 0; i < pieces.length && !interlink; i += 1) {
      for (let j = 0; j < pieces.length; j += 1) {
        if (i === j) continue;
        if (!pieces[i]!.kinds.includes("trace-report") || !pieces[j]!.kinds.includes("note")) continue;
        if ([...ancestorSets[i]!].some((id) => ancestorSets[j]!.has(id))) {
          interlink = true;
          break;
        }
      }
    }
  }

  return {
    count: perPiece ? pieces.length : 1,
    perPiece,
    pieces,
    interlink: interlink && kinds.has("note") && kinds.has("trace-report"),
  };
}
