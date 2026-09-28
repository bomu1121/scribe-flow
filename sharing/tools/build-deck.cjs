/**
 * 生成分享会 PPT。
 *
 * 结构照 sharing/ROOM.md 的三段走（现场手册是执行稿，这份是它的投影版）：
 *   ① 节点编排画布（用了画布库也不省产品级画布的工作量）   ② 推送会撒谎，数据库不会   ③ 把 AI 的输出当成会坏的东西
 * 每条结论都对着仓库里的实际代码核过，出处写在各页页脚。
 *
 * 配色取自项目自己的设计令牌 apps/web/src/styles/tokens.css：
 * 墨色作主色、B 站蓝只作强调，呼应它「B 站蓝只用于交互信号」的规矩。
 */
const pptxgen = require("pptxgenjs");

const INK = "16181D"; // tokens.css --color-ink
const PAPER = "FFFFFF";
const BG = "F4F5F6"; // --color-bg
const MUTED = "8A929E"; // --color-text-tertiary
const ACCENT = "00AEEC"; // --color-brand
const ERR = "D23F4E"; // --color-error
const BORDER = "E4E7EB"; // --color-border
const SUB = "545B66"; // --color-text-secondary

const FONT = "微软雅黑";
const MONO = "Consolas";

const W = 13.33;
const H = 7.5;
const M = 0.5;
const CW = W - 2 * M;

// CJK 行高：pt × 1.2 倍行距 × 1.15 字距余量
const lineH = (pt, lines) => (pt * 1.2 * 1.15 * lines) / 72 + 0.12;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "念前";
pres.title = "前端技术分享：三件在这个产品里最难做的前端事";

// 深色页与浅色页的次要文字色不同：同一支墨灰放到深底上只剩 2.6:1。
// 由 light()/dark() 记录当前页底，眼睛、页脚、卡片正文一律走 DIM()，避免手写漏改。
let onDark = false;
const light = (s) => {
  s.background = { color: PAPER };
  onDark = false;
};
const dark = (s) => {
  s.background = { color: INK };
  onDark = true;
};
const DIM = () => (onDark ? MUTED : SUB);

/** 页眉小字：放在标题上方，标出这页属于哪一段。 */
const eyebrow = (s, text) => {
  s.addText(text, {
    x: M, y: 0.42, w: CW, h: 0.34,
    fontFace: FONT, fontSize: 12, color: DIM(), charSpacing: 3, margin: 0, valign: "middle",
  });
};

/** 页标题。颜色显式传：浅色页 INK、深色页 PAPER。 */
const title = (s, text, color) => {
  s.addText(text, {
    x: M, y: 0.88, w: CW, h: 0.92,
    fontFace: FONT, fontSize: 30, bold: true, color, margin: 0, valign: "middle",
  });
};

/** 段落过场页（深底）：上一行是白字判断，下一行是蓝字判断。 */
const section = (s, eyebrowText, line1, line2) => {
  dark(s);
  eyebrow(s, eyebrowText);
  s.addText(line1, {
    x: M, y: 2.55, w: CW, h: 0.95,
    fontFace: FONT, fontSize: 38, bold: true, color: PAPER, margin: 0, valign: "middle",
  });
  s.addText(line2, {
    x: M, y: 3.5, w: CW, h: 0.95,
    fontFace: FONT, fontSize: 38, bold: true, color: ACCENT, margin: 0, valign: "middle",
  });
};

/** 页脚出处：被追问时可以当场翻代码。 */
const source = (s, text) => {
  s.addText(text, {
    x: M, y: H - 0.58, w: CW, h: 0.3,
    fontFace: FONT, fontSize: 9.5, color: DIM(), margin: 0, valign: "middle",
  });
};

/** 按字数估一段文字会折几行：中日韩 1 em、西文 0.52 em、空格 0.28 em。只用于算垂直居中。 */
const estLines = (text, widthIn, pt) => {
  let em = 0;
  for (const ch of text) em += ch.codePointAt(0) >= 0x2e80 ? 1 : ch === " " ? 0.28 : 0.52;
  return Math.max(1, Math.ceil(em / (widthIn / (pt / 72))));
};

