import type { PageRef } from "./graph";

/** B 站视频解析结果（输入链接后即时校验用）。 */
export interface VideoPreview {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  description: string;
  duration: number;
  cover: string;
  uploader: string;
  uploaderUid: number;
  pubdate: number;
  pages: PageRef[];
}
