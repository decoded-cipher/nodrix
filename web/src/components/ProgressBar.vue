<script setup lang="ts">
import { computed } from 'vue';
import { progress } from '../lib/progress';

const width = computed(() => `${progress.value.value}%`);
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 transition-opacity duration-300"
    :class="progress.active.value ? 'opacity-100' : 'opacity-0'"
    aria-hidden="true"
  >
    <div
      class="h-full bg-orange-600 shadow-[0_0_10px_rgba(234,88,12,0.5)] transition-[width] duration-200 ease-out"
      :style="{ width }"
    />
  </div>
</template>
