<script setup lang="ts">
/**
 * 可播放视频（MP4/H.264）轻量播放器：原生 <video> + 自研控件层。
 * 设计（docs/video-module-research.md §2.4 的样式细化）：
 * - 内嵌态与结果页“纸面”一体：浅色控件条在画面下方，舞台黑只包住视频本身；
 *   舞台按真实宽高比自适应（超高/超宽受 max-height 夹持时才出现信箱黑边）。
 * - 全屏态才切换到暗色悬浮控件（常见播放器惯例）。
 * - 选中/进度一律中性墨色（不使用品牌蓝）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Volume2, VolumeX } from "lucide-vue-next";

const props = defineProps<{
  streamUrl: string;
  title?: string;
  poster?: string;
  /** 服务端已知时长（秒），durationchange 前先展示，避免 0:00。 */
  durationSec?: number;
}>();

const emit = defineEmits<{
  play: [];
  pause: [];
  ended: [];
  /** 播放层失败（网络/解码/404），message 供上层提示。 */
  failed: [message: string];
}>();

const rootRef = ref<HTMLElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);

const playing = ref(false);
const waiting = ref(false);
const ended = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(1);
const muted = ref(false);
const rate = ref(1);
const bufferedEnd = ref(0);
const error = ref("");
const showControls = ref(true);
const fullscreen = ref(false);
/** 视频真实宽高比（如 "16 / 9"）；未知时用 16:9 骨架。 */
const videoRatio = ref("16 / 9");

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const shownDuration = computed(() => duration.value || props.durationSec || 0);
const progressRatio = computed(() => {
  const d = shownDuration.value;
  return d > 0 ? Math.min(1, Math.max(0, currentTime.value / d)) : 0;
});
const bufferRatio = computed(() => {
  const d = shownDuration.value;
  return d > 0 ? Math.min(1, bufferedEnd.value / d) : 0;
});
const canPiP = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function armHide() {
  if (hideTimer) clearTimeout(hideTimer);
  // 只有全屏悬浮态需要自动隐藏；内嵌浅色条常驻
  if (fullscreen.value && playing.value && !error.value) {
    hideTimer = setTimeout(() => {
      showControls.value = false;
    }, 2600);
  } else {
    showControls.value = true;
  }
}

function wakeControls() {
  showControls.value = true;
  armHide();
}

function onStageHover() {
  if (hoverTimer) clearTimeout(hoverTimer);
  wakeControls();
  hoverTimer = setTimeout(() => armHide(), 600);
}

function togglePlay() {
  const v = videoRef.value;
  if (!v) return;
  if (v.paused) void v.play();
  else v.pause();
}

function seekTo(sec: number) {
  const v = videoRef.value;
  if (!v) return;
  const d = shownDuration.value;
  const next = Math.min(Math.max(0, sec), d > 0 ? d : sec);
  v.currentTime = next;
  currentTime.value = next;
}

function seekRatio(ratio: number) {
  seekTo(shownDuration.value * Math.min(1, Math.max(0, ratio)));
}

function changeVolume(next: number) {
  const v = videoRef.value;
  volume.value = Math.min(1, Math.max(0, next));
  if (v) v.volume = volume.value;
  if (volume.value > 0 && muted.value) {
    muted.value = false;
    if (v) v.muted = false;
  }
}

function cycleRate() {
  const idx = RATES.indexOf(rate.value);
  const next = RATES[(idx + 1) % RATES.length];
  rate.value = next;
  if (videoRef.value) videoRef.value.playbackRate = next;
}

async function toggleFullscreen() {
  const el = rootRef.value;
  if (!el) return;
  try {
    if (!document.fullscreenElement) await el.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    // 浏览器拒绝（如 iframe 权限）时静默
  }
}

async function togglePiP() {
  const v = videoRef.value;
  if (!v || !canPiP) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
  } catch {
    // 忽略：环境不支持时按钮仍可点但无副作用
  }
}

