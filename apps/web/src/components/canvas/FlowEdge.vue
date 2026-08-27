<script setup lang="ts">
import { computed } from "vue";
import { BaseEdge, getBezierPath, Position, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const edgePath = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition as Position,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition as Position,
    curvature: 0.28,
  }),
);

const path = computed(() => String(edgePath.value[0]));
const labelX = computed(() => Number(edgePath.value[1]));
const labelY = computed(() => Number(edgePath.value[2]));
</script>

<template>
  <BaseEdge
    :id="props.id"
    :path="path"
    :label-x="labelX"
    :label-y="labelY"
    :style="{
      stroke: props.selected ? 'var(--edge-selected-color)' : 'var(--edge-color)',
      strokeWidth: 1.5,
    }"
    :interaction-width="20"
  />
</template>
