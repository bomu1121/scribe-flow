/**
 * 生成分享会 PPT。
 *
 * 主题是这个产品的三个主体界面，不是工程配置：
 *   ① 节点编排画布   ② 长任务的实时呈现   ③ 把 AI 输出变成可读界面
 * 每条结论都对着仓库里的实际代码核过，行号见 SPEECH.md。
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

const light = (s) => {
  s.background = { color: PAPER };
};
const dark = (s) => {
  s.background = { color: INK };
};

// 母题：方块「节点」+ 标签 —— 取自这个项目的画布本身
function eyebrow(s, text) {
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: 0.45, w: 0.13, h: 0.13, fill: { color: ACCENT } });
  s.addText(text, {
    x: M + 0.3, y: 0.34, w: CW - 0.3, h: 0.34,
    fontFace: FONT, fontSize: 13, color: MUTED, charSpacing: 1, margin: 0, valign: "middle",
  });
}

function title(s, text, color) {
  s.addText(text, {
    x: M, y: 0.85, w: CW, h: 0.8,
    fontFace: FONT, fontSize: 31, bold: true, color, margin: 0, valign: "middle",
  });
}

function source(s, text) {
  s.addText(text, {
    x: M, y: H - 0.6, w: CW, h: 0.3,
    fontFace: FONT, fontSize: 12, color: MUTED, margin: 0, valign: "middle",
  });
}

// 行式布局：左标签 + 右说明，中间用发丝线分隔（容器自由分组）
// 对齐要点：标签盒子高度取「说明的首行行高」并垂直居中，这样说明只有一行时
// 标签与它同高；若标签盒子另给高度，标签会整体低半行（曾整批出现过这个问题）。
const firstLine = (pt) => (pt * 1.2 * 1.15) / 72;

function rowList(s, rows, opts = {}) {
  const top = opts.top ?? 1.85;
  const step = opts.step ?? 1.25;
  const labelW = opts.labelW ?? 3.3;
  const pt = opts.pt ?? 15;
  rows.forEach(([head, body], i) => {
    const y = top + i * step;
    s.addText(head, {
      x: M, y, w: labelW, h: firstLine(pt),
      fontFace: FONT, fontSize: pt + 2, bold: true, color: opts.headColor ?? INK, margin: 0, valign: "middle",
    });
    s.addText(body, {
      x: M + labelW + 0.2, y, w: CW - labelW - 0.2, h: lineH(pt, 2),
      fontFace: FONT, fontSize: pt, color: SUB, margin: 0, valign: "top",
    });
    if (i < rows.length - 1) {
      s.addShape(pres.shapes.LINE, { x: M, y: y + step - 0.22, w: CW, h: 0, line: { color: BORDER, width: 1 } });
    }
  });
}

// 分节页
function section(s, num, line1, line2) {
  dark(s);
  eyebrow(s, num);
  s.addText(line1, {
    x: M, y: 2.45, w: CW, h: 0.95,
    fontFace: FONT, fontSize: 38, bold: true, color: PAPER, margin: 0, valign: "middle",
  });
  s.addText(line2, {
    x: M, y: 3.5, w: CW, h: 0.95,
    fontFace: FONT, fontSize: 38, bold: true, color: ACCENT, margin: 0, valign: "middle",
  });
}

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

/* -------------------------------------------------------------- 02 三件事 */
{
  const s = pres.addSlide();
  dark(s);
  eyebrow(s, "今天讲三件事");
  title(s, "都是产品的主体界面，不是工程配置", PAPER);

  const rows = [
    ["01", "节点编排画布", "16 种节点、5687 行，画布是这个产品的核心界面"],
    ["02", "长任务的实时呈现", "一次运行可能跑十几分钟，前端要一直说真话"],
    ["03", "AI 输出的呈现层", "引擎给一份拼接产物，用户要按视频逐段读"],
  ];
  rows.forEach(([num, head, sub], i) => {
    const y = 2.25 + i * 1.35;
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

/* ------------------------------------------------------------ 03 主题一过场 */
{
  const s = pres.addSlide();
  section(s, "01 / 节点编排画布", "用了画布库", "也不省产品级画布的工作量");
  s.addText("5687 行画布代码里，真正调库 API 的不到 200 行", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ------------------------------------------------------ 04 一个 nodeType */
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
      body: "外壳文件长到 2849 行，卡片分派是一条 14 段的 v-if 链；只有 6 张卡片拆成了独立组件。",
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

  source(s, "FlowCanvas.vue 只注册 1 个 nodeType（:93）；卡片分派见 ScribeNode.vue（2849 行，:935 起 14 段分支）");
}

/* ---------------------------------------------------------- 05 端口类型学 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 节点编排画布");
  title(s, "能不能连，由类型系统说了算", INK);

  rowList(s, [
    ["4 种端口类型", "audio / transcript / noteBlock / noteDoc，连线合法性不看界面，看类型是否兼容"],
    ["类型有偏序", "noteDoc 既收 noteBlock 也收 noteDoc；其余三种只收同类型"],
    ["三道关卡", "拖拽时实时判定合法、落边时去重与拒自连、保存时服务端再校验一次"],
  ], { top: 1.9, step: 1.3 });

  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: 5.35, w: CW, h: 1.0,
    fill: { color: BG }, line: { color: BORDER, width: 1 },
  });
  s.addText("诚实的部分：这条规则现在有三份实现，其中一份已经不认多类型端口，只在测试里用。", {
    x: M + 0.35, y: 5.45, w: CW - 0.7, h: 0.8,
    fontFace: FONT, fontSize: 15, color: INK, margin: 0, valign: "middle",
  });

  source(s, "端口定义见 packages/shared/src/{port,graph}.ts；画布侧判定见 FlowCanvas.vue:300-309");
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

/* ------------------------------------------------------ 07 浮层坐标系 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 节点编排画布");
  title(s, "画布缩放之后，浮层怎么还对得上", INK);

  rowList(s, [
    ["问题", "浮层被传送到 body，脱离了画布的缩放坐标系，缩放 60% 时它还是原尺寸"],
    ["解法", "从画布取当前缩放，沿组件树传给所有浮层，浮层用 CSS zoom 补偿"],
    ["两个细节", "位置不用补（浮层库按屏幕矩形定位，缩放后矩形已经是对的），只有尺寸要补"],
    ["为什么用 zoom", "CSS zoom 参与布局计算，而 transform: scale 会干扰浮层库自己的测量与定位原点"],
  ], { top: 1.85, step: 1.18, pt: 14 });

  source(s, "补偿见 ScribeNode.vue provide 与三个浮层容器；更麻烦的一处见 ModelSelect.vue（屏幕宽度要除以缩放才是节点局部宽度）");
}

/* ------------------------------------------------------------ 08 主题二过场 */
{
  const s = pres.addSlide();
  section(s, "02 / 长任务的实时呈现", "一次运行跑十几分钟", "前端得一直说真话");
  s.addText("转写、AI 加工都可能很久，而且中途断线、切页面、服务重启都是常态", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ---------------------------------------------------------------- 09 轮询 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 长任务的实时呈现");
  title(s, "有了推送，反而更需要轮询", INK);

  rowList(s, [
    ["直觉", "已经有实时推送了，轮询是多余的老办法"],
    ["实际", "推送是唯一会静默失效的通道：断线、丢帧、服务重启，它都不会报错，只是不说话了"],
    ["所以", "数据库是真相通道，推送只是加速通道；轮询不是推送的备份，是它的正确性校正器"],
    ["四层兜底", "断线 2 秒重连、全局 5 秒轮询对账、运行结束补一次终局快照、进页面时恢复上次运行"],
  ], { top: 1.85, step: 1.18, pt: 14 });

  source(s, "重连 sse.ts:32-39；轮询 AppLayout.vue:36；对账与恢复见 ProjectEditorView.vue 的 resumeRun / reconcileActiveRun / restoreLastRun");
}

/* ------------------------------------------------------------ 10 建连快照 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 长任务的实时呈现");
  title(s, "连接这个动作，必须自带状态同步", INK);

  s.addText("后端的运行事件广播是一个内存集合，没有重放缓冲：运行结束 60 秒后整条记录就没了。", {
    x: M, y: 1.8, w: CW, h: lineH(16, 2),
    fontFace: FONT, fontSize: 16, color: INK, margin: 0, valign: "top",
  });

  s.addText("所以建连时服务端先补一份全量快照，再进增量流。", {
    x: M, y: 2.8, w: CW, h: lineH(18, 1),
    fontFace: FONT, fontSize: 18, bold: true, color: INK, margin: 0, valign: "middle",
  });

  const rows = [
    ["已完成", "补成完成事件，并带上摘要与预览"],
    ["失败", "补成失败事件，带上错误信息"],
    ["进行中", "补一次「已开始」，否则重连后节点不再有动效"],
    ["已结束", "补一条结束事件，然后直接断开"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 3.6 + i * 0.62;
    s.addText(k, {
      x: M + 0.3, y, w: 1.4, h: 0.5,
      fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0, valign: "middle",
    });
    s.addText(v, {
      x: M + 1.8, y, w: CW - 1.8, h: 0.5,
      fontFace: FONT, fontSize: 14, color: SUB, margin: 0, valign: "middle",
    });
  });

  source(s, "建连补快照见 apps/server/src/routes/runs.ts:202-224；广播无重放见 engine.ts:91 与 :538-545");
}

/* ------------------------------------------------------------ 11 幂等覆盖 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 长任务的实时呈现");
  title(s, "放弃增量更新，换来重连正确", INK);

  const panels = [
    {
      x: M, head: "增量更新 · 直觉做法", tone: MUTED,
      lines: [
        "只传变化的那一点，看起来最省",
        "但要求「先收到全部前置事件」才算得对",
        "于是重连就必须做事件重放",
        "而这套系统的广播没有重放缓冲",
      ],
    },
    {
      x: M + CW / 2 + 0.2, head: "全量覆盖 · 实际做法", tone: INK,
      lines: [
        "每个事件构造补丁，整体覆盖字段",
        "只给命中的节点建新对象，其余返回同一引用",
        "重复、乱序的事件天然幂等",
        "重连的正确性问题直接消失",
      ],
    },
  ];
  panels.forEach((p) => {
    const pw = CW / 2 - 0.2;
    s.addShape(pres.shapes.RECTANGLE, {
      x: p.x, y: 2.05, w: pw, h: 2.45,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(p.head, {
      x: p.x + 0.35, y: 2.25, w: pw - 0.7, h: 0.42,
      fontFace: FONT, fontSize: 16, bold: true, color: p.tone, margin: 0, valign: "middle",
    });
    s.addText(
      p.lines.map((t, i) => ({
        text: t,
        options: { bullet: { code: "2022", indent: 12 }, breakLine: i < p.lines.length - 1 },
      })),
      {
        x: p.x + 0.35, y: 2.78, w: pw - 0.7, h: 1.75,
        fontFace: FONT, fontSize: 14, color: SUB,
        paraSpaceAfter: 8, margin: 0, valign: "top",
      },
    );
  });

  s.addText("直觉是增量更省，但增量把正确性押在「事件不会丢」上，而事件一定会丢。", {
    x: M, y: 4.85, w: CW, h: 0.5,
    fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
  });

  source(s, "事件到状态的映射见 FlowCanvas.vue:721-760；对象身份保留见同文件 :757-759 与 :724-727");
}

/* -------------------------------------------------------- 12 局部重跑 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 长任务的实时呈现");
  title(s, "局部重跑是一次新运行", INK);

  s.addText("点「从此节点运行」不会复用旧运行，而是新开一次。这是结果合并存在的根本原因。", {
    x: M, y: 1.75, w: CW, h: lineH(16, 1),
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
      x, y: 2.65, w: bw, h: 1.35,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(head, {
      x: x + 0.3, y: 2.85, w: bw - 0.6, h: 0.45,
      fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
    });
    s.addText(body, {
      x: x + 0.3, y: 3.4, w: bw - 0.6, h: lineH(14, 1),
      fontFace: FONT, fontSize: 14, color: SUB, margin: 0, valign: "top",
    });
    if (i < steps.length - 1) {
      s.addShape(pres.shapes.LINE, {
        x: x + bw + 0.08, y: 3.32, w: gap - 0.16, h: 0,
        line: { color: ACCENT, width: 2, endArrowType: "triangle" },
      });
    }
  });

  s.addText("前端的解法：按时间倒序，从更早的成功运行里把缺失节点的完成结果回填到视图。", {
    x: M, y: 4.5, w: CW, h: lineH(15, 1),
    fontFace: FONT, fontSize: 15, color: SUB, margin: 0, valign: "middle",
  });
  s.addText("后端的对称做法：上游不在本次范围内时，从历史运行里取该节点的产物当输入。", {
    x: M, y: 5.05, w: CW, h: lineH(15, 1),
    fontFace: FONT, fontSize: 15, color: SUB, margin: 0, valign: "middle",
  });

  s.addText("把复杂度从「前端状态机」挪到了「纯函数式的快照合并」，能一眼看懂，也好写测试", {
    x: M, y: 5.8, w: CW, h: 0.5,
    fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
  });

  source(s, "新运行见 routes/runs.ts:118；视图层合并见 ProjectEditorView.vue:404-431；服务端 previousOutputs 见 engine.ts:758-819");
}

/* ---------------------------------------------------------- 13 主题三过场 */
{
  const s = pres.addSlide();
  section(s, "03 / AI 输出的呈现层", "引擎给的是拼接产物", "用户要的是按段读");
  s.addText("一张卡挂 8 个视频，引擎把它们拼成一份，人却要一个一个读", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* -------------------------------------------------------- 14 分段重建 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / AI 输出的呈现层");
  title(s, "把拼起来的产物，还原成可读的分段", INK);

  rowList(s, [
    ["引擎为什么拼", "用固定分隔符把多份产物接成一份，只服务下游节点与导出"],
    ["前端怎么还原", "拿运行时记录的「每个输入一行」反推，于是历史运行不用重跑也能分段"],
    ["为什么能读得懂", "分段标题要沿链路向上游回溯最多 12 层，去取原始视频的标题"],
    ["三级优先级", "先看自己的输入行，再看它交付给同一下游的份数，最后兜底用自己的输入行"],
  ], { top: 1.85, step: 1.18, pt: 14 });

  source(s, "分段重建见 apps/web/src/utils/run-segments.ts（回溯上限 12 层见 :87 与 :131）");
}

/* ------------------------------------------------------ 15 坏产物是常态 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / AI 输出的呈现层");
  title(s, "把「AI 返回的东西坏了」当常态", INK);

  rowList(s, [
    ["逐条丢弃", "坏条目单独丢掉，但每一条都要给出人话原因，丢弃率本身当质量指标看"],
    ["不判两次死刑", "生成期严格校验，展示期只做结构解析 —— 同一份数据不被两套标准各否一次"],
    ["类型要嗅探", "产物类型靠内容特征判断，而且要写互斥规则：曾经把练习题渲染成了空的溯源表格"],
    ["要有降级形态", "结构化 JSON 与可读 Markdown 互相兜底；引用定位不到时说人话，不报错"],
  ], { top: 1.85, step: 1.18, pt: 14 });

  source(s, "解析与丢弃见 packages/shared/src/drill.ts；展示期不做二次校验见 apps/web/src/utils/drill.ts:9-11");
}

/* ------------------------------------------------------- 16 第三方库时序 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / AI 输出的呈现层");
  title(s, "可视化库的成本在时序，不在 API", INK);

  s.addText("思维导图用的是 markmap。API 只有几个方法，真正的成本全在「什么时候调」。", {
    x: M, y: 1.75, w: CW, h: lineH(16, 1),
    fontFace: FONT, fontSize: 16, color: INK, margin: 0, valign: "middle",
  });

  const seq = ["容器有尺寸", "创建实例", "喂数据", "等一帧后适配一次"];
  const sgap = 0.6;
  const sw = (CW - sgap * 3) / 4;
  seq.forEach((label, i) => {
    const x = M + i * (sw + sgap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 2.6, w: sw, h: 1.1,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(label, {
      x: x + 0.15, y: 2.6, w: sw - 0.3, h: 1.1,
      fontFace: FONT, fontSize: 14, bold: true, color: INK, align: "center", margin: 0, valign: "middle",
    });
    if (i < seq.length - 1) {
      s.addShape(pres.shapes.LINE, {
        x: x + sw + 0.06, y: 3.15, w: sgap - 0.12, h: 0,
        line: { color: ACCENT, width: 2, endArrowType: "triangle" },
      });
    }
  });

  const notes = [
    {
      x: M, head: "零尺寸守门", tone: INK,
      body: "容器尺寸为 0 时不创建实例，等尺寸观察器通知再来，否则会先渲染出一张空图。",
    },
    {
      x: M + CW / 2 + 0.2, head: "一个版本坑", tone: ERR,
      body: "该版本的 JSON 配色选项会让整张图渲染空白，于是颜色改走 CSS 变量。",
    },
  ];
  notes.forEach((c) => {
    const cw = CW / 2 - 0.2;
    s.addShape(pres.shapes.RECTANGLE, {
      x: c.x, y: 4.2, w: cw, h: 1.6,
      fill: { color: BG }, line: { color: BORDER, width: 1 },
    });
    s.addText(c.head, {
      x: c.x + 0.32, y: 4.4, w: cw - 0.64, h: 0.42,
      fontFace: FONT, fontSize: 16, bold: true, color: c.tone, margin: 0, valign: "middle",
    });
    s.addText(c.body, {
      x: c.x + 0.32, y: 4.93, w: cw - 0.64, h: lineH(14, 2),
      fontFace: FONT, fontSize: 14, color: SUB, margin: 0, valign: "top",
    });
  });

  source(s, "时序处理见 apps/web/src/components/MindMapViewer.vue（配色坑的注释在 :51-55）");
}

/* ------------------------------------------------------------ 17 三个判断 */
{
  const s = pres.addSlide();
  dark(s);
  eyebrow(s, "带走的三个判断");
  title(s, "下次遇到，先问这三句", PAPER);

  const rows = [
    ["画布的外壳共享到什么程度？", "共享得越多文件越长，拆得越碎公共逻辑越难对齐"],
    ["实时通道能不能丢？", "能丢就必须有真相通道兜底，否则它静默失效时你无从察觉"],
    ["AI 的产物会不会坏一半？", "会，就要能逐条成功、逐条给出原因"],
  ];
  rows.forEach(([q, a], i) => {
    const y = 2.3 + i * 1.3;
    s.addText(q, {
      x: M, y, w: CW, h: 0.5,
      fontFace: FONT, fontSize: 20, bold: true, color: PAPER, margin: 0, valign: "middle",
    });
    s.addText(a, {
      x: M, y: y + 0.5, w: CW, h: 0.45,
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

  rowList(s, [
    ["提示没人接", "画布抛提示的 3 处调用（节点已达上限两处、自动布局失败一处），父组件一个都没绑定，用户在界面上完全看不到这条反馈，只能自己猜"],
    ["规则分了三份", "连线合法性有代码里三处实现，其中一处已经不认多类型端口，只在测试里用"],
    ["状态机小了一圈", "契约里 7 个节点状态，引擎只写 5 个，画布只给 4 个写了样式，取消状态没有视觉表达"],
  ], { top: 2.0, step: 1.35, pt: 14, headColor: ACCENT, labelW: 3.0 });

  source(s, "自查方式：搜 emit 的定义与父组件的绑定是否对得上；搜同一规则是否在多处重复实现");
}

const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "..", "out");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "ScribeFlow-前端技术分享.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("生成完成：" + out));
