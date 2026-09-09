// ScribeFlow P0 验证脚本：B站 DASH 视频下载 → ffmpeg 合成 mp4(+faststart) → 校验
// 用法（在 apps/server 目录下）：
//   node video-poc.mjs --modes guest,login            # 自动选一个公开短视频，跑游客/登录两组
//   node video-poc.mjs --modes guest --bvid BVxxxx    # 指定视频
//   node video-poc.mjs --serve <outDir> [--port 8345] # 起 Range 静态服务器（供播放验证）
// 不打印 Cookie 本体；登录态直接从本机 SQLite 读取（仅自托管单机场景）。
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const HERE = dirname(fileURLToPath(import.meta.url));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CODEC_NAME = { 7: "AVC/H.264", 12: "HEVC/H.265", 13: "AV1" };

function argsOf() {
  const out = { modes: ["guest"], bvid: "", out: "", serve: false, port: 8345 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const [k, inline] = argv[i].split("=");
    const nextValue = () => String(inline ?? argv[i + 1] ?? "");
    const consume = () => { if (inline === undefined) i += 1; };
    if (k === "--modes") { out.modes = nextValue().split(",").map((s) => s.trim()).filter(Boolean); consume(); }
    if (k === "--bvid") { out.bvid = nextValue(); consume(); }
    if (k === "--out") { out.out = nextValue(); consume(); }
    if (k === "--port") { out.port = Number(nextValue() || 8345); consume(); }
    if (k === "--serve") out.serve = true;
  }
  return out;
}

function log(...parts) {
  console.log("[POC]", ...parts);
}

function biliHeaders(cookie, referer = "https://www.bilibili.com/") {
  const h = { "User-Agent": UA, Referer: referer, Accept: "application/json" };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function biliJson(url, cookie) {
  const res = await fetch(url, { headers: biliHeaders(cookie), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`B站请求失败 ${res.status} ${url}`);
  const body = await res.json();
  if (body.code !== 0 || !body.data) throw new Error(`B站接口错误 ${body.code}: ${body.message ?? ""} ${url}`);
  return body.data;
}

function readCookieFromDb() {
  try {
    const require = createRequire(import.meta.url);
    const dbPath = resolve(HERE, "data", "scribe-flow.sqlite");
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare("select cookie from bili_cookies where id = 1").get();
      return row?.cookie ? String(row.cookie) : "";
    } finally {
      db.close();
    }
  } catch (err) {
    log("读取本地 Cookie 失败（继续游客模式）：", err instanceof Error ? err.message : err);
    return "";
  }
}

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

async function download(url, destPath, cookie, referer, label) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: referer, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok || !res.body) throw new Error(`${label}下载失败 ${res.status}`);
  const started = Date.now();
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  const sec = (Date.now() - started) / 1000;
  const mb = (await stat(destPath)).size / 1024 / 1024;
  return { sec, mb, mbps: mb / sec };
}

