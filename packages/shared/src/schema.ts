import { z } from "zod";
import { NODE_PORTS, type GraphEdge, type GraphNode, type NodeType, type WorkflowGraph } from "./graph";

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const pageRefSchema = z.object({
  cid: z.number(),
  page: z.number(),
  part: z.string(),
  duration: z.number(),
});

const baseDataSchema = z.object({
  label: z.string().optional(),
  status: z.enum(["idle", "queued", "running", "done", "error", "cancelled"]).optional(),
  summary: z.string().optional(),
});

const nodeDataByType = {
  bili: baseDataSchema.extend({
    url: z.string(),
    pageInfo: pageRefSchema.optional(),
  }),
  file: baseDataSchema.extend({
    fileId: z.string().optional(),
    fileName: z.string().optional(),
    filePath: z.string().optional(),
    size: z.number().optional(),
  }),
  text: baseDataSchema.extend({
    text: z.string(),
  }),
  transcribe: baseDataSchema.extend({
    asrEngine: z.enum(["mimo", "openai-compatible"]).optional(),
    asrUrl: z.string().optional(),
    asrKey: z.string().optional(),
  }),
  ai: baseDataSchema.extend({
    promptBlockId: z.string().optional(),
    promptOverride: z.string().optional(),
    model: z.string().optional(),
    outputName: z.string().optional(),
  }),
  merge: baseDataSchema.extend({
    title: z.string().optional(),
  }),
  output: baseDataSchema.extend({
    fileName: z.string().optional(),
  }),
};

function nodeOf(type: string, data: z.ZodTypeAny) {
  return z.object({
    id: z.string().min(1),
    type: z.literal(type),
    position: positionSchema,
    data,
  });
}

export const graphNodeSchema = z.discriminatedUnion("type", [
  nodeOf("source.bili", nodeDataByType.bili),
  nodeOf("source.file", nodeDataByType.file),
  nodeOf("source.text", nodeDataByType.text),
  nodeOf("process.transcribe", nodeDataByType.transcribe),
  nodeOf("process.refine", nodeDataByType.ai),
  nodeOf("process.prompt", nodeDataByType.ai),
  nodeOf("process.merge", nodeDataByType.merge),
  nodeOf("process.output", nodeDataByType.output),
]);

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export const graphSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (ids.has(n.id)) {
        ctx.addIssue({ code: "custom", message: `节点 id 重复：${n.id}`, path: ["nodes"] });
      }
      ids.add(n.id);
    }

    const edgeIds = new Set<string>();
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    for (const e of graph.edges) {
      if (edgeIds.has(e.id)) {
        ctx.addIssue({ code: "custom", message: `连线 id 重复：${e.id}`, path: ["edges"] });
      }
      edgeIds.add(e.id);

      const source = byId.get(e.source);
      const target = byId.get(e.target);
      if (!source || !target) {
        ctx.addIssue({ code: "custom", message: `连线 ${e.id} 引用了不存在的节点`, path: ["edges"] });
        continue;
      }

      const sourcePort = sourceHandleType(source, e.sourceHandle);
      const targetPort = targetHandleType(target, e.targetHandle);
      if (!sourcePort || !targetPort) {
        ctx.addIssue({ code: "custom", message: `连线 ${e.id} 端口不存在`, path: ["edges"] });
        continue;
      }
      if (source.id === target.id) {
        ctx.addIssue({ code: "custom", message: `连线 ${e.id} 不能连接自身`, path: ["edges"] });
      }
    }
  });

function sourceHandleType(node: { type: string }, handle?: string) {
  return NODE_PORTS[node.type as NodeType]?.outputs.find((p) => p.id === handle)?.type;
}

function targetHandleType(node: { type: string }, handle?: string) {
  return NODE_PORTS[node.type as NodeType]?.inputs.find((p) => p.id === handle)?.type;
}

/** 解析并校验 graph，失败抛 ZodError。 */
export function parseGraph(input: unknown): WorkflowGraph {
  return graphSchema.parse(input) as WorkflowGraph;
}

export function safeParseGraph(input: unknown) {
  return graphSchema.safeParse(input);
}

export type { GraphEdge, GraphNode, WorkflowGraph };
