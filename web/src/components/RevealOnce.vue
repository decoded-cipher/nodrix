<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ value: string; label?: string }>();

const copied = ref(false);

async function copy(v: string) {
  await navigator.clipboard.writeText(v);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-900/20">
    <div class="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
      {{ label ?? 'Save this now' }}
    </div>
    <div class="mt-2 flex items-center gap-2">
      <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs dark:bg-neutral-900 dark:text-neutral-100">{{ value }}</code>
      <button
        type="button"
        class="rounded-md border border-amber-400 bg-white px-3 py-2 text-xs hover:bg-amber-100 dark:border-amber-700 dark:bg-neutral-900 dark:hover:bg-amber-900/30"
        @click="copy(value)"
      >{{ copied ? 'Copied' : 'Copy' }}</button>
    </div>
    <p class="mt-2 text-xs text-amber-800 dark:text-amber-300">This value is shown once. Store it somewhere safe.</p>
  </div>
</template>
