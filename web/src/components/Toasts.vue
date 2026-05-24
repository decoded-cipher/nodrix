<script setup lang="ts">
import { toastState, type ToastKind } from '../lib/toast';

const toasts = toastState();

// Per-kind accent: filled icon chip + matching progress bar.
const tone: Record<ToastKind, { chip: string; bar: string }> = {
  success: { chip: 'bg-emerald-500', bar: 'bg-emerald-500' },
  error: { chip: 'bg-red-500', bar: 'bg-red-500' },
  info: { chip: 'bg-accent-500', bar: 'bg-accent-500' },
};
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-xs flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10"
        role="status"
      >
        <div class="flex items-center gap-3 px-3.5 py-3">
          <!-- Filled icon chip -->
          <span
            class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white"
            :class="tone[t.kind].chip"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <template v-if="t.kind === 'success'"><path d="M20 6 9 17l-5-5" /></template>
              <template v-else-if="t.kind === 'error'"><path d="M18 6 6 18M6 6l12 12" /></template>
              <template v-else><path d="M12 8h.01M12 11v5" /></template>
            </svg>
          </span>

          <p class="min-w-0 flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ t.message }}</p>
        </div>

        <!-- Duration progress bar: slim, inset, shrinks over the toast's TTL. -->
        <div v-if="t.ttl > 0" class="mx-3.5 mb-2.5 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            class="toast-bar h-full origin-left rounded-full"
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
  transition: all 0.25s cubic-bezier(0.21, 1.02, 0.73, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(1rem) scale(0.96);
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
