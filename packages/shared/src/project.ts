import type { WorkflowGraph } from "./graph";

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}
