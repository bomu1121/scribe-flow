import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { BiliAccount } from "@scribe-flow/shared";
import { api } from "@/lib/api";

export type AuthStatus = "loading" | "loggedOut" | "loggedIn";

interface QrStartResponse {
  qrId: string;
  image: string;
  expiresIn: number;
}

type QrPollResponse =
  | { status: "waiting" | "scanned" | "expired" }
  | { status: "success"; user: BiliAccount };

export const useAuthStore = defineStore("auth", () => {
  const status = ref<AuthStatus>("loading");
  const user = ref<BiliAccount | null>(null);

  const loggedIn = computed(() => status.value === "loggedIn");

  async function refresh() {
    try {
      const data = await api.get<{ loggedIn: boolean; user?: BiliAccount }>("/api/auth/status");
      status.value = data.loggedIn && data.user ? "loggedIn" : "loggedOut";
      user.value = data.user ?? null;
    } catch {
      status.value = "loggedOut";
      user.value = null;
    }
  }

  async function startQr(): Promise<QrStartResponse> {
    return api.post<QrStartResponse>("/api/auth/qr");
  }

  async function pollQr(qrId: string): Promise<QrPollResponse> {
    return api.get<QrPollResponse>(`/api/auth/qr/${qrId}`);
  }

  function setLoggedIn(nextUser: BiliAccount) {
    user.value = nextUser;
    status.value = "loggedIn";
  }

  async function logout() {
    await api.post<{ ok: boolean }>("/api/auth/logout");
    user.value = null;
    status.value = "loggedOut";
  }

  return { status, user, loggedIn, refresh, startQr, pollQr, setLoggedIn, logout };
});
