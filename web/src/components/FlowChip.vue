<script setup lang="ts">
// One node in a rule-flow rail: a trigger or an action, shown as an icon + label
// pill. Tone tints triggers with the accent color and actions in neutral.
import Icon from './Icon.vue';

defineProps<{
  label: string;
  icon?: string;
  tone?: 'trigger' | 'action';
  title?: string;
}>();
</script>

<template>
  <span
    class="inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
    :class="tone === 'trigger'
      ? 'border-accent-200 bg-accent-50 text-accent-800 dark:border-accent-900/50 dark:bg-accent-900/20 dark:text-accent-200'
      : 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200'"
    :title="title ?? label"
  >
    <Icon
      v-if="icon"
      :path="icon"
      class="h-3.5 w-3.5 shrink-0"
      :class="tone === 'trigger' ? 'text-accent-600 dark:text-accent-400' : 'text-neutral-400 dark:text-neutral-500'"
    />
    <span class="truncate">{{ label }}</span>
  </span>
</template>
