<script setup lang="ts">
import { RouterView } from "vue-router";
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import AppLayout from "@/layouts/AppLayout.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
import ToastStack from "@/components/ToastStack.vue";
</script>

<template>
  <el-config-provider :locale="zhCn">
    <AppLayout>
      <!-- 按路径做 key：切换工程 / 进入运行详情都重建主视图，保证数据重载 -->
      <RouterView :key="$route.path" />
    </AppLayout>
    <SettingsDialog />
    <ToastStack />
  </el-config-provider>
</template>