/**
 * 「标签 + 说明」的成行列表，本场最常用的一种版式。
 * 深色页默认白标签 + 灰说明，浅色页默认墨标签 + 次级灰说明；两处都可用 headColor/bodyColor 覆盖。
 *
 * center=true 时把整块在「标题以下、页脚以上」的区间里垂直居中。居中用**视觉高度**
 * （实际折行数 + 行间空隙）算，不能用「行数 × 步长」——后者把每行的高度也算成步长，
 * 会把块推得偏上、底部留出大片空白。
 */
const rowList = (s, rows, opts = {}) => {
  const { top: topMin = 1.85, step = 1.18, pt = 15, labelW = 2.4, headColor, bodyColor, center = false } = opts;
  const hc = headColor ?? (onDark ? PAPER : INK);
  const bc = bodyColor ?? DIM();
  const boxW = CW - 0.3 - labelW;
  const heights = rows.map(([, value]) => (estLines(value, boxW, pt) * pt * 1.2 * 1.15) / 72);
  const gap = Math.max(0.25, step - Math.max(...heights));
  const contentH = heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
  const avail = H - 0.85 - topMin;
  const top = center ? topMin + Math.max(0, (avail - contentH) / 2) : topMin;
  rows.forEach(([key, value], i) => {
    const y = top + i * step;
    s.addText(key, {
      x: M + 0.1, y, w: labelW, h: 0.5,
      fontFace: FONT, fontSize: pt, bold: true, color: hc, margin: 0, valign: "top",
    });
    s.addText(value, {
      x: M + 0.1 + labelW, y, w: boxW, h: heights[i] + 0.1,
      fontFace: FONT, fontSize: pt, color: bc, margin: 0, valign: "top",
    });
  });
};

/** 两张并排卡片（收益/代价、直觉/实际这类对照）。 */
const panels = (s, items, { top = 2.6, h = 1.62, gap = 0.4, headPt = 16, bodyPt = 15 } = {}) => {
  const pw = CW / 2 - gap / 2;
  items.forEach((c, i) => {
    const x = M + i * (pw + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: top, w: pw, h,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(c.head, {
      x: x + 0.32, y: top + 0.2, w: pw - 0.64, h: 0.42,
      fontFace: FONT, fontSize: headPt, bold: true, color: c.tone ?? INK, margin: 0, valign: "middle",
    });
    s.addText(c.body, {
      x: x + 0.32, y: top + 0.68, w: pw - 0.64, h: h - 0.76,
      fontFace: FONT, fontSize: bodyPt, color: SUB, margin: 0, valign: "top",
    });
  });
};

/** 一句话结论：底纹带，放在内容下方，兼作用来收住版面的重心。 */
const takeaway = (s, text, { y, pt = 16, h = 0.85 } = {}) => {
  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y, w: CW, h,
    fill: { color: BG }, line: { color: BORDER, width: 1 },
  });
  s.addText(text, {
    x: M + 0.35, y: y + 0.1, w: CW - 0.7, h: h - 0.2,
    fontFace: FONT, fontSize: pt, bold: true, color: INK, margin: 0, valign: "middle",
  });
};

