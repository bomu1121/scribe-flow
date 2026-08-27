<script setup lang="ts">
import { TabsContent } from "reka-ui";

defineProps<{ value: string }>();
</script>

<template>
  <TabsContent :value="value" class="sf-tabs-content">
    <slot />
  </TabsContent>
</template>

<style scoped>
.sf-tabs-content {
  padding-top: 14px;
}
</style>