async function ffprobe(filePath) {
  return new Promise((resolvePromise) => {
    const child = spawn("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.once("error", () => resolvePromise(null));
    child.once("exit", () => {
      try {
        resolvePromise(JSON.parse(out));
      } catch {
        resolvePromise(null);
      }
    });
  });
}

function fmtSec(s) {
  return Number.isFinite(s) ? `${s.toFixed(1)}s` : "—";
}

async function pickVideo() {
  const popular = await biliJson("https://api.bilibili.com/x/web-interface/popular?pn=1&ps=20", "");
  const list = popular.list ?? [];
  const short = list.find((v) => Number(v.duration ?? 9999) <= 600 && v.bvid);
  if (!short) throw new Error("热门列表没有短视频");
  return { bvid: short.bvid, title: short.title, duration: short.duration };
}

async function runMode(mode, cookie, target, outRoot) {
  const { bvid, title, duration } = target;
  const tag = mode === "login" ? "login" : "guest";
  log(`===== 模式 ${tag}：${bvid}《${title}》时长 ${fmtSec(duration)} =====`);
  const dir = join(outRoot, tag === "login" ? `login-${bvid}` : `guest-${bvid}`);
  await mkdir(dir, { recursive: true });

  const detail = await biliJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    cookie,
  );
  const page = detail.pages?.[0] ?? { cid: 0, page: 1, part: "P1" };
  const cid = page.cid;
  if (!cid) throw new Error(`缺少 cid ${bvid}`);
  log(`cid=${cid} pages=${detail.pages?.length ?? 1}（取 P${page.page}）`);

  const play = await biliJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&fnver=0&fourk=1&qn=80`,
    cookie,
  );
  const accept = play.accept_quality ?? [];
  const dash = play.dash;
  log(`accept_quality=${JSON.stringify(accept)} dash=${Boolean(dash)} durl=${play.durl ? play.durl.length : 0}条`);
  const videoStreams = (dash?.video ?? []).map((s) => ({
    id: s.id,
    codecid: s.codecid,
    codec: CODEC_NAME[s.codecid] ?? `codec?${s.codecid}`,
    bandwidth: s.bandwidth,
    w: s.width,
    h: s.height,
    fr: s.frameRate,
  }));
  for (const s of videoStreams.sort((a, b) => b.bandwidth - a.bandwidth)) {
    log(`  dash.video id=${s.id} ${s.codec} ${s.w}x${s.h} bw=${s.bandwidth} fps=${s.fr}`);
  }

  const audio = [...(dash?.audio ?? [])].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  const chosen =
    videoStreams.find((s) => s.codecid === 7) ?? videoStreams[0]; // 首选 AVC，其次任意
  if (!chosen) throw new Error("没有可用视频流");
  const vUrl = (dash?.video ?? []).find((s) => s.id === chosen.id && s.codecid === chosen.codecid)?.baseUrl;
  const aUrl = audio?.baseUrl;
  if (!vUrl || !aUrl) throw new Error("缺少 DASH 流地址");
  log(`选用视频 id=${chosen.id} ${chosen.codec} ${chosen.w}x${chosen.h}；音频 id=${audio?.id} codecid=${audio?.codecid} bw=${audio?.bandwidth}`);

  const referer = `https://www.bilibili.com/video/${bvid}`;
  const vPath = join(dir, "video.m4s");
  const aPath = join(dir, "audio.m4s");
  const v = await download(vUrl, vPath, cookie, referer, `视频(${chosen.codec})`);
  const a = await download(aUrl, aPath, cookie, referer, "音轨");
  log(`下载完成：视频 ${v.mb.toFixed(1)}MB @${v.mbps.toFixed(2)}MB/s（${fmtSec(v.sec)}），音轨 ${a.mb.toFixed(1)}MB`);

  const mp4 = join(dir, "out.mp4");
  const muxStart = Date.now();
  const copyMode = chosen.codecid === 7; // AVC→copy；HEVC/AV1 先试 copy 留样
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-y", "-i", vPath, "-i", aPath, "-c", "copy", "-movflags", "+faststart", mp4]);
    log(`ffmpeg copy 合成成功：${fmtSec((Date.now() - muxStart) / 1000)}（${copyMode ? "AVC 预期路径" : "非 AVC copy 容器可成，但浏览器解码需转码"}）`);
  } catch {
    log("copy 合成失败，尝试 libx264 转码（veryfast/crf23）…");
    const x264 = join(dir, "out_x264.mp4");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-y", "-i", vPath, "-i", aPath, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "copy", "-movflags", "+faststart", x264]);
    log(`libx264 转码成功：${fmtSec((Date.now() - muxStart) / 1000)}`);
    const fx = await ffprobe(x264);
    log(`x264 产物：${(await stat(x264)).size / 1024 / 1024}MB codec=${fx?.streams?.[0]?.codec_name}`);
    return { mp4: x264, kind: "x264" };
  }

  const info = await ffprobe(mp4);
  const fmt = info?.format;
  const vstream = (info?.streams ?? []).find((s) => s.codec_type === "video");
  const astream = (info?.streams ?? []).find((s) => s.codec_type === "audio");
  const sizeMb = (await stat(mp4)).size / 1024 / 1024;
  log(`mp4 产物：${sizeMb.toFixed(1)}MB duration=${fmtSec(Number(fmt?.duration ?? 0))} 视频=${vstream?.codec_name}(${vstream?.profile}) ${vstream?.width}x${vstream?.height} 音频=${astream?.codec_name} faststart=+movflags`);
  console.log(`[POC-RESULT] ${tag} bvid=${bvid} codecid=${chosen.codecid} codec=${chosen.codec} quality_id=${chosen.id} accept=${JSON.stringify(accept)} download_mb=${(v.mb + a.mb).toFixed(1)} mux_sec=${((Date.now() - muxStart) / 1000).toFixed(1)} out_mb=${sizeMb.toFixed(1)} out_duration=${fmt?.duration} out_video=${vstream?.codec_name} out_size=${vstream?.width}x${vstream?.height} out_audio=${astream?.codec_name}`);
  return { mp4, kind: "copy" };
}

