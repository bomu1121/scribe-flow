/** 运行附着的可播放媒体（视频下载/归一化产物），见 docs/video-module-research.md §4–5。 */

export type RunMediaKind = "bili" | "file";
export type RunMediaStatus = "ready" | "error" | "restoring";

/** 结果页看到的单个可播放视频（run_media JOIN media_assets 的输出视图）。 */
export interface RunMediaView {
  /** run_media.id。 */
  id: string;
  runId: string;
  nodeId: string;
  /** 多选/分P 序号；0 = 单视频。 */
  sourceIndex: number;
  label: string;
  kind: RunMediaKind;
  status: RunMediaStatus;
  error?: string;
  asset?: {
    id: string;
    title?: string;
    /** 封面 URL / 上传者等展示信息（B站源）。 */
    meta?: { cover?: string; uploader?: string; bvid?: string; cid?: number; qn?: number; url?: string };
    durationSec?: number;
    size?: number;
    /** 文件当前是否在盘（播放前预检）。 */
    present: boolean;
    /** B站原链接；本地文件为空。 */
    sourceUrl?: string;
  };
}

/** 媒体缺失重下的任务状态（轮询接口返回）。 */
export interface MediaRestoreJobView {
  id: string;
  assetId: string;
  status: "running" | "done" | "error";
  progress: number;
  message?: string;
  error?: string;
  updatedAt: number;
}
