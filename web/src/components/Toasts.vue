<script setup lang="ts">
import { toastState, type ToastKind } from '../lib/toast';

const toasts = toastState();

// Per-kind accent: left border + icon color + progress-bar color.
const tone: Record<ToastKind, { accent: string; bar: string; icon: string }> = {
  success: {
    accent: 'border-l-emerald-500',
    bar: 'bg-emerald-500',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    accent: 'border-l-red-500',
    bar: 'bg-red-500',
    icon: 'text-red-600 dark:text-red-400',
  },
  info: {
    accent: 'border-l-accent-500',
    bar: 'bg-accent-500',
    icon: 'text-accent-600 dark:text-accent-400',
  },
};
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-xs flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto overflow-hidden rounded-lg border border-l-4 border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        :class="tone[t.kind].accent"
        role="status"
      >
        <div class="flex items-start gap-2.5 px-3 py-2.5">
          <!-- Icon -->
          <svg
            class="mt-0.5 h-4 w-4 shrink-0"
            :class="tone[t.kind].icon"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="t.kind === 'success'"><path d="M20 6 9 17l-5-5" /></template>
            <template v-else-if="t.kind === 'error'"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></template>
            <template v-else><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></template>
          </svg>

          <p class="min-w-0 flex-1 text-sm text-neutral-800 dark:text-neutral-100">{{ t.message }}</p>
        </div>

        <!-- Duration progress bar: shrinks left→right over the toast's TTL. -->
        <div v-if="t.ttl > 0" class="h-0.5 w-full bg-neutral-100 dark:bg-neutral-800">
          <div
            class="toast-bar h-full origin-left"
            :class="tone[t.kind].bar"
            :style="{ animationDuration: t.ttl + 'ms' }"
          />
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
@keyframes toast-shrink {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
.toast-bar {
  animation: toast-shrink linear forwards;
}

/* Enter/leave: slide in from the right, fade + collapse out. */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(1rem);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}

@media (prefers-reduced-motion: reduce) {
  .toast-bar { animation: none; }
  .toast-enter-active,
  .toast-leave-active { transition: opacity 0.2s ease; }
  .toast-enter-from,
  .toast-leave-to { transform: none; }
}
</style>
