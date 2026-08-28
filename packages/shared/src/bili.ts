import type { PageRef } from "./graph";

/** 登录后的 B 站账号摘要（Cookie 只存服务端，不返回任何凭证）。 */
export interface BiliAccount {
  mid: number;
  uname: string;
  face: string;
}

/** 快捷选择器里的一个来源集合（收藏夹 / 我的合集）。 */
export interface SourceCollection {
  id: string;
  title: string;
  cover?: string;
  count: number;
}

/** 快捷选择器里的一个可选视频。 */
export interface SourceVideoItem {
  bvid: string;
  aid?: number;
  cid?: number;
  title: string;
  cover: string;
  uploader: string;
  duration: number;
  pageCount: number;
  pages?: PageRef[];
}

/** 本地文件上传结果。 */
export interface UploadedFile {
  fileId: string;
  fileName: string;
  /** 服务端相对存储路径（如 uploads/xxxx.mp4），只存工程，不含绝对路径。 */
  storedPath: string;
  size: number;
}
