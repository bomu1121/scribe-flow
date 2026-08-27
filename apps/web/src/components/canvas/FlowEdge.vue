<script setup lang="ts">
import { computed } from "vue";
import { BaseEdge, getBezierPath, Position, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const path = computed<string>(() =>
  (getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition as Position,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition as Position,
    curvature: 0.28,
  }) as unknown) as string,
);
</script>

<template>
  <BaseEdge
    :id="props.id"
    :path="path"
    :style="{
      stroke: props.selected ? 'var(--edge-selected-color)' : 'var(--edge-color)',
      strokeWidth: 1.5,
    }"
    :interaction-width="20"
  />
</template>
