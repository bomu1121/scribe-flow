/**
 * 生成分享会 PPT。
 *
 * 结构照 sharing/ROOM.md 三段走（现场手册是执行稿，这份是它的投影版）：
 *   ① 它是什么、跟现成的差在哪（产品形态，4 页）
 *   ② 跑的时候（用户会碰到的两件事之一）
 *   ③ 读的时候（用户会碰到的两件事之二）
 *
 * 选题标准（这一版定的）：**每页的主角是"用户身上发生的事"**，而且要是屋里人自己也会碰到的事；
 * 代码只作为答案出现，不作为标题。段一另给产品形态与差异化——项目介绍该做的事。
 * 反面教材见 git 历史：`16 种节点只注册 1 个 nodeType` 那种"我们的架构取舍"，屋里没有人在意。
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
pres.title = "前端技术分享：一个画布式笔记工具，与用户会碰到的两类事";

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
  s.addText("一个画布式笔记工具：产品形态，与用户会碰到的两类事", {
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
    "我想要的是把中间每一步都摊开：转写用什么、校对要不要、提炼用哪套提示词、要不要出思维导图，我自己连。",
    "所以它是一张画布，不是一个网页应用。",
  ];
  lines.forEach((text, i) => {
    s.addText(text, {
      x: M, y: 2.45 + i * 0.9, w: CW, h: 0.85,
      fontFace: FONT, fontSize: 17, color: INK, margin: 0, valign: "top",
    });
  });

  s.addText("先讲它是什么，再讲用户在界面上会碰到的两类事：跑的时候、读的时候", {
    x: M, y: 6.05, w: CW, h: 0.5,
    fontFace: FONT, fontSize: 18, bold: true, color: ACCENT, margin: 0, valign: "middle",
  });

  source(s, "市场调研见 docs/research/r1-desktop-research.md：20 个产品、14 维功能矩阵、4 个 P0 全部已落地");
}

/* ------------------------------------------------------------ 03 它长什么样 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 它是什么");
  title(s, "一张画布，三个界面", INK);

  rowList(
    s,
    [
      ["画布上放什么", "B 站链接（能选合集与多 P）、本地音视频、已有文稿——三种来源"],
      ["中间接什么", "16 种节点：转写、AI 校对、AI 加工、章节切分、思维导图、Obsidian 笔记、练一练…"],
      ["不用从零连", "内置 9 条常用链路（单线笔记、多路对照、思维导图、分章笔记…），名字与来源无关，也可以自己连"],
      ["跑完看什么", "结果页：正文、按视频分段、思维导图、练一练、节点流水——后两个有产物才出现"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.6 },
  );

  takeaway(s, "把视频和文稿放进画布，连出「转写 → 加工」，跑完得到一份能带走的 Markdown 笔记", {
    y: 5.95, pt: 15,
  });

  source(s, "16 种节点与三种来源见 packages/shared/src/graph.ts 的 NODE_TYPE_LABELS；9 条内置链路的名称见 packages/shared/src/templates.ts");
}

/* ---------------------------------------------------------- 04 跟别人差在哪 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 它是什么");
  title(s, "它站在两类现成产品中间", INK);

  panels(
    s,
    [
      {
        head: "一类：AI 音视频转笔记",
        tone: INK,
        body: "BibiGPT、通义听悟、飞书妙记、Ai好记——贴个链接、选个模板、出一份摘要，管线是固定的。",
      },
      {
        head: "一类：工作流编排",
        tone: INK,
        body: "n8n、Dify、扣子、Flowise——有画布，但做的是自动化与 AI 应用，不是为了把视频变成笔记。",
      },
    ],
    { top: 2.5, h: 1.85, bodyPt: 14 },
  );

  s.addText("可编排的画布 × 音视频素材 × 产物是能带走的 Markdown——这个位置是空的", {
    x: M, y: 4.6, w: CW, h: lineH(17, 1),
    fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
  });

  takeaway(s, "差别不在功能清单上，而在两处：形态是固定管线还是你自己连；数据是别人的账号还是你自己的库", {
    y: 5.5, pt: 15,
  });

  source(s, "对标结论见 docs/research/r1-desktop-research.md（20 个产品、14 维矩阵）与 sharing/ROOM.md 的「三个必答题」");
}

/* ------------------------------------------------------ 05 技术底座 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 它是什么");
  title(s, "这一类的技术底座，用的都是当下一线", INK);

  rowList(
    s,
    [
      ["前端与构建", "Vue 3 组合式 API、TypeScript 5.9、Vite 7；Pinia 管状态，路由按页面拆包"],
      ["画布与布局", "画布用 Vue Flow 1.48；自动布局用 ELK 0.12，整块跑在 Web Worker 里"],
      [
        "组件与渲染",
        "Element Plus 2 配 Reka UI 的无样式原语，颜色只有一份设计令牌；长文本走 marked 加 DOMPurify 渲染，进度用 SSE 推",
      ],
      ["服务端与数据", "Hono 4 + Drizzle ORM + SQLite；图模型的校验用 Zod 4，三个包共用同一份"],
    ],
    { top: 1.8, step: 1.25, pt: 14, labelW: 2.7 },
  );

  takeaway(s, "没有一处是十年前那套写法——jQuery、Options API、Webpack、手写主题色，都不在这个仓库里", {
    y: 6.0, pt: 15,
  });

  source(s, "版本取自四个 package.json（2026-09-29）；图标与字体走 @fontsource 本地托管，不依赖外部 CDN");
}

/* ------------------------------------------------------ 06 别人也做了的，老实说 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 它是什么");
  title(s, "这些别人也做了，老实说", INK);

  rowList(
    s,
    [
      ["视频转写 + 摘要 + 章节 + 思维导图", "对，BibiGPT、通义听悟、飞书妙记都有，有些比我们成熟"],
      ["导出 Obsidian、批量处理", "也有，BibiGPT 支持 Notion / Obsidian / flomo"],
      ["条件分支、失败重试、定时触发", "这些是工作流产品的默认能力，n8n / Dify / Airflow 全都有"],
      ["真正站得住的三条", "① 两类产品接起来的位置是空的 ② 多素材在编排里保持身份 ③ 逐节点产物 + 历史运行可重新分段"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 3.4 },
  );

  takeaway(s, "别装成都是自己发明的——先把「别人也做了」认下来，后面讲「我怎么做的」才有人听", {
    y: 5.95, pt: 15,
  });

  source(s, "承认表与三条差别见 sharing/ROOM.md；三个 P0（条件分支/失败重试/文本工具/章节切分）在代码里都能查到");
}

/* -------------------------------------------- 06 八个视频，只要其中三段 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "01 / 它是什么");
  title(s, "八个视频进同一条链路，我只要其中三段", INK);

  rowList(
    s,
    [
      ["别人怎么做", "要么每个视频单独跑一遍，要么全并成一份——挑不出来，也说不清用了哪几段"],
      ["段身份怎么给", "bvid:分P / file:id / node:来源——只用素材自身的稳定信息，不掺数组下标"],
      ["没配就是全选", "缺这个来源 = 全部选中（兼容旧工程）；空数组 = 全部排除，运行前会被拒绝"],
      ["下游怎么解释", "结果页能按视频切开读，节点摘要会说清「8 段里的哪 3 段」"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.7 },
  );

  takeaway(s, "增量下标是这里最容易埋的坑：上游改了选区，下游的挑选就会静默错位——所以标识只用素材自己的信息", {
    y: 5.95, pt: 15,
  });

  source(s, "segmentKey 与「不掺下标」的理由见 packages/shared/src/segment.ts:17-29；pick 的两种语义见 graph.ts:215-218");
}

/* ------------------------------------------------------------ 07 段二过场 */
{
  const s = pres.addSlide();
  section(s, "02 / 跑的时候", "最长的一次跑了 39 分钟", "界面得一直说真话");
  s.addText("8 个视频那条链路：转写 23.6 分钟、AI 校对 9.3 分钟、下载 2.4 分钟——断线、刷新、重启都是常规情况", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ------------------------------------------------- 08 进度停在半路 / 刷新 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 跑的时候");
  title(s, "进度动到一半就不动了——刷新回来还算数吗", INK);

  rowList(
    s,
    [
      ["用户看到的", "进度停在某个节点不动；或者刷新之后，整屏回到「什么都没跑过」的样子"],
      ["为什么会停", "推送是唯一会静默失效的通道：断线、丢帧、服务重启它都不报错，只是不说话了"],
      ["怎么不撒谎", "推送只当加速，状态以列表与详情为准——断线 2 秒自动重连，另有全局 5 秒对账"],
      ["刷新回来怎么算", "三条恢复路径走同一套规则，规则是 3 个纯函数（45 行，带单测）"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.7 },
  );

  takeaway(s, "回填的三条纪律：不覆盖当前结果、只认画布上还在的节点、失败的运行里已完成的那几个照样算数", {
    y: 5.95, pt: 15,
  });

  source(s, "重连 sse.ts:37；5 秒对账 AppLayout.vue:80；恢复规则 run-restore.ts（45 行 3 纯函数）；回填上限 200 条 ProjectEditorView.vue:425；时长实测自本机 114 次运行记录");
}

/* --------------------------------------------- 09 被记成「你取消了」 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 跑的时候");
  title(s, "服务重启，把跑了一半的运行记成「你取消了」", INK);

  s.addText("用户看到的：一条明明产出过东西的运行，记录里写着「已取消」——像是自己点的。", {
    x: M, y: 1.88, w: CW, h: lineH(15, 1),
    fontFace: FONT, fontSize: 15, color: INK, margin: 0, valign: "middle",
  });

  panels(
    s,
    [
      {
        head: "已取消 · 人自己停的",
        tone: INK,
        body: "不该再提醒——用户知道刚才发生了什么，只需要记录留痕。",
      },
      {
        head: "已中断 · 服务掐断的",
        tone: ERR,
        body: "要提醒，而且要让人一眼看出这次不是自己停的，产物还在。",
      },
    ],
    { top: 2.55, h: 1.6, bodyPt: 14 },
  );

  s.addText("真实案例：run_3b007bff 里 4 个节点有 2 个已完成（2925 / 6558 字），2 个停在中途。", {
    x: M, y: 4.42, w: CW, h: lineH(14, 1),
    fontFace: FONT, fontSize: 14, color: SUB, margin: 0, valign: "middle",
  });

  takeaway(s, "运行记录也只写「名称 + 时间」：一列「成功 / 成功 / 已中断」里，成功每行重复等于没说", {
    y: 5.5, pt: 15,
  });

  source(s, "两个状态的语义与提醒规则见 lib/run-meta.ts 与 utils/run-alert.ts；记录只写名称与时间去见 components/workspace/RunRow.vue；由来见 CHANGELOG 2026-09-28");
}

/* ------------------------------------------------- 10 换条运行，白一下 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "02 / 跑的时候");
  title(s, "换一条运行看，内容先消失、再出现", INK);

  rowList(
    s,
    [
      ["用户看到的", "点另一条运行，正文区先空一下再出内容——大约 100 毫秒的白"],
      ["实测", "切换全程 533 次采样，阅读区消失 0 次、加载占位出现 0 次"],
      ["根因", "请求只占 9 毫秒，其余全是渲染——所以「加个 loading」是错的解法"],
      ["解法", "保留旧内容、压暗，新数据就绪后一次性替换；忙碌提示延迟 180 毫秒才出现"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.7 },
  );

  takeaway(s, "同一个范式也用在设置弹窗：它原来要等 Obsidian 目录扫描 280–840 毫秒才填表，而设置本身只要 4–22 毫秒", {
    y: 5.95, pt: 15,
  });

  source(s, "实测数据原文见 CHANGELOG.md 的 2026-09-29 段（作者实测记录，未在本机复现）；代码见 RunDetailView.vue:80 与 :1129、DocsDialog.vue:52");
}

/* ---------------------------------------------------------- 11 段三过场 */
{
  const s = pres.addSlide();
  section(s, "03 / 读的时候", "引擎给一份拼接产物", "人却要按视频逐段读");
  s.addText("一张卡挂 8 个视频，读完要一段一段来；AI 的产物坏了也得有降级", {
    x: M, y: 4.65, w: CW, h: 0.4,
    fontFace: FONT, fontSize: 15, color: MUTED, margin: 0, valign: "middle",
  });
}

/* ---------------------------------------------------- 12 八个视频自己找 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 读的时候");
  title(s, "八个视频，读的时候得一段一段自己找", INK);

  rowList(
    s,
    [
      ["用户看到的", "一份几万字的产物里混着 8 个视频的内容，只能靠滚轮找「下一个视频从哪开始」"],
      ["分段哪来的", "不是后端存的，是拿运行时记录的「每个输入一行」反推——历史运行不用重跑也能切开读"],
      ["标题怎么来的", "沿链路向上游回溯最多 12 层，取原始视频的名字"],
      ["导航长什么样", "右侧常驻大纲 + ‹ 3/8 › 翻页 + ↑↓ / jk / Home / End 键盘；段数 > 12 才出现筛选框"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.7 },
  );

  takeaway(s, "旧的「8 个横排胶囊」是被规范否掉的：Apple HIG 说分段控件上限 5，M3 说 tab 只用于并列内容", {
    y: 5.95, pt: 15,
  });

  source(s, "分段重建见 apps/web/src/utils/run-segments.ts（回溯上限 12 见 :87 与 :131）；选型依据见 docs/research/segment-navigation-research.md；筛选阈值见 RunDetailView.vue:2094");
}

/* --------------------------------------------- 13 渲染错类型，空了 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 读的时候");
  title(s, "我们曾经把练习题渲染成一张空表格", INK);

  rowList(
    s,
    [
      ["用户看到的", "点开「练一练」标签页，是一张空的溯源表格——产品里其实有题，是渲染认错了类型"],
      ["根因", "按内容特征嗅探产物类型，但一开始没写互斥规则，练习题被当成溯源报告渲染"],
      ["现在怎么防", "先排除练习题、再判溯源；坏条目逐条丢弃，但每一条都要给出人话原因"],
      ["一条安全底线", "AI 的产物是外部输入：Markdown 进 DOM 前统一过 DOMPurify（35 行单入口，四处共用）"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.7 },
  );

  takeaway(s, "把 AI 的输出当成「会坏的东西」来设计展示层——能逐条成功、逐条给出原因，才敢上线", {
    y: 5.95, pt: 15,
  });

  source(s, "类型嗅探见 apps/web/src/views/RunDetailView.vue:378；消毒见 lib/markdown.ts:32-34；逐条丢弃与原因见 packages/shared/src/drill.ts");
}

/* ------------------------------------------- 14 选字结果拖跑了节点 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 读的时候");
  title(s, "想在输入框里选一段字，结果把节点拖跑了", INK);

  panels(
    s,
    [
      {
        head: "画布要能拖",
        tone: INK,
        body: "整张卡片默认跟随鼠标移动——这是画布该有的手感，n8n 也是这么做的。",
      },
      {
        head: "表单要能填",
        tone: INK,
        body: "但卡片里还有输入框：要能选文字、要点得到光标、滚轮不该把画布缩放带走。",
      },
    ],
    { top: 2.5, h: 1.85, bodyPt: 14 },
  );

  s.addText("解法：拖拽句柄收敛到卡片头部一处，表单区域标 nodrag，卡片内滚轮不穿透。", {
    x: M, y: 4.6, w: CW, h: lineH(17, 1),
    fontFace: FONT, fontSize: 17, bold: true, color: INK, margin: 0, valign: "middle",
  });

  takeaway(s, "顺带一条：一按运行整张卡片就变灰锁住，用的是 getter 不是快照——所以不用刷新，界面立刻变", {
    y: 5.5, pt: 15,
  });

  source(s, "句柄选择器见 apps/web/src/utils/flow.ts:8；dragHandle 见 components/canvas/FlowCanvas.vue:397；只读态见 ScribeNode.vue:404");
}

/* ------------------------------------------- 15 粘过来的是分享文案 */
{
  const s = pres.addSlide();
  light(s);
  eyebrow(s, "03 / 读的时候");
  title(s, "粘过来的是 App 分享文案，不是链接", INK);

  rowList(
    s,
    [
      ["用户看到的", "从 B 站 App 复制出来的是一整段话：标题、短链、口令混在一起，粘进去建不了工程"],
      ["解法", "从这段文本里抠出链接与标题，链接再拆出分 P 号——粘进去就能用，四步并成一步"],
      ["为什么值得单独做", "用户不会为了你先把粘贴内容清理干净；不接受他的输入格式，就是把他挡在门外"],
      ["顺带", "短链（b23.tv）也要认，所以判定不能只看域名后缀"],
    ],
    { top: 1.8, step: 1.1, pt: 14, labelW: 2.9 },
  );

  takeaway(s, "前端最便宜的体验提升，往往就是把用户实际会粘的东西也当成合法输入", { y: 5.95, pt: 15 });

  source(s, "见 packages/shared/src/bili.ts（87 行、3 个函数，11 条用例）与 components/workspace/QuickCreateDialog.vue");
}

/* ------------------------------------------------------------ 16 三个判断 */
{
  const s = pres.addSlide();
  dark(s);
  eyebrow(s, "带走的三个判断");
  title(s, "下次遇到，先问这三句", PAPER);

  const rows = [
    ["「别人也有」不可怕，接不上的位置才是你的位置", "固定管线和可编排之间，是两种产品的缝"],
    ["用户说「卡住了 / 闪一下 / 没反应」，先别查网络", "这三句里至少有两句是渲染与状态的问题"],
    ["每一段数据都要带着身份走完全程", "素材段不掺下标、状态不靠推送——都是同一件事"],
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

/* ------------------------------------------------------------ 17 没做好的 */
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
        '画布有 3 处 emit("notice")（节点已达上限 2 处、自动布局失败 1 处），父组件一个都没绑定——用户在界面上完全看不到这条反馈',
      ],
      [
        "长文档还是一次性渲染",
        "几万字的正文一次全进 DOM，虚拟化没做；长列表滚动会是下一处要还的债",
      ],
      [
        "状态机小了一圈",
        "契约里 7 个节点状态、引擎从不写 queued，而画布只给 running / error / skipped 写了样式——queued 与 cancelled 没有任何视觉表达",
      ],
    ],
    { top: 2.0, step: 1.35, pt: 14, headColor: ACCENT, bodyColor: MUTED, labelW: 3.0, center: true },
  );

  source(s, "自查方式：搜 emit 的定义与父组件的绑定是否对得上；搜同一规则是否在多处重复实现；把契约的枚举与样式表对一遍");
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
