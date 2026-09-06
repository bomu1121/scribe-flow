import type { WorkflowGraph } from "./graph";

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  /** 所属工程文件夹 ID；null/缺省表示根层级。 */
  folderId?: string | null;
  graph: WorkflowGraph;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  description: string;
  /** 所属工程文件夹 ID；null/缺省表示根层级。 */
  folderId?: string | null;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 工程文件夹：用于给工程（项目）分类整理，支持嵌套。 */
export interface ProjectFolder {
  id: string;
  name: string;
  /** 父文件夹 ID；null 表示根层级。 */
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FolderDeleteResult {
  ok: boolean;
  /** 删除的文件夹数（含自身与子孙）。 */
  removedFolders: number;
  /** 因删除文件夹而移回根层级的工程数（工程不会被删除）。 */
  detachedProjects: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}
