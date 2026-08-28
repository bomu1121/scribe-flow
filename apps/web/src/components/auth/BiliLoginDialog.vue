<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElDialog, ElMessage } from "element-plus";
import { RefreshCw } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; "logged-in": [] }>();

const store = useAuthStore();

const dialogVisible = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const phase = ref<"loading" | "waiting" | "scanned" | "expired" | "error">("loading");
const qrImage = ref("");
const qrId = ref("");
const errorMessage = ref("");
const secondsLeft = ref(0);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function clearTimers() {
  if (pollTimer) clearInterval(pollTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  pollTimer = null;
  countdownTimer = null;
}

async function startQr() {
  clearTimers();
  phase.value = "loading";
  errorMessage.value = "";
  qrImage.value = "";
  qrId.value = "";

  try {
    const result = await store.startQr();
    qrId.value = result.qrId;
    qrImage.value = result.image;
    secondsLeft.value = result.expiresIn;
    phase.value = "waiting";

    pollTimer = setInterval(() => void poll(), 2000);
    countdownTimer = setInterval(() => {
      secondsLeft.value = Math.max(0, secondsLeft.value - 1);
      if (secondsLeft.value <= 0) {
        clearTimers();
        phase.value = "expired";
      }
    }, 1000);
  } catch (err) {
    phase.value = "error";
    errorMessage.value = err instanceof Error ? err.message : "生成二维码失败";
  }
}

async function poll() {
  if (!qrId.value) return;
  try {
    const result = await store.pollQr(qrId.value);
    if (result.status === "success" && "user" in result) {
      clearTimers();
      store.setLoggedIn(result.user);
      phase.value = "waiting";
      ElMessage.success(`已登录：${result.user.uname}`);
      window.setTimeout(() => {
        dialogVisible.value = false;
        emit("logged-in");
      }, 500);
      return;
    }
    if (result.status === "scanned") phase.value = "scanned";
    if (result.status === "expired") {
      clearTimers();
      phase.value = "expired";
    }
  } catch (err) {
    clearTimers();
    phase.value = "error";
    errorMessage.value = err instanceof Error ? err.message : "登录状态查询失败";
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void startQr();
    else clearTimers();
  },
);

onBeforeUnmount(clearTimers);
</script>

<template>
  <el-dialog v-model="dialogVisible" title="登录 B 站" width="400px" :close-on-click-modal="false" align-center>
    <div class="sf-qr-box">
      <template v-if="phase === 'loading'">
        <div class="sf-qr-loading">正在生成二维码…</div>
      </template>
      <template v-else-if="phase === 'error'">
        <div class="sf-qr-message sf-qr-message--error">{{ errorMessage || "登录失败" }}</div>
        <el-button class="sf-btn" plain @click="startQr"><RefreshCw :size="14" /><span>重新生成</span></el-button>
      </template>
      <template v-else>
        <img :src="qrImage" alt="B 站登录二维码" class="sf-qr-img" />
        <div class="sf-qr-hint">
          <template v-if="phase === 'waiting'">使用 B 站手机客户端扫码登录</template>
          <template v-else-if="phase === 'scanned'">已扫码，请在手机上确认登录</template>
          <template v-else>二维码已过期</template>
        </div>
        <div v-if="phase !== 'expired'" class="sf-qr-count tnum">{{ secondsLeft }} 秒后过期</div>
        <el-button v-else class="sf-btn" plain @click="startQr"><RefreshCw :size="14" /><span>刷新二维码</span></el-button>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.sf-qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0 4px;
}

.sf-qr-img {
  width: 200px;
  height: 200px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-qr-loading {
  padding: 48px 0;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.sf-qr-message {
  padding: 24px 0 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sf-qr-message--error {
  color: var(--color-error);
}

.sf-qr-hint {
  font-size: 13px;
  color: var(--color-text);
}

.sf-qr-count {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-btn {
  gap: 6px;
}
</style>
