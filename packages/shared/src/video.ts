import type { PageRef } from "./graph";

/** 视频所属 UGC 合集（“合集/系列”，由多个独立 BV 稿件构成）里的单集。 */
export interface UgcSeasonEpisode {
  bvid: string;
  cid: number;
  /** 合集内顺序号（从 1 开始，跨 section 连续）。 */
  index: number;
  /** 单集标题。 */
  part: string;
  duration: number;
  cover?: string;
}

/** 视频所属 UGC 合集信息（view 接口的 ugc_season 字段，公开无需登录）。 */
export interface UgcSeasonInfo {
  id: number;
  title: string;
  episodes: UgcSeasonEpisode[];
}

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
  /** 该视频若属于某个 UGC 合集（非多P，而是多个独立稿件），提供全集列表供批量选择。 */
  ugcSeason?: UgcSeasonInfo;
}
