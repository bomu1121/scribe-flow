import { describe, expect, it } from "vitest";
import type { NodeRunStatus } from "@scribe-flow/shared";
import { PICKER_COPY, collapsesAfterRun, pickerKey, pickerSummary, readPickerOpen, writePickerOpen } from "./bili-picker";

/**
 * 这几条守的是三件不会报错、只会悄悄变难用的事：
 * ① 收起态那一行有没有把「攒了待合并的选集」说出来（且默认那一项不算信号）；
 * ② 悬停提示有没有把「点行会切换」再说一遍（界面上一行说明都不该有）；
 * ③ 展开态在节点重挂载后还在不在（画布有视口裁剪，节点会被卸载重挂）。
 */

describe("pickerSummary", () => {
  it("合集：标题带书名号，没名字时给兜底，不写 undefined", () => {
    expect(pickerSummary("season", { title: "美国时政", total: 109, selected: 1, collapsed: true }).title).toBe("合集《美国时政》");
    expect(pickerSummary("season", { title: "", total: 109, selected: 1, collapsed: true }).title).toBe("合集《未命名合集》");
    expect(pickerSummary("season", { title: undefined, total: 12, selected: 1, collapsed: true }).title).toBe("合集《未命名合集》");
  });

  it("收起且攒到 2 项以上时，那一格显「已选 N」而不是总集数", () => {
    expect(pickerSummary("season", { title: "美国时政", total: 109, selected: 3, collapsed: true }).meta).toBe("已选 3 集");
    // 默认只勾着当前这一集（1 项）——写出来不传递任何信息，仍然显示总集数
    expect(pickerSummary("season", { title: "美国时政", total: 109, selected: 1, collapsed: true }).meta).toBe("109 集");
  });

  it("展开态显示总集数（已选数交给底部的动作条，同一个数不出现两次）", () => {
    expect(pickerSummary("season", { title: "美国时政", total: 109, selected: 3, collapsed: false }).meta).toBe("109 集");
  });

  it("没勾选时任何状态都显示总集数", () => {
    expect(pickerSummary("season", { title: "美国时政", total: 109, selected: 0, collapsed: true }).meta).toBe("109 集");
  });

  it("分P 用「项」而不是「集」，总数写作「共 N P」", () => {
    const sum = pickerSummary("pages", { total: 12, selected: 0, collapsed: false });
    expect(sum.title).toBe("选择分P");
    expect(sum.meta).toBe("共 12 P");
    expect(pickerSummary("pages", { total: 12, selected: 2, collapsed: true }).meta).toBe("已选 2 项");
    expect(pickerSummary("pages", { total: 12, selected: 1, collapsed: true }).meta).toBe("共 12 P");
  });
});

describe("PICKER_COPY.rowHint", () => {
  it("只说「会发生什么」，不复述「点这一行」这个动作本身", () => {
    for (const kind of ["pages", "season"] as const) {
      expect(PICKER_COPY[kind].rowHint).not.toContain("点击");
      expect(PICKER_COPY[kind].rowHint).not.toContain("点一行");
      expect(PICKER_COPY[kind].rowHint.length).toBeGreaterThan(8);
    }
  });

  it("两个列表的量词不一样（集 / 分P）", () => {
    expect(PICKER_COPY.season.selected(2)).toBe("已选 2 集");
    expect(PICKER_COPY.pages.selected(2)).toBe("已选 2 项");
    expect(PICKER_COPY.season.merged(2)).toContain("集");
    expect(PICKER_COPY.pages.merged(2)).toContain("分P");
  });
});

describe("展开态存储", () => {
  it("默认收起；写进去能读回来", () => {
    const key = pickerKey("n_src", "BV1DTWw6UE1y", "season");
    expect(readPickerOpen(key)).toBe(false);
    writePickerOpen(key, true);
    expect(readPickerOpen(key)).toBe(true);
    writePickerOpen(key, false);
    expect(readPickerOpen(key)).toBe(false);
  });

  it("键带上 bvid 与 kind：换视频、换列表都不串状态", () => {
    writePickerOpen(pickerKey("n_src", "BV1", "season"), true);
    expect(readPickerOpen(pickerKey("n_src", "BV2", "season"))).toBe(false);
    expect(readPickerOpen(pickerKey("n_src", "BV1", "pages"))).toBe(false);
    // bvid 还没解析出来时也不能串到别的节点上
    expect(readPickerOpen(pickerKey("n_other", "BV1", "season"))).toBe(false);
    expect(readPickerOpen(pickerKey("n_src", undefined, "season"))).toBe(false);
  });
});

describe("collapsesAfterRun", () => {
  it("只有真跑完的两种终态才收起", () => {
    const collapse: NodeRunStatus[] = ["done", "error"];
    const keep: (NodeRunStatus | undefined)[] = ["idle", "queued", "running", "cancelled", "skipped", undefined];
    for (const status of collapse) expect(collapsesAfterRun(status)).toBe(true);
    for (const status of keep) expect(collapsesAfterRun(status)).toBe(false);
  });
});
