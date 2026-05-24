<script setup lang="ts">
import { toastState, type ToastKind } from '../lib/toast';

const toasts = toastState();

// Muted by design: accent for success/info, red for errors. No green.
const tone: Record<ToastKind, { icon: string; bar: string }> = {
  success: { icon: 'text-accent-600 dark:text-accent-400', bar: 'bg-accent-500' },
  info: { icon: 'text-accent-600 dark:text-accent-400', bar: 'bg-accent-500' },
  error: { icon: 'text-red-600 dark:text-red-400', bar: 'bg-red-500' },
};
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-xs flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        role="status"
      >
        <div class="flex items-center gap-2.5 px-3 py-2.5">
          <svg
            class="h-4 w-4 shrink-0"
            :class="tone[t.kind].icon"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="t.kind === 'success'"><path d="M20 6 9 17l-5-5" /></template>
            <template v-else-if="t.kind === 'error'"><path d="M18 6 6 18M6 6l12 12" /></template>
            <template v-else><path d="M12 8h.01M12 11v5" /></template>
          </svg>
          <p class="min-w-0 flex-1 text-sm text-neutral-700 dark:text-neutral-200">{{ t.message }}</p>
        </div>

        <!-- Duration progress bar: flush with the bottom edge. -->
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

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(0.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .toast-bar { animation: none; }
  .toast-enter-from,
  .toast-leave-to { transform: none; }
}
</style>
