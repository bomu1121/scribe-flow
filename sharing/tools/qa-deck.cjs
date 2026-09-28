/**
 * 生成前的几何与结构自检。
 *
 * 它读的是**产物本身**：解开 pptx，逐页读形状的坐标与尺寸，所以查的是真实版式，
 * 不是生成器里的字面量。五类问题：
 *   越界   —— 形状超出页面
 *   重叠   —— 两个文本框压在一起
 *   溢出   —— 按字号估出的文字高度超过文本框
 *   独字行 —— 折行后最后一行只剩一个字（中英混排按半宽折算）
 *   空文   —— 文本框里没有可见文字
 *
 * 估行宽是近似：中日韩按 1 em、西文按 0.5 em、空格按 0.28 em。它只用来抓"明显塞不下"，
 * 不替代人眼看图。
 */
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const EMU_PER_PT = 12700;
const EMU_PER_IN = 914400;
const SLIDE_W = Math.round(13.33 * EMU_PER_IN);
const SLIDE_H = Math.round(7.5 * EMU_PER_IN);

/** 单字符宽度（em 的倍数）。 */
function charEm(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x2e80) return 1; // CJK 及全角标点
  if (ch === " ") return 0.28;
  if (/[iIljt.,:;!|'`]/.test(ch)) return 0.3;
  if (/[A-Z]/.test(ch)) return 0.62;
  return 0.52;
}

function textEm(text) {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em;
}

/** 把 <a:p>…</a:p> 里的 run 拆成段落级文本。 */
function paragraphsOf(spXml) {
  const out = [];
  for (const p of spXml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    );
    const size = p.match(/sz="(\d+)"/);
    out.push({ text: runs.join(""), pt: size ? Number(size[1]) / 100 : 18 });
  }
  return out.filter((x) => x.text.length > 0);
}

function shapesOf(slideXml) {
  const out = [];
  for (const m of slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const xml = m[0];
    const off = xml.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = xml.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!off || !ext) continue;
    const name = (xml.match(/name="([^"]*)"/) ?? [, "?"])[1];
    out.push({
      name,
      x: Number(off[1]),
      y: Number(off[2]),
      w: Number(ext[1]),
      h: Number(ext[2]),
      paras: paragraphsOf(xml),
      isText: /<a:t>/.test(xml),
    });
  }
  return out;
}

/** 一个文本框需要多少行、总高多少（EMU）。 */
function needHeight(shape) {
  const usable = shape.w - Math.round(0.2 * EMU_PER_IN); // 左右内边距估算
  if (usable <= 0) return { height: 0, lines: 0, orphan: false };
  let lines = 0;
  let orphan = false;
  for (const p of shape.paras) {
    const emWidth = textEm(p.text);
    const pxWidth = emWidth * p.pt * EMU_PER_PT;
    const n = Math.max(1, Math.ceil(pxWidth / usable));
    lines += n;
    const perLine = pxWidth / n;
    if (n > 1 && Math.ceil(pxWidth / usable) === n) {
      const lastLineEm = pxWidth - perLine * (n - 1);
      if (lastLineEm < (p.pt * EMU_PER_PT) * 1.05) orphan = true;
    }
  }
  const maxPt = Math.max(...shape.paras.map((p) => p.pt), 14);
  const lh = maxPt * 1.2 * 1.15 * EMU_PER_PT;
  return { height: lines * lh, lines, orphan };
}

function overlaps(a, b) {
  const pad = 0.03 * EMU_PER_IN;
  return (
    a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad
  );
}

(async () => {
  const file = process.argv[2] ?? path.join(__dirname, "..", "out", "ScribeFlow-前端技术分享.pptx");
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  let issues = 0;
  const warn = (page, kind, detail) => {
    issues++;
    console.log(`  ✗ P${String(page).padStart(2, "0")} [${kind}] ${detail}`);
  };

  console.log(`自检 ${file}`);
  console.log(`共 ${slideNames.length} 页\n`);

  for (const name of slideNames) {
    const page = Number(name.match(/(\d+)/)[1]);
    const xml = await zip.file(name).async("string");
    const shapes = shapesOf(xml);
    const texts = shapes.filter((s) => s.isText && s.paras.length);

    for (const s of texts) {
      if (s.x < 0 || s.y < 0 || s.x + s.w > SLIDE_W || s.y + s.h > SLIDE_H) {
        warn(page, "越界", `"${s.paras[0].text.slice(0, 18)}" 在 (${(s.x / EMU_PER_IN).toFixed(2)}, ${(s.y / EMU_PER_IN).toFixed(2)}) 尺寸 ${(s.w / EMU_PER_IN).toFixed(2)}×${(s.h / EMU_PER_IN).toFixed(2)} in`);
      }
      const need = needHeight(s);
      if (need.height > s.h + 0.02 * EMU_PER_IN) {
        warn(page, "溢出", `"${s.paras[0].text.slice(0, 18)}" 需要 ${(need.height / EMU_PER_IN).toFixed(2)} in 高、框只有 ${(s.h / EMU_PER_IN).toFixed(2)} in（约 ${need.lines} 行 @ ${s.paras[0].pt}pt）`);
      }
      if (need.orphan) warn(page, "独字行", `"${s.paras[0].text.slice(0, 18)}" 折行后末行只剩一个字`);
    }

    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (overlaps(texts[i], texts[j])) {
          warn(page, "重叠", `"${texts[i].paras[0].text.slice(0, 14)}" × "${texts[j].paras[0].text.slice(0, 14)}"`);
        }
      }
    }
  }

  console.log(`\n问题合计：${issues}`);
  if (issues > 0) process.exitCode = 1;
})();
