#!/usr/bin/env node
/**
 * 从 apps/web/public/favicon.svg 生成 apps/web/public/favicon.ico。
 *
 * 为什么要这一步：Windows 桌面快捷方式的 IconLocation 只认 .ico（或带图标资源的 exe/dll），
 * SVG 不认；而浏览器只认 SVG。与其手画第二份图标让两者慢慢分叉，不如就地光栅化——
 * 这个脚本只实现 SVG 里实际用到的那一小撮（rect + path 的 M/L/H/V/Z），
 * 所以它是「把已有设计转成 Windows 认的格式」，不是一个通用 SVG 渲染器。
 *
 * 只用 node 内置模块（fs / zlib），不引入图形依赖。
 * 用法：node scripts/make-icon.mjs [预览图输出路径]
 *       带参数时额外输出一张 256×256 PNG，方便用眼睛确认光栅化结果。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SVG_PATH = join(ROOT, "apps", "web", "public", "favicon.svg");
const ICO_PATH = join(ROOT, "apps", "web", "public", "favicon.ico");

/** favicon.svg 的 viewBox 是 32×32；这些是 Windows 真正会取的尺寸。 */
const VIEW = 32;
const SIZES = [16, 24, 32, 48, 64, 128, 256];
/** 边缘超采样倍数：每像素 SUPERSAMPLE² 个采样点，用覆盖率当 alpha，省掉一条抗锯齿库。 */
const SUPERSAMPLE = 4;
/** ≥128 的条目用 PNG 压缩（Vista 起支持），小尺寸用 DIB，兼容面更大。 */
const PNG_MIN_SIZE = 128;

/* ----------------------------------------------------------- SVG 子集解析 */

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
};

const parseColor = (hex) => {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
};

/** 只认 M/m L/l H/h V/v Z/z；M 后面多余的坐标对按 SVG 规则当隐式 L。 */
const parsePath = (d) => {
  const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+/g) ?? [];
  const points = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let cmd = null;
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/^[MmLlHhVvZz]$/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case "M": x = num(); y = num(); cmd = "L"; break;
      case "m": x += num(); y += num(); cmd = "l"; break;
      case "L": x = num(); y = num(); break;
      case "l": x += num(); y += num(); break;
      case "H": x = num(); break;
      case "h": x += num(); break;
      case "V": y = num(); break;
      case "v": y += num(); break;
      case "Z":
      case "z": break;
      default: i += 1; continue;
    }
    points.push([x, y]);
  }
  return points;
};

const readShapes = () => {
  const svg = readFileSync(SVG_PATH, "utf8");
  const shapes = [];
  for (const m of svg.matchAll(/<(rect|path)\b([^>]*?)\/?>/g)) {
    const [, tagName, tag] = m;
    const fill = attr(tag, "fill");
    if (!fill || fill === "none") continue;
    const rgb = parseColor(fill);
    if (tagName === "rect") {
      shapes.push({
        roundRect: true,
        x: Number(attr(tag, "x") ?? 0),
        y: Number(attr(tag, "y") ?? 0),
        w: Number(attr(tag, "width") ?? 0),
        h: Number(attr(tag, "height") ?? 0),
        rx: Number(attr(tag, "rx") ?? 0),
        rgb,
      });
    } else {
      shapes.push({ roundRect: false, points: parsePath(attr(tag, "d") ?? ""), rgb });
    }
  }
  return shapes;
};

/* ------------------------------------------------------------- 光栅化 */

/** 交叉数法：路径按偶奇规则填充，够用且不要求凸多边形。 */
const inPolygon = (points, px, py) => {
  let inside = false;
  for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};

const inRoundRect = (s, px, py) => {
  if (px < s.x || px > s.x + s.w || py < s.y || py > s.y + s.h) return false;
  const rx = Math.min(s.rx, s.w / 2);
  const ry = Math.min(s.rx, s.h / 2);
  const cx = Math.min(Math.max(px, s.x + rx), s.x + s.w - rx);
  const cy = Math.min(Math.max(py, s.y + ry), s.y + s.h - ry);
  if (px === cx && py === cy) return true;
  return ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
};

const rasterize = (shapes, size) => {
  const px = new Uint8ClampedArray(size * size * 4);
  const unit = VIEW / size;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (const shape of shapes) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let hit = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const vx = (x + (sx + 0.5) / SUPERSAMPLE) * unit;
            const vy = (y + (sy + 0.5) / SUPERSAMPLE) * unit;
            const inside = shape.roundRect ? inRoundRect(shape, vx, vy) : inPolygon(shape.points, vx, vy);
            if (inside) hit += 1;
          }
        }
        if (hit === 0) continue;

        const srcA = hit / samples;
        const i = (y * size + x) * 4;
        const dstA = px[i + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        for (let c = 0; c < 3; c++) {
          px[i + c] = (shape.rgb[c] * srcA + px[i + c] * dstA * (1 - srcA)) / outA;
        }
        px[i + 3] = outA * 255;
      }
    }
  }
  return px;
};

/* ---------------------------------------------------------------- 编码 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const encodePng = (px, size) => {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(px.buffer, px.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

/** BITMAPINFOHEADER + 自下而上的 BGRA + 1bpp AND 掩码。 */
const encodeDib = (px, size) => {
  const header = Buffer.alloc(40);
  const maskStride = Math.ceil(size / 32) * 4;
  const xorSize = size * size * 4;
  const andSize = maskStride * size;
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND 两张位图叠在一起
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(xorSize + andSize, 20);

  const xor = Buffer.alloc(xorSize);
  const and = Buffer.alloc(andSize);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4;
      const d = (y * size + x) * 4;
      xor[d] = px[s + 2];
      xor[d + 1] = px[s + 1];
      xor[d + 2] = px[s];
      xor[d + 3] = px[s + 3];
      if (px[s + 3] < 128) and[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
};

const buildIco = (entries) => {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(entries.length, 4);

  let offset = dir.length;
  for (const [i, entry] of entries.entries()) {
    const at = 6 + i * 16;
    dir[at] = entry.size >= 256 ? 0 : entry.size; // 256 记作 0
    dir[at + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 2] = 0;
    dir[at + 3] = 0;
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  }
  return Buffer.concat([dir, ...entries.map((e) => e.data)]);
};

/* ------------------------------------------------------------------ 主流程 */

const shapes = readShapes();
const entries = SIZES.map((size) => {
  const px = rasterize(shapes, size);
  return { size, data: size >= PNG_MIN_SIZE ? encodePng(px, size) : encodeDib(px, size) };
});

writeFileSync(ICO_PATH, buildIco(entries));
console.log(`favicon.ico 已生成：${SIZES.join(" / ")} px，共 ${buildIco(entries).length} 字节`);

const previewPath = process.argv[2];
if (previewPath) {
  writeFileSync(previewPath, encodePng(rasterize(shapes, 256), 256));
  console.log(`预览图：${previewPath}`);
}
