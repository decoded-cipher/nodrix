<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    label?: string;
    block?: boolean;
  }>(),
  { size: 'md' }
);
</script>

<template>
  <div
    :class="[
      block ? 'flex w-full flex-col items-center justify-center gap-2 py-6' : 'inline-flex items-center gap-2',
      'text-neutral-500',
    ]"
    role="status"
    aria-live="polite"
  >
    <svg
      class="animate-spin"
      :class="size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.2" stroke-width="3" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
    <span v-if="label" class="text-sm">{{ label }}</span>
    <span v-else class="sr-only">Loading</span>
  </div>
</template>
