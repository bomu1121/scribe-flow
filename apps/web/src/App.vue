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
      <!-- 按路由名做 key：切换不同页面才重建；同一工程编辑页内切换工程时复用视图，避免顶部栏/浮层/Controls 闪动 -->
      <RouterView :key="$route.name" />
    </AppLayout>
    <SettingsDialog />
    <ToastStack />
  </el-config-provider>
</template>
