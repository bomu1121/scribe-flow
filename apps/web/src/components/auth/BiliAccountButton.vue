<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessageBox } from "element-plus";
import { CircleUserRound, LogOut } from "lucide-vue-next";
import { toast } from "@/lib/toast";
import { useAuthStore } from "@/stores/auth";
import BiliLoginDialog from "./BiliLoginDialog.vue";

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
const store = useAuthStore();
const showLogin = ref(false);

onMounted(() => {
  void store.refresh();
});

async function logout() {
  try {
    await ElMessageBox.confirm("退出后来源节点的快捷选择将不可用，Cookie 会从服务端删除。", "退出 B 站登录", {
      confirmButtonText: "退出登录",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await store.logout();
    toast.success("已退出 B 站登录");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "退出登录失败");
  }
}
</script>

<template>
  <el-dropdown v-if="store.loggedIn && store.user" trigger="click" placement="top-end" @command="(cmd) => cmd === 'logout' && logout()">
    <button type="button" class="sf-account" :class="{ 'sf-account--compact': props.compact }" title="B 站账号">
      <img v-if="store.user.face" :src="store.user.face" class="sf-account-avatar" alt="头像" referrerpolicy="no-referrer" />
      <CircleUserRound v-else :size="16" />
      <span class="sf-account-name sf-account-label">{{ store.user.uname }}</span>
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="logout" class="sf-dropdown-danger"><LogOut :size="14" />退出登录</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>

  <button v-else type="button" class="sf-account" :class="{ 'sf-account--compact': props.compact }" title="登录 B 站（仅扫码）" @click="showLogin = true">
    <CircleUserRound :size="16" />
    <span class="sf-account-label">未登录 B 站</span>
  </button>

  <BiliLoginDialog v-model:open="showLogin" @logged-in="showLogin = false" />
</template>

<style scoped>
.sf-account {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-account--compact {
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  text-align: center;
}

.sf-account--compact .sf-account-label {
  display: none;
}

.sf-account:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.sf-account-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
}

.sf-account-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<style>
/* 下拉菜单 Teleport 到 body，样式必须全局 */
.sf-dropdown-danger {
  color: var(--color-error);
}
</style>
