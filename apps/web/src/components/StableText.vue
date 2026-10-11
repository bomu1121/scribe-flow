<script setup lang="ts">
/**
 * 宽度固定的文本：显示 `active ? busy : idle`，但盒子宽度按两者中**较长**的那个预留。
 *
 * 为什么需要：`.sf-btn` 没有固定宽度，宽度由文字决定。按钮从「检查」切到「检查中…」时，
 * 同排 `width:100%` 的输入框会被挤窄——实测按钮 50.33px→70.51px，换来输入框
 * 383.67px→363.49px 的横向抽动，一次点击抖两次。把两段文字叠在同一格、让隐藏的那个撑住宽度，
 * 是标准做法，也免得给每个按钮各编一个魔法 min-width（漏一个就再抖一次）。
 */
import { computed } from "vue";

const props = withDefaults(defineProps<{ idle: string; busy?: string; active?: boolean }>(), {
  busy: "",
  active: false,
});

const shown = computed(() => (props.active && props.busy ? props.busy : props.idle));
const reserve = computed(() => (props.busy.length > props.idle.length ? props.busy : props.idle));
</script>

<template>
  <span class="sf-stable-text">
    <span>{{ shown }}</span>
    <span class="sf-stable-text__reserve" aria-hidden="true">{{ reserve }}</span>
  </span>
</template>

<style scoped>
.sf-stable-text {
  display: inline-grid;
  justify-items: center;
}

.sf-stable-text > * {
  grid-area: 1 / 1;
  white-space: nowrap;
}

.sf-stable-text__reserve {
  visibility: hidden;
}
</style>