/* ------------------------------------------------------------------ 01 封面 */
{
  const s = pres.addSlide();
  dark(s);
  s.addText("前端技术分享", {
    x: M, y: 2.05, w: CW, h: 1.0,
    fontFace: FONT, fontSize: 50, bold: true, color: PAPER, margin: 0, valign: "middle",
  });
  s.addText("三件在这个产品里最难做的前端事", {
    x: M, y: 3.15, w: CW, h: 0.6,
    fontFace: FONT, fontSize: 22, color: MUTED, margin: 0, valign: "middle",
  });
  s.addText("例：ScribeFlow —— 把视频和文稿编排成笔记的节点式工作台", {
    x: M, y: 4.25, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
  s.addText("念前 · 2026-09", {
    x: M, y: H - 1.15, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 13, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ---------------------------------------------------------- 02 为什么做这个 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "开场 30 秒");
  title(s, "先说清这东西为什么存在", INK);

  const lines = [
    "我攒了几百个技术视频，看不完，但丢不掉。",
    "市面上的工具是「贴个链接、选个模板、出一份摘要」——模板是它给的，你改不了。",
    "我想要的是把中间每一步都摊开：转写用什么、校对要不要、提炼用哪套提示词、最后要不要出题，我自己连。",
    "所以它是一张画布，不是一个网页应用。",
  ];
  lines.forEach((text, i) => {
    s.addText(text, {
      x: M, y: 2.45 + i * 0.9, w: CW, h: 0.85,
      fontFace: FONT, fontSize: 17, color: INK, margin: 0, valign: "top",
    });
  });

  s.addText("下面讲的三件事，都是这张画布上用户看得见的界面", {
    x: M, y: 6.05, w: CW, h: 0.5,
    fontFace: FONT, fontSize: 19, bold: true, color: ACCENT, margin: 0, valign: "middle",
  });

  source(s, "市场调研见 docs/research/r1-desktop-research.md：20 个产品、14 维功能矩阵、4 个 P0 全部已落地");
}

/* -------------------------------------------------------------- 03 三件事 */
{
  const s = pres.addSlide();
  dark(s);
  eyebrow(s, "今天讲三件事");
  title(s, "都是产品的主体界面，不是工程配置", PAPER);

  const rows = [
    ["01", "节点编排画布", "16 种节点、5913 行代码，画布是这个产品的核心界面"],
    ["02", "推送会撒谎，数据库不会", "一次运行可能跑十几分钟，中途断线、切页面、重启都是常态"],
    ["03", "把 AI 的输出当成会坏的东西", "引擎给一份拼接产物，用户要按视频逐段读"],
  ];
  rows.forEach(([num, head, sub], i) => {
    const y = 2.45 + i * 1.35;
    s.addText(num, {
      x: M, y, w: 0.95, h: 0.85,
      fontFace: MONO, fontSize: 34, bold: true, color: ACCENT, margin: 0, valign: "middle",
    });
    s.addText(head, {
      x: M + 1.05, y: y - 0.05, w: CW - 1.05, h: 0.5,
      fontFace: FONT, fontSize: 22, bold: true, color: PAPER, margin: 0, valign: "middle",
    });
    s.addText(sub, {
      x: M + 1.05, y: y + 0.42, w: CW - 1.05, h: 0.45,
      fontFace: FONT, fontSize: 16, color: MUTED, margin: 0, valign: "middle",
    });
  });
}

/* ------------------------------------------------------------ 04 主题一过场 */
{
  const s = pres.addSlide();
  section(s, "01 / 节点编排画布", "用了画布库", "也不省产品级画布的工作量");
  s.addText("5913 行画布代码里，真正调库 API 的不到 200 行", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ------------------------------------------------------ 05 一个 nodeType */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 节点编排画布");
  title(s, "16 种节点，只注册 1 个 nodeType", INK);

  s.addText("业务类型不放进画布的 type 字段，而是放进 data.nodeType；画布只认一个组件，卡片按类型分派。", {
    x: M, y: 1.75, w: CW, h: lineH(16, 1),
    fontFace: FONT, fontSize: 16, color: INK, margin: 0, valign: "middle",
  });

  const two = [
    {
      x: M, head: "收益", tone: INK,
      body: "端口、右键菜单、运行按钮、状态条、悬停预览、只读控制只写一遍，16 种节点共用同一个外壳。",
    },
    {
      x: M + CW / 2 + 0.2, head: "代价", tone: ERR,
      body: "外壳文件长到 3028 行，卡片分派是一条 16 段的 v-if 链；只有 6 张卡片拆成了独立组件。",
    },
  ];
  two.forEach((c) => {
    const cw = CW / 2 - 0.2;
    s.addShape(pres.shapes.RECTANGLE, {
      x: c.x, y: 2.6, w: cw, h: 1.62,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(c.head, {
      x: c.x + 0.32, y: 2.8, w: cw - 0.64, h: 0.42,
      fontFace: FONT, fontSize: 16, bold: true, color: c.tone, margin: 0, valign: "middle",
    });
    s.addText(c.body, {
      x: c.x + 0.32, y: 3.32, w: cw - 0.64, h: lineH(15, 2),
      fontFace: FONT, fontSize: 15, color: SUB, margin: 0, valign: "top",
    });
  });

  s.addText("要决策的是边界：哪些该共享外壳，哪些该拆成卡片", {
    x: M, y: 4.85, w: CW, h: 0.5,
    fontFace: FONT, fontSize: 18, bold: true, color: INK, margin: 0, valign: "middle",
  });

  source(s, "FlowCanvas.vue 只注册 1 个 nodeType（:93）；卡片分派见 ScribeNode.vue（3028 行，:1014 起 16 段分支）");
}

/* -------------------------------------------------------- 06 撤销重做 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 节点编排画布");
  title(s, "快照式撤销，和它带来的两个副作用", INK);

  s.addText("不记命令，直接存整图快照；上限 50 步，出图时把运行态字段剥掉，刷新后不会卡在运行中。", {
    x: M, y: 1.75, w: CW, h: lineH(16, 1),
    fontFace: FONT, fontSize: 16, color: INK, margin: 0, valign: "middle",
  });
  s.addText("提交走双通道：输入框逐字改图但不记历史，失焦时才提交一次历史。", {
    x: M, y: 2.3, w: CW, h: lineH(18, 1),
    fontFace: FONT, fontSize: 18, bold: true, color: INK, margin: 0, valign: "middle",
  });

  const two = [
    {
      x: M, head: "副作用一", tone: ERR,
      body: "提交时不做去重，点进输入框再点空白会压入一模一样的快照，用户按撤销会觉得没反应。",
    },
    {
      x: M + CW / 2 + 0.2, head: "副作用二", tone: ERR,
      body: "视角本身也在快照里，所以撤销会顺带把镜头弹回当时的画面，这点容易被忽略。",
    },
  ];
  two.forEach((c) => {
    const cw = CW / 2 - 0.2;
    s.addShape(pres.shapes.RECTANGLE, {
      x: c.x, y: 3.05, w: cw, h: 1.62,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(c.head, {
      x: c.x + 0.32, y: 3.25, w: cw - 0.64, h: 0.42,
      fontFace: FONT, fontSize: 16, bold: true, color: c.tone, margin: 0, valign: "middle",
    });
    s.addText(c.body, {
      x: c.x + 0.32, y: 3.77, w: cw - 0.64, h: lineH(15, 2),
      fontFace: FONT, fontSize: 15, color: SUB, margin: 0, valign: "top",
    });
  });

  source(s, "快照与 50 步上限见 FlowCanvas.vue:82-111；失焦提交约定见 utils/flow.ts:39-40");
}

/* ------------------------------------------------------------ 07 浮层缩放 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 节点编排画布");
  title(s, "画布缩放之后，浮层怎么还对得上", INK);

  rowList(
    s,
    [
      ["问题", "浮层被传送到 body，脱离了画布的缩放坐标系——画布缩到 60% 时，浮层还是原尺寸"],
      ["解法", "从画布取当前缩放，沿组件树传给所有浮层，浮层用 CSS zoom 补偿"],
      ["两个细节", "位置不用补（浮层库按屏幕矩形定位，缩放后矩形已经是对的），只有尺寸要补"],
      ["为什么用 zoom", "CSS zoom 参与布局计算，而 transform: scale 会干扰浮层库自己的测量与定位原点"],
    ],
    { top: 1.85, step: 1.18, pt: 14, center: true },
  );

  source(s, "补偿见 ScribeNode.vue:50-52 的 provide 与三个浮层容器；更麻烦的一处见 ModelSelect.vue（屏幕宽度要除以缩放才是节点局部宽度）");
}

/* ---------------------------------------------------------- 08 主题二过场 */
{
  const s = pres.addSlide();
  section(s, "02 / 推送会撒谎，数据库不会", "一次运行跑十几分钟", "前端得一直说真话");
  s.addText("转写和 AI 加工都可能很久，而且中途断线、切页面、服务重启都是常态", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ---------------------------------------------------------------- 09 轮询 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 推送会撒谎，数据库不会");
  title(s, "有了推送，反而更需要轮询", INK);

  rowList(
    s,
    [
      ["直觉", "已经有实时推送了，轮询是多余的老办法"],
      ["实际", "推送是唯一会静默失效的通道：断线、丢帧、服务重启，它都不报错，只是不说话了"],
      ["所以", "数据库是真相通道，推送只是加速通道；轮询不是推送的备份，是它的正确性校正器"],
      ["四层兜底", "断线 2 秒重连、全局 5 秒轮询对账、运行结束补一次终局快照、进页面时恢复上次运行"],
    ],
    { top: 1.85, step: 1.18, pt: 14, center: true },
  );

  source(s, "重连见 sse.ts:37；轮询见 layouts/AppLayout.vue:37；对账与恢复见 ProjectEditorView.vue 的 resumeRun / reconcileActiveRun / restoreLastRun");
}

/* ------------------------------------------------------------ 10 放弃增量 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 推送会撒谎，数据库不会");
  title(s, "放弃增量更新，换来重连正确", INK);

  panels(
    s,
    [
      {
        head: "增量更新 · 直觉做法",
        tone: INK,
        body: "只传变化的那一点，看起来最省。\n但它要求「先收到全部前置事件」才算得对，于是重连就必须做事件重放——而这套系统的广播没有重放缓冲。",
      },
      {
        head: "全量覆盖 · 实际做法",
        tone: INK,
        body: "每个事件构造补丁，整体覆盖字段。\n只给命中的节点建新对象，其余返回同一引用；重复、乱序的事件天然幂等，重连的正确性问题直接消失。",
      },
    ],
    { top: 2.4, h: 2.0, bodyPt: 14 },
  );

  takeaway(s, "直觉是增量更省，但增量把正确性押在「事件不会丢」上，而事件一定会丢", { y: 5.15, pt: 16 });

  source(s, "事件到状态的映射见 FlowCanvas.vue:768 的 applyRunEvent；补丁只命中受影响节点见同文件 :751-766");
}

/* ---------------------------------------------------------- 11 建连补快照 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 推送会撒谎，数据库不会");
  title(s, "连接这个动作，必须自带状态同步", INK);

  s.addText("后端的运行事件广播是一个内存集合，没有重放缓冲：运行结束 60 秒后整条记录就没了。", {
    x: M, y: 1.8, w: CW, h: lineH(16, 2),
    fontFace: FONT, fontSize: 16, color: INK, margin: 0, valign: "top",
  });

  s.addText("所以建连时服务端先补一份全量快照，再进增量流。", {
    x: M, y: 2.75, w: CW, h: lineH(18, 1),
    fontFace: FONT, fontSize: 18, bold: true, color: INK, margin: 0, valign: "middle",
  });

  const rows = [
    ["已完成", "补成完成事件，并带上摘要与预览"],
    ["失败", "补成失败事件，带上错误信息"],
    ["进行中", "补一次「已开始」，否则重连后节点不再有动效"],
    ["已结束", "补一条结束事件，然后直接断开"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 3.55 + i * 0.62;
    s.addText(k, {
      x: M + 0.3, y, w: 1.4, h: 0.5,
      fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0, valign: "middle",
    });
    s.addText(v, {
      x: M + 1.8, y, w: CW - 1.8, h: 0.5,
      fontFace: FONT, fontSize: 14, color: SUB, margin: 0, valign: "middle",
    });
  });

  source(s, "建连补快照见 apps/server/src/routes/runs.ts:202；广播无重放见 engine.ts:2116（60 秒后删除运行态）");
}

/* ------------------------------------------------------------ 12 局部重跑 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 推送会撒谎，数据库不会");
  title(s, "局部重跑是一次新运行", INK);

  s.addText("点「从此节点运行」不会复用旧运行，而是新开一次。这是结果合并存在的根本原因。", {
    x: M, y: 1.85, w: CW, h: lineH(16, 1),
    fontFace: FONT, fontSize: 16, color: INK, margin: 0, valign: "middle",
  });

  const steps = [
    ["新运行", "每次运行都新开一个 id"],
    ["结果不全", "只包含本次范围内的节点"],
    ["视图回填", "从更早的成功运行补回缺失节点"],
  ];
  const gap = 0.65;
  const bw = (CW - gap * 2) / 3;
  steps.forEach(([head, body], i) => {
    const x = M + i * (bw + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 2.6, w: bw, h: 1.35,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(head, {
      x: x + 0.3, y: 2.8, w: bw - 0.6, h: 0.45,
      fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
    });
    s.addText(body, {
      x: x + 0.3, y: 3.35, w: bw - 0.6, h: lineH(14, 1),
      fontFace: FONT, fontSize: 14, color: SUB, margin: 0, valign: "top",
    });
    if (i < steps.length - 1) {
      s.addShape(pres.shapes.LINE, {
        x: x + bw + 0.08, y: 3.27, w: gap - 0.16, h: 0,
        line: { color: ACCENT, width: 2, endArrowType: "triangle" },
      });
    }
  });

  s.addText("前端的解法：按时间倒序，从更早的成功运行里把缺失节点的完成结果回填到视图。", {
    x: M, y: 4.45, w: CW, h: lineH(15, 1),
    fontFace: FONT, fontSize: 15, color: SUB, margin: 0, valign: "middle",
  });
  s.addText("后端的对称做法：上游不在本次范围内时，从历史运行里取该节点的产物当输入。", {
    x: M, y: 5.0, w: CW, h: lineH(15, 1),
    fontFace: FONT, fontSize: 15, color: SUB, margin: 0, valign: "middle",
  });

  s.addText("把复杂度从「前端状态机」挪到了「纯函数式的快照合并」，能一眼看懂，也好写测试", {
    x: M, y: 5.75, w: CW, h: 0.5,
    fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
  });

  source(s, "视图层合并见 ProjectEditorView.vue:424-443 与 utils/run-restore.ts:29；服务端对称做法见 engine.ts:779 的 previousOutputs");
}

/* ---------------------------------------------------------- 13 主题三过场 */
{
  const s = pres.addSlide();
  section(s, "03 / 把 AI 的输出当成会坏的东西", "引擎给一份拼接产物", "用户要按视频逐段读");
  s.addText("一张卡挂 8 个视频，引擎把它们拼成一份，人却要一个一个读", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ------------------------------------------------------------ 14 坏条目 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 把 AI 的输出当成会坏的东西");
  title(s, "坏条目逐条丢弃，但原因必须是人话", INK);

  rowList(
    s,
    [
      ["逐条丢弃", "坏条目单独丢掉，但每一条都要给出人话原因；丢弃率本身当质量指标在看"],
      ["不判两次死刑", "生成期严格校验，展示期只做结构解析——同一份数据不被两套标准各否一次"],
      ["要有降级形态", "结构化 JSON 与可读 Markdown 互相兜底；引用定位不到时说人话，不报错"],
      ["产物类型要嗅探", "靠内容特征判断类型，而且要写互斥规则——我们曾经把练习题渲染成了一张空的溯源表格"],
    ],
    { top: 1.85, step: 1.18, pt: 14, center: true },
  );

  source(s, "解析与丢弃见 packages/shared/src/drill.ts；展示期不做二次校验见 apps/web/src/utils/drill.ts:9-11");
}

/* ------------------------------------------------------ 15 安全与渲染边界 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 把 AI 的输出当成会坏的东西");
  title(s, "AI 的 Markdown 进 DOM 之前，必须过一遍", INK);

  rowList(
    s,
    [
      ["为什么危险", "AI 的产物是外部输入。它返回的 Markdown 直接插进页面，等于把远端内容当本地内容渲染"],
      ["做法", "统一走 renderMarkdown：先过 DOMPurify.sanitize，再把结果插进 DOM，不让任何一处绕开"],
      ["不止安全", "同一层还要兜住渲染失败：解析不出来时给一句人话，不把原始 JSON 摊给用户"],
    ],
    { top: 1.85, step: 1.3, pt: 15, labelW: 2.6 },
  );

  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: 5.75, w: CW, h: 0.85,
    fill: { color: BG }, line: { color: BORDER, width: 1 },
  });
  s.addText("这是全场唯一一条跟安全有关的结论，也是 AI 前端最容易漏的一处。", {
    x: M + 0.35, y: 5.85, w: CW - 0.7, h: 0.65,
    fontFace: FONT, fontSize: 15, color: INK, margin: 0, valign: "middle",
  });

  source(s, "见 apps/web/src/lib/markdown.ts:34 的 DOMPurify.sanitize（:1 引入）；降级与丢弃见 utils/drill.ts");
}

/* ---------------------------------------------------------- 16 分段是推出来的 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 把 AI 的输出当成会坏的东西");
  title(s, "分段是推导出来的，不是存下来的", INK);

  rowList(
    s,
    [
      ["引擎为什么拼", "用固定分隔符把多份产物接成一份，只服务下游节点与导出"],
      ["前端怎么还原", "拿运行时记录的「每个输入一行」反推，于是历史运行不用重跑也能分段"],
      ["为什么能读得懂", "分段标题要沿链路向上游回溯最多 12 层，去取原始视频的标题"],
      ["三级优先级", "先看自己的输入行，再看它交付给同一下游的份数，最后兜底用自己的输入行"],
    ],
    { top: 1.85, step: 1.18, pt: 14, center: true },
  );

  source(s, "分段重建见 apps/web/src/utils/run-segments.ts（回溯上限 12 层见 :87 与 :131），被结果页、画布预览、日志弹窗四处共用");
}

/* ------------------------------------------------------------ 17 三个判断 */
{
  const s = pres.addSlide();
  dark(s);
  eyebrow(s, "带走的三个判断");
  title(s, "下次遇到，先问这三句", PAPER);

  const rows = [
    ["加实时通道之前，先问这条通道能不能丢", "能丢，就必须有一条数据库式的真相通道兜底"],
    ["接 AI 的产物，先按「会坏一半」设计展示层", "能逐条成功、逐条给出原因，才敢上线"],
    ["做画布或长列表之前，先问一次交互动多少 DOM", "一屏放不下 + 还在频繁更新，就是同一类问题"],
  ];
  rows.forEach(([q, a], i) => {
    const y = 2.6 + i * 1.5;
    s.addText(q, {
      x: M, y, w: CW, h: 0.5,
      fontFace: FONT, fontSize: 20, bold: true, color: PAPER, margin: 0, valign: "middle",
    });
    s.addText(a, {
      x: M, y: y + 0.52, w: CW, h: 0.45,
      fontFace: FONT, fontSize: 16, color: ACCENT, margin: 0, valign: "middle",
    });
  });
}

/* ------------------------------------------------------------ 18 没做好的 */
{
  const s = pres.addSlide();
  dark(s);
  eyebrow(s, "我们没做好的三件事");
  title(s, "这几个坑也留在这个仓库里", PAPER);

  rowList(
    s,
    [
      [
        "提示没人接",
        "画布抛提示的 3 处调用（节点已达上限两处、自动布局失败一处），父组件一个都没绑定，用户在界面上完全看不到这条反馈",
      ],
      [
        "规则分了三份",
        "连线合法性有 canConnect / canConnectSpecs / isValidConnection 三处实现，最后那一处只被测试引用，已经不认多类型端口",
      ],
      [
        "状态机小了一圈",
        "契约里 7 个节点状态、引擎从不写 queued，而画布只给 running / error / skipped 写了样式——queued 与 cancelled 没有任何视觉表达",
      ],
    ],
    { top: 2.0, step: 1.35, pt: 14, headColor: ACCENT, bodyColor: MUTED, labelW: 3.0, center: true },
  );

  source(s, "自查方式：搜 emit 的定义与父组件的绑定是否对得上；搜同一规则是否在多处重复实现");
}

const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "..", "out");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "ScribeFlow-前端技术分享.pptx");
pres
  .writeFile({ fileName: out })
  .then(() => console.log("生成完成：" + out))
  .catch((error) => {
    console.error("生成失败：", error);
    process.exitCode = 1;
  });
