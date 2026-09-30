import { describe, expect, it } from "vitest";
import { chainRowMeta, chainStageTitle, chainTypeSuffix } from "@/utils/run-chain";

/**
 * 用例里的 label / typeLabel / summary 直接取自真实运行
 * `run_a0bc492d-8b7d-4105-a8f2-1d0a5f795004`（工程「演示③ 八段素材的长跑」，8 段 B 站素材）：
 * 面板上这几行字要是拼错了，先在这里红，而不是等肉眼看出来。
 */
const REAL_RUN_ROWS = [
  {
    label: "B站链接",
    typeLabel: "B站",
    meta: chainRowMeta({ nodeType: "source.bili", summary: "8 个音轨已就绪", items: new Array(8), uploader: "一只枷锁" }),
    suffix: chainTypeSuffix("B站链接", "B站"),
  },
  {
    label: "转写",
    typeLabel: "转写",
    meta: chainRowMeta({ nodeType: "process.transcribe", summary: "8 个音频 · 111917 字" }),
    suffix: chainTypeSuffix("转写", "转写"),
  },
  {
    label: "AI 校对",
    typeLabel: "校对",
    meta: chainRowMeta({ nodeType: "process.refine", summary: "8 个输入 · 44437 字" }),
    suffix: chainTypeSuffix("AI 校对", "校对"),
  },
  {
    label: "AI 加工",
    typeLabel: "AI",
    meta: chainRowMeta({ nodeType: "process.prompt", summary: "8 个输入 · 57629 字" }),
    suffix: chainTypeSuffix("AI 加工", "AI"),
  },
  {
    label: "输出",
    typeLabel: "输出",
    meta: chainRowMeta({ nodeType: "process.output", summary: "笔记.md · 57643 字" }),
    suffix: chainTypeSuffix("输出", "输出"),
  },
];

describe("链路面板的行文案", () => {
  it("真实运行的 5 行：摘要原样带出，类型不重复节点名", () => {
    expect(REAL_RUN_ROWS.map((row) => row.meta)).toEqual([
      "8 个视频 · 一只枷锁 · 8 个音轨已就绪",
      "8 个音频 · 111917 字",
      "8 个输入 · 44437 字",
      "8 个输入 · 57629 字",
      "笔记.md · 57643 字",
    ]);
    expect(REAL_RUN_ROWS.map((row) => row.suffix)).toEqual(["", "", "", "", ""]);
  });

  it("一张链路上多张同类来源卡时，靠身份而不是状态区分", () => {
    // run_4cbb9b45…（4 张单视频卡）的真实字段：四张卡的摘要都是「音轨已就绪」。
    const cards = [
      { title: "赚欧元花欧元的话术骗局，一次讲透！", uploader: "尖峰苏打cfz", duration: 1079 },
      { title: "GitHub 全球趋势榜第一！把代码交给 AI，自动生成架构图", uploader: "也无风雨也雾晴", duration: 183 },
      { title: "英国“光头哥”火到外网！发了条中印旅游对比，戳痛14亿印度人？", uploader: "向日葵热评", duration: 629 },
      { title: "一人之下774：魏亮就是张予德本人，当时他本想杀马仙洪的，但被曲彤拒绝后夸了一句", uploader: "漫话时间", duration: 330 },
    ];
    const metas = cards.map((card) =>
      chainRowMeta({ nodeType: "source.bili", summary: "音轨已就绪", items: [], ...card }),
    );
    expect(metas[0]).toBe("《赚欧元花欧元的话术骗局，一次讲透！》 · 尖峰苏打cfz · 17:59 · 音轨已就绪");
    expect(new Set(metas).size).toBe(4);
  });

  it("摘要本身已经把身份说全时，不再重复一遍", () => {
    // 三个视频的卡：服务端摘要就是「3 个视频 · 内部看美国 · 15:17」，身份拼出来一模一样。
    const input = {
      nodeType: "source.bili",
      summary: "3 个视频 · 内部看美国 · 15:17",
      items: new Array(3),
      uploader: "内部看美国",
      duration: 917,
    };
    expect(chainRowMeta(input)).toBe("3 个视频 · 内部看美国 · 15:17");
  });

  it("类型只在补充了节点名没说的东西时才出现", () => {
    expect(chainTypeSuffix("我的处理", "工具")).toBe("工具");
    expect(chainTypeSuffix("汇总", "合并")).toBe("合并");
    expect(chainTypeSuffix("汇总", "汇总")).toBe("");
    expect(chainTypeSuffix("AI 加工", "")).toBe("");
    // 类型是节点名的子串（「B站链接」里已有「B站」）同样算重复。
    expect(chainTypeSuffix("B站链接", "B站")).toBe("");
  });

  it("没有摘要时按素材事实拼，且不写「—」占位", () => {
    expect(chainRowMeta({ nodeType: "source.bili", items: new Array(8), uploader: "一只枷锁", duration: 3203 })).toBe(
      "8 个视频 · 一只枷锁",
    );
    // 单个视频：标题优先于「1 个视频」这种无人称代词。
    expect(chainRowMeta({ nodeType: "source.bili", title: "负基础篇—网络安全入门基本认知", duration: 3203 })).toBe(
      "《负基础篇—网络安全入门基本认知》 · 53:23",
    );
    expect(chainRowMeta({ nodeType: "source.file", fileName: "录音.m4a", size: 1024 })).toBe("录音.m4a · 1.0 KB");
    // 没有大小就不写「0 B」：0 B 是「确实为空」，不是「不知道」。
    expect(chainRowMeta({ nodeType: "source.file", fileName: "录音.m4a" })).toBe("录音.m4a");
    expect(chainRowMeta({ nodeType: "source.text", text: "  一段文稿  " })).toBe("4 字");
    expect(chainRowMeta({ nodeType: "process.transcribe", text: "  一段文稿  " })).toBe("4 字");
    // 加工节点没有任何信息时留空（调用方省略该行），而不是显示破折号。
    expect(chainRowMeta({ nodeType: "process.transcribe", summary: "" })).toBe("");
    // 文本来源的空稿是「确实为空」，这一条要说出来。
    expect(chainRowMeta({ nodeType: "source.text", text: "" })).toBe("空文稿");
  });

  it("报错时把错误接在副标题后面", () => {
    expect(chainRowMeta({ nodeType: "process.refine", summary: "3 个输入", status: "error", error: "没有可用的输入" })).toBe(
      "3 个输入 · 没有可用的输入",
    );
  });

  it("阶段标题：首尾有名字，中间按序号；只有一层时叫「加工结果」", () => {
    expect(chainStageTitle(0, 3)).toBe("原始素材");
    expect(chainStageTitle(1, 3)).toBe("加工步骤 1");
    expect(chainStageTitle(2, 3)).toBe("加工步骤 2");
    expect(chainStageTitle(3, 3)).toBe("最终输入");
    expect(chainStageTitle(1, 1)).toBe("加工结果");
    expect(chainStageTitle(2, 2)).toBe("最终输入");
    expect(chainStageTitle(1, 2)).toBe("加工步骤 1");
  });
});
