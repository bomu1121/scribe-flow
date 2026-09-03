<script setup lang="ts">
import { RouterView } from "vue-router";
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import AppLayout from "@/layouts/AppLayout.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
</script>

<template>
  <el-config-provider :locale="zhCn">
    <AppLayout>
      <RouterView />
    </AppLayout>
    <SettingsDialog />
  </el-config-provider>
</template>