async function serveDir(serveRoot, port) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const file = resolve(serveRoot, "." + rel);
      if (!file.startsWith(resolve(serveRoot)) ) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const data = await stat(file).catch(() => null);
      if (!data || !data.isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      const type =
        extname(file) === ".html" ? "text/html; charset=utf-8"
        : extname(file) === ".mp4" ? "video/mp4"
        : extname(file) === ".m4s" ? "video/mp4" : "application/octet-stream";
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m?.[1] ? Number(m[1]) : 0;
        const end = m?.[2] ? Number(m[2]) : data.size - 1;
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${data.size}`,
          "Accept-Ranges": "bytes",
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { "Content-Type": type, "Content-Length": data.size, "Accept-Ranges": "bytes" });
      createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  log(`Range 服务器已启动 http://127.0.0.1:${port}/（Ctrl+C 退出）`);
}

// main
const opt = argsOf();
if (opt.serve) {
  const root = opt.out ? resolve(opt.out) : process.cwd();
  await serveDir(root, opt.port);
} else {
  const cookie = readCookieFromDb();
  if (cookie) log("本地 Cookie：已登录（账号见 bili_cookies，不打印本体）");
  const target = opt.bvid
    ? { bvid: opt.bvid, title: "指定视频", duration: 0 }
    : await pickVideo();
  const outRoot = opt.out ? resolve(opt.out) : join(tmpdir(), "scribe-video-poc");
  await mkdir(outRoot, { recursive: true });
  const results = [];
  for (const mode of opt.modes) {
    const useCookie = mode === "login" ? cookie : "";
    if (mode === "login" && !cookie) {
      log("跳过 login：本地无 Cookie");
      continue;
    }
    try {
      const r = await runMode(mode, useCookie, target, outRoot);
      results.push({ mode, ...r });
    } catch (err) {
      log(`模式 ${mode} 失败：`, err instanceof Error ? err.message : err);
    }
  }
  const mp4Rel = results.find((r) => r.mp4)?.mp4;
  const playerHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>POC player</title>
<style>body{margin:0;background:#111;display:grid;place-items:center;min-height:100vh}video{max-width:960px;width:100%}</style>
<video id="v" controls preload="metadata" playsinline src="${mp4Rel ? mp4Rel.split(/[\\/]/).slice(-2).join("/") : ""}"></video>
<script>
const v=document.getElementById('v');
window.__poc = {
  report: async () => ({
    readyState: v.readyState, duration: v.duration, currentTime: v.currentTime,
    seekable: Array.from(v.seekable).map(r=>[r.start,r.end]), buffered: Array.from(v.buffered).map(r=>[r.start,r.end]),
    networkState: v.networkState, paused: v.paused, videoWidth: v.videoWidth, videoHeight: v.videoHeight
  }),
  seekTo: async (t) => { v.currentTime = t; await new Promise((ok)=>v.addEventListener('seeked',ok,{once:true})); return v.currentTime; }
};
</script>`;
  await writeFile(join(outRoot, "player.html"), playerHtml);
  log(`player.html 已生成：${join(outRoot, "player.html")}`);
  log(`P0 输出目录：${outRoot}`);
}
