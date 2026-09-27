#!/usr/bin/env node
/**
 * PPT 代码级 QA —— 在导出图片之前先查出几何问题。
 * 读 pptx（zip）里的 slideN.xml，对每个文本框检查：
 *   1) 是否越出画布
 *   2) 文本按字号估算所需高度 vs 框高（溢出）
 *   3) 文本框之间的矩形重叠
 *   4) 模板占位符残留
 * 注意：这是估算（中文字宽按 1.0×字号、拉丁按 0.55×字号），
 * 它只用来抓明显问题，最终判定仍以视觉验收为准。
 */
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const EMU = 914400;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const pptx = process.argv[2] || path.join(__dirname, "..", "out", "ScribeFlow-前端技术分享.pptx");
if (!fs.existsSync(pptx)) {
  console.error("找不到 pptx：" + pptx);
  process.exit(1);
}

const listing = execFileSync("unzip", ["-l", pptx], { encoding: "utf8" });
const slides = listing
  .split("\n")
  .map((l) => (l.match(/(ppt\/slides\/slide\d+\.xml)/) || [])[1])
  .filter(Boolean)
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const read = (entry) => execFileSync("unzip", ["-p", pptx, entry], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

const isCJK = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef);
};

// 估算一段文本在给定宽度下的行数与末行填充比例
function layout(text, widthIn, pt) {
  const availPt = widthIn * 72;
  let need = 0;
  for (const ch of text) need += (isCJK(ch) ? 1.0 : 0.55) * pt;
  const lines = Math.max(1, Math.ceil(need / availPt));
  const lastFill = need - (lines - 1) * availPt;
  return { lines, ratio: lastFill / availPt };
}

let problems = 0;
const report = (slideNo, kind, msg) => {
  problems++;
  console.log(`  [slide ${String(slideNo).padStart(2)}] ${kind}: ${msg}`);
};

console.log("PPT 代码级 QA");
console.log("文件：" + path.relative(process.cwd(), pptx));
console.log("");

const textBoxes = {}; // slideNo -> [{x,y,w,h,text}]

slides.forEach((entry, idx) => {
  const no = idx + 1;
  const xml = read(entry);
  textBoxes[no] = [];

  // 逐个 <p:sp> 取位置、尺寸与该形状内的所有文本
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let m;
  while ((m = spRe.exec(xml))) {
    const sp = m[1];
    const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!off || !ext) continue;

    const x = Number(off[1]) / EMU;
    const y = Number(off[2]) / EMU;
    const w = Number(ext[1]) / EMU;
    const h = Number(ext[2]) / EMU;
    const texts = [...sp.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]);
    const text = texts.join("");
    if (!text.trim()) continue;

    // 大面板（卡片/代码块容器）里的文字不适用"孤字行"判定
    const boxIsBigPanel = h > 1.5 && w > 3;

    // 每段的字号（centipoints）
    const paraRe = /<a:p>([\s\S]*?)<\/a:p>/g;
    let p;
    let need = 0;
    let maxPt = 0;
    while ((p = paraRe.exec(sp))) {
      const para = p[1];
      const runs = [...para.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join("");
      if (!runs.trim()) continue;

      // schema 校验：同一段里出现多个 a:pPr 是非法结构，PowerPoint 重排时会错乱
      const pPrCount = (para.match(/<a:pPr[^>]*>/g) || []).length;
      if (pPrCount > 1) {
        report(no, "同段重复 pPr", `${pPrCount} 个 a:pPr（富文本内联混排所致）："${runs.slice(0, 22)}"`);
      }

      const sz = para.match(/sz="(\d+)"/);
      const pt = sz ? Number(sz[1]) / 100 : 18;
      maxPt = Math.max(maxPt, pt);

      const lay = layout(runs, w, pt);
      need += (lay.lines * pt * 1.2 * 1.15) / 72;

      // 孤字行：折行后末行几乎没内容，看起来像排版事故
      if (lay.lines >= 2 && lay.ratio < 0.16 && !boxIsBigPanel) {
        report(no, "孤字行", `末行只占 ${(lay.ratio * 100).toFixed(0)}% 宽（${pt}pt）"${runs.slice(0, 24)}"`);
      }
    }

    if (x < -0.01 || y < -0.01) report(no, "越界", `框起点在画布外 (${x.toFixed(2)}, ${y.toFixed(2)}) "${text.slice(0, 20)}"`);
    if (x + w > SLIDE_W + 0.01) report(no, "越界", `右边超出 (${(x + w).toFixed(2)} > ${SLIDE_W}) "${text.slice(0, 20)}"`);
    if (y + h > SLIDE_H + 0.01) report(no, "越界", `底边超出 (${(y + h).toFixed(2)} > ${SLIDE_H}) "${text.slice(0, 20)}"`);

    // 只有"看起来是纯文本"的框才判溢出：排除已知的背景面板（无文字或文字极少且框很大）
    if (!boxIsBigPanel && need > h + 0.12) {
      report(
        no,
        "溢出",
        `文本需 ${need.toFixed(2)}" 但框高 ${h.toFixed(2)}"（${maxPt}pt）"${text.slice(0, 24)}"`,
      );
    }

    textBoxes[no].push({ x, y, w, h, text });
  }

  if (xml.includes("Click to add") || /lorem|TODO|\[insert/i.test(xml)) {
    report(no, "占位符", "残留模板占位符文本");
  }
});

// 同页文本框重叠
for (const [no, boxes] of Object.entries(textBoxes)) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.05 && oy > 0.05) {
        report(no, "重叠", `"${a.text.slice(0, 14)}" ∩ "${b.text.slice(0, 14)}" = ${ox.toFixed(2)}"×${oy.toFixed(2)}"`);
      }
    }
  }
}

console.log("");
console.log(problems === 0 ? "✔ 未发现几何问题（估算口径）" : `✖ ${problems} 处待确认`);
process.exit(problems === 0 ? 0 : 1);