function onKeydown(event: KeyboardEvent) {
  if (error.value) return;
  const key = event.key.toLowerCase();
  if (key === " " || key === "k") {
    event.preventDefault();
    togglePlay();
  } else if (key === "arrowright") {
    event.preventDefault();
    seekTo(currentTime.value + (event.shiftKey ? 10 : 5));
  } else if (key === "arrowleft") {
    event.preventDefault();
    seekTo(currentTime.value - (event.shiftKey ? 10 : 5));
  } else if (key === "arrowup") {
    event.preventDefault();
    changeVolume(volume.value + 0.1);
  } else if (key === "arrowdown") {
    event.preventDefault();
    changeVolume(volume.value - 0.1);
  } else if (key === "m") {
    event.preventDefault();
    muted.value = !muted.value;
    if (videoRef.value) videoRef.value.muted = muted.value;
  } else if (key === "f") {
    event.preventDefault();
    void toggleFullscreen();
  } else if (key === "[") {
    event.preventDefault();
    const idx = RATES.indexOf(rate.value);
    rate.value = RATES[Math.max(0, idx - 1)];
    if (videoRef.value) videoRef.value.playbackRate = rate.value;
  } else if (key === "]") {
    event.preventDefault();
    cycleRate();
  }
}

// ---------- 进度条拖动 ----------
const trackRef = ref<HTMLElement | null>(null);
let dragging = false;

function ratioFromEvent(event: PointerEvent): number {
  const track = trackRef.value;
  if (!track) return 0;
  const rect = track.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

function onTrackPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  seekRatio(ratioFromEvent(event));
  wakeControls();
}

function onTrackPointerMove(event: PointerEvent) {
  if (!dragging) return;
  seekRatio(ratioFromEvent(event));
}

function onTrackPointerUp(event: PointerEvent) {
  if (!dragging) return;
  dragging = false;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  armHide();
}

// ---------- video 事件 ----------
function onPlay() {
  playing.value = true;
  ended.value = false;
  emit("play");
  armHide();
}
function onPause() {
  playing.value = false;
  showControls.value = true;
  emit("pause");
}
function onWaiting() {
  waiting.value = true;
  showControls.value = true;
}
function onCanPlay() {
  waiting.value = false;
}
function onTimeUpdate() {
  const v = videoRef.value;
  if (!v) return;
  currentTime.value = v.currentTime;
}
function onDurationChange() {
  const v = videoRef.value;
  if (v && Number.isFinite(v.duration) && v.duration > 0) duration.value = v.duration;
}
function onLoadedMetadata() {
  const v = videoRef.value;
  if (!v) return;
  if (v.videoWidth > 0 && v.videoHeight > 0) {
    videoRatio.value = `${v.videoWidth} / ${v.videoHeight}`;
  }
  if (Number.isFinite(v.duration) && v.duration > 0) duration.value = v.duration;
}
function onProgress() {
  const v = videoRef.value;
  if (!v) return;
  try {
    const len = v.buffered.length;
    bufferedEnd.value = len > 0 ? v.buffered.end(len - 1) : 0;
  } catch {
    bufferedEnd.value = 0;
  }
}
function onEnded() {
  playing.value = false;
  ended.value = true;
  emit("ended");
}
function onVolumeChange() {
  const v = videoRef.value;
  if (!v) return;
  volume.value = v.volume;
  muted.value = v.muted;
}
function onVideoError() {
  const v = videoRef.value;
  const code = v?.error?.code;
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    error.value = "视频格式无法在此浏览器播放";
  } else if (code === MediaError.MEDIA_ERR_NETWORK) {
    error.value = "网络中断或媒体文件不存在";
  } else {
    error.value = "视频加载失败";
  }
  playing.value = false;
  waiting.value = false;
  emit("failed", error.value);
}

function retry() {
  error.value = "";
  const v = videoRef.value;
  if (!v) return;
  v.load();
}

function onFullscreenChange() {
  fullscreen.value = Boolean(document.fullscreenElement);
  if (!fullscreen.value) wakeControls();
}

onMounted(() => {
  document.addEventListener("fullscreenchange", onFullscreenChange);
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  if (hideTimer) clearTimeout(hideTimer);
  if (hoverTimer) clearTimeout(hoverTimer);
});

defineExpose({ togglePlay, seekTo, currentTime: () => currentTime.value, video: () => videoRef.value });
</script>

