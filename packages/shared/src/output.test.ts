import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_NAME_TEMPLATE, FILE_NAME_TOKENS, renderFileNameTemplate, sanitizeFileName } from "./output";

/** 本地时间 2026-09-28 14:30:05（月份是 0 基，所以 8 = 九月）。 */
const at = new Date(2026, 8, 28, 14, 30, 5);

describe("renderFileNameTemplate", () => {
  it("默认模板就是工程名，与历史行为一致", () => {
    expect(DEFAULT_FILE_NAME_TEMPLATE).toBe("{project}");
    expect(renderFileNameTemplate("", { project: "某期视频", now: at })).toBe("某期视频");
    expect(renderFileNameTemplate("   ", { project: "某期视频", now: at })).toBe("某期视频");
    expect(renderFileNameTemplate(DEFAULT_FILE_NAME_TEMPLATE, { project: "某期视频", now: at })).toBe("某期视频");
  });

  it("四个占位符按声明顺序渲染", () => {
    expect(FILE_NAME_TOKENS.map((item) => item.token)).toEqual(["{project}", "{date}", "{time}", "{node}"]);
    expect(renderFileNameTemplate("{date}-{project}", { project: "某期视频", now: at })).toBe("2026-09-28-某期视频");
    expect(renderFileNameTemplate("{date}-{time}", { project: "任意", now: at })).toBe("2026-09-28-143005");
    expect(renderFileNameTemplate("{project}-{node}", { project: "某期视频", node: "观点提炼", now: at })).toBe("某期视频-观点提炼");
  });

  it("日期取本地时间，不做 UTC 换算", () => {
    // 东八区当天 23:30：用 toISOString 会得到「前一天」，这里把行为钉死。
    expect(renderFileNameTemplate("{date}", { project: "任意", now: new Date(2026, 8, 28, 23, 30, 0) })).toBe("2026-09-28");
    // 跨零点后是新的一天。
    expect(renderFileNameTemplate("{date}", { project: "任意", now: new Date(2026, 8, 29, 0, 0, 1) })).toBe("2026-09-29");
  });

  it("没有节点名时 {node} 渲染成空，不留花括号", () => {
    expect(renderFileNameTemplate("{project}{node}", { project: "某期视频", now: at })).toBe("某期视频");
  });

  it("非法字符被替换，用户自己写的 .md 不会变成 .md.md", () => {
    expect(renderFileNameTemplate("{project}", { project: 'a/b:c*d?e"f<g>h|i', now: at })).toBe("a_b_c_d_e_f_g_h_i");
    expect(renderFileNameTemplate("笔记.md", { project: "任意", now: at })).toBe("笔记");
  });

  it("整串渲染成空时回落到工程名，再兜底「笔记」", () => {
    expect(renderFileNameTemplate("{node}", { project: "某期视频", now: at })).toBe("某期视频");
    expect(renderFileNameTemplate("{node}", { project: "", now: at })).toBe("笔记");
  });

  it("认不出来的占位符原样保留，用户能一眼看出自己写错了", () => {
    expect(renderFileNameTemplate("{titel}-{project}", { project: "某期视频", now: at })).toBe("{titel}-某期视频");
  });
});

describe("sanitizeFileName", () => {
  it("只替换文件系统不接受的字符，收敛到 80 字符", () => {
    expect(sanitizeFileName("  正常名字  ")).toBe("正常名字");
    expect(sanitizeFileName("x".repeat(200))).toHaveLength(80);
  });
});
