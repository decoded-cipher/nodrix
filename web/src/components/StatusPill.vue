<script setup lang="ts">
import { computed } from 'vue';
import { relativeTime } from '../lib/time';

const props = defineProps<{
  status: 'ok' | 'error' | 'skipped' | null;
  at?: number | null;
  // Label shown when status is null (never run / never delivered).
  neverLabel?: string;
}>();

type Tone = { dot: string; text: string; label: string };

const tone = computed<Tone>(() => {
  switch (props.status) {
    case 'ok':
      return { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'OK' };
    case 'error':
      return { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: 'Error' };
    case 'skipped':
      return { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'Skipped' };
    default:
      return { dot: 'bg-neutral-300 dark:bg-neutral-600', text: 'text-neutral-500 dark:text-neutral-400', label: props.neverLabel ?? 'Never run' };
  }
});

const when = computed(() => relativeTime(props.at));
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs" :class="tone.text">
    <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="tone.dot" />
    <span>{{ tone.label }}</span>
    <span v-if="status && when" class="text-neutral-400 dark:text-neutral-500">· {{ when }}</span>
  </span>
</template>