<template>
  <div
    ref="rootRef"
    class="mp-root"
    :class="{ 'is-fullscreen': fullscreen }"
    tabindex="0"
    role="group"
    :aria-label="title ?? '视频播放器'"
    @keydown="onKeydown"
    @mouseenter="wakeControls"
    @mousemove="onStageHover"
    @mouseleave="armHide"
  >
    <div class="mp-stage" :style="{ aspectRatio: videoRatio }">
      <video
        ref="videoRef"
        class="mp-video"
        :src="streamUrl"
        :poster="poster"
        referrerpolicy="no-referrer"
        playsinline
        preload="metadata"
        @click="togglePlay"
        @dblclick="toggleFullscreen"
        @play="onPlay"
        @pause="onPause"
        @waiting="onWaiting"
        @canplay="onCanPlay"
        @timeupdate="onTimeUpdate"
        @durationchange="onDurationChange"
        @loadedmetadata="onLoadedMetadata"
        @progress="onProgress"
        @ended="onEnded"
        @volumechange="onVolumeChange"
        @error="onVideoError"
      />

      <div v-if="waiting && !error" class="mp-spinner" aria-hidden="true">
        <Loader2 :size="26" class="mp-spinner-icon" />
      </div>

      <button v-if="!playing && !waiting && !error && !ended" type="button" class="mp-center-play" :aria-label="'播放' + (title ?? '')" @click.stop="togglePlay">
        <Play :size="26" fill="currentColor" />
      </button>
      <button v-else-if="!playing && !waiting && !error && ended" type="button" class="mp-center-play" :aria-label="'重新播放' + (title ?? '')" @click.stop="seekTo(0); togglePlay()">
        <RotateCcw :size="22" />
      </button>

      <div v-if="error" class="mp-error" role="alert">
        <p class="mp-error-text">{{ error }}</p>
        <button type="button" class="mp-error-retry" @click="retry"><RotateCcw :size="13" />重试</button>
      </div>
    </div>

    <div v-if="!error" class="mp-controls" :class="{ 'is-hidden': !showControls }" @pointerdown.stop>
      <div
        ref="trackRef"
        class="mp-track"
        role="slider"
        tabindex="0"
        aria-label="播放进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(progressRatio * 100)"
        :aria-valuetext="`${fmt(currentTime)} / ${fmt(shownDuration)}`"
        @pointerdown="onTrackPointerDown"
        @pointermove="onTrackPointerMove"
        @pointerup="onTrackPointerUp"
        @pointercancel="onTrackPointerUp"
        @keydown.arrow-left.prevent="seekTo(currentTime - 5)"
        @keydown.arrow-right.prevent="seekTo(currentTime + 5)"
      >
        <div class="mp-track-base" />
        <div class="mp-track-buffer" :style="{ width: `${bufferRatio * 100}%` }" />
        <div class="mp-track-played" :style="{ width: `${progressRatio * 100}%` }" />
        <span class="mp-track-thumb" :style="{ left: `${progressRatio * 100}%` }" />
      </div>

      <div class="mp-bar">
        <button type="button" class="mp-btn" :aria-label="playing ? '暂停' : '播放'" :title="playing ? '暂停' : '播放'" @click="togglePlay">
          <Pause v-if="playing" :size="16" />
          <Play v-else :size="16" fill="currentColor" />
        </button>
        <button type="button" class="mp-btn" :aria-label="muted ? '取消静音' : '静音'" :title="muted ? '取消静音' : '静音'" @click="muted = !muted; if (videoRef) videoRef.muted = muted">
          <VolumeX v-if="muted || volume === 0" :size="16" />
          <Volume2 v-else :size="16" />
        </button>
        <input
          class="mp-volume"
          type="range"
          min="0"
          max="100"
          step="5"
          :value="muted ? 0 : Math.round(volume * 100)"
          aria-label="音量"
          @input="changeVolume(Number(($event.target as HTMLInputElement).value) / 100)"
        />
        <span class="mp-time tnum">{{ fmt(currentTime) }} / {{ fmt(shownDuration) }}</span>
        <span class="mp-spacer" />
        <button type="button" class="mp-btn mp-btn--rate" :title="`倍速 ${rate}x`" :aria-label="`倍速 ${rate}x`" @click="cycleRate">{{ rate }}x</button>
        <button v-if="canPiP" type="button" class="mp-btn" aria-label="画中画" title="画中画" @click="togglePiP">
          <PictureInPicture2 :size="16" />
        </button>
        <button type="button" class="mp-btn" :aria-label="fullscreen ? '退出全屏' : '全屏'" :title="fullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen">
          <Minimize v-if="fullscreen" :size="16" />
          <Maximize v-else :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 内嵌态（默认）：纸面一体，浅色控件条常驻画面下方 */
.mp-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  outline: none;
  user-select: none;
  color: var(--color-text);
}

.mp-root:focus-visible {
  border-color: var(--color-border-strong);
  box-shadow: 0 0 0 3px var(--color-ink-soft);
}

.mp-stage {
  position: relative;
  width: 100%;
  max-height: 70vh;
  background: var(--color-ink);
  overflow: hidden;
}

.mp-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--color-ink);
  cursor: pointer;
}

.mp-spinner {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: color-mix(in srgb, var(--color-ink) 30%, transparent);
}

.mp-spinner-icon {
  color: var(--color-on-scrim);
  opacity: 0.9;
  animation: mp-spin 0.9s linear infinite;
}

@keyframes mp-spin {
  to {
    transform: rotate(360deg);
  }
}

.mp-center-play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-ink) 52%, transparent);
  color: var(--color-on-scrim);
  cursor: pointer;
  transform: translate(-50%, -50%);
  transition: background-color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}

.mp-center-play:hover {
  background: color-mix(in srgb, var(--color-ink) 72%, transparent);
}

.mp-center-play:active {
  transform: translate(-50%, -50%) scale(0.95);
}

.mp-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  text-align: center;
  background: var(--color-ink);
}

.mp-error-text {
  margin: 0;
  color: var(--color-on-scrim);
  font-size: 13px;
}

.mp-error-retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-on-scrim) 20%, transparent);
  color: var(--color-on-scrim);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.mp-error-retry:hover {
  background: color-mix(in srgb, var(--color-on-scrim) 30%, transparent);
}

/* 浅色控件条（内嵌态常驻）：进度条横贯整条，按钮行带 10px 内边距 */
.mp-controls {
  flex-shrink: 0;
  padding: 0;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  transition: opacity var(--dur-2) var(--ease-out);
}

.mp-controls.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.mp-track {
  position: relative;
  margin: 0;
  height: 18px;
  cursor: pointer;
  touch-action: none;
  outline: none;
}

.mp-track:focus-visible .mp-track-played {
  outline: 2px solid var(--color-text);
  outline-offset: 2px;
}

.mp-track-base,
.mp-track-buffer,
.mp-track-played {
  position: absolute;
  top: 8px;
  height: 4px;
  border-radius: 999px;
  pointer-events: none;
}

.mp-track-base {
  left: 0;
  width: 100%;
  background: var(--color-ink-soft);
}

.mp-track-buffer {
  left: 0;
  background: color-mix(in srgb, var(--color-text) 18%, transparent);
}

.mp-track-played {
  left: 0;
  background: var(--color-text);
}

.mp-track-thumb {
  position: absolute;
  top: 5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-surface);
  border: 2px solid var(--color-text);
  transform: translateX(-50%);
  box-sizing: border-box;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-1) var(--ease-out);
}

.mp-track:hover .mp-track-thumb,
.mp-track:focus-visible .mp-track-thumb,
.mp-track.is-dragging .mp-track-thumb {
  opacity: 1;
}

.mp-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 4px 10px 6px;
}

.mp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}

.mp-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.mp-btn--rate {
  width: auto;
  padding: 0 8px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.mp-volume {
  width: 56px;
  height: 14px;
  accent-color: var(--color-text);
  cursor: pointer;
}

.mp-time {
  margin-left: 2px;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mp-spacer {
  flex: 1;
}

/* 全屏态：暗色画布 + 悬浮暗色控件（自动隐藏） */
.mp-root:fullscreen {
  width: 100vw;
  height: 100vh;
  border: none;
  border-radius: 0;
  background: var(--color-ink);
}

.mp-root.is-fullscreen .mp-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  aspect-ratio: auto;
}

.mp-root.is-fullscreen .mp-controls {
  position: absolute;
  inset: auto 0 0;
  padding: 26px 0 0;
  border-top: none;
  background: var(--color-scrim);
  z-index: var(--z-rail);
}

.mp-root.is-fullscreen .mp-btn {
  color: var(--color-on-scrim);
}

.mp-root.is-fullscreen .mp-btn:hover {
  background: color-mix(in srgb, var(--color-on-scrim) 18%, transparent);
  color: var(--color-on-scrim);
}

.mp-root.is-fullscreen .mp-track-base {
  background: color-mix(in srgb, var(--color-on-scrim) 24%, transparent);
}

.mp-root.is-fullscreen .mp-track-buffer {
  background: color-mix(in srgb, var(--color-on-scrim) 38%, transparent);
}

.mp-root.is-fullscreen .mp-track-played {
  background: var(--color-on-scrim);
}

.mp-root.is-fullscreen .mp-track-thumb {
  background: var(--color-on-scrim);
  border-color: var(--color-on-scrim);
}

.mp-root.is-fullscreen .mp-time {
  color: var(--color-on-scrim);
}

.mp-root.is-fullscreen .mp-volume {
  accent-color: var(--color-on-scrim);
}
</style>
