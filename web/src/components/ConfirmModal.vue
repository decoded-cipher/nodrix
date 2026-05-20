<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { confirmState, resolveConfirm } from '../lib/confirm';

const state = confirmState();

const opts = computed(() => state.value.opts);
const danger = computed(() => opts.value?.danger !== false);

function onKey(e: KeyboardEvent) {
  if (!state.value.open) return;
  if (e.key === 'Escape') resolveConfirm(false);
  if (e.key === 'Enter') resolveConfirm(true);
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div
        v-if="state.open && opts"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-900/50 px-4 dark:bg-black/70"
        role="dialog"
        aria-modal="true"
        @click.self="resolveConfirm(false)"
      >
        <div class="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
          <div class="flex items-start gap-3 px-5 py-4">
            <!-- Danger icon -->
            <div
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              :class="danger ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'"
            >
              <svg
                v-if="danger"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                class="h-5 w-5"
              >
                <path d="M12 9v3.75M12 16.5h.008v.008H12v-.008zM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                class="h-5 w-5"
              >
                <path d="M12 9v3.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>

            <div class="min-w-0 flex-1">
              <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ opts.title }}</h2>
              <p v-if="opts.message" class="mt-1 whitespace-pre-line text-xs text-neutral-600 dark:text-neutral-400">
                {{ opts.message }}
              </p>
              <ul
                v-if="opts.details && opts.details.length"
                class="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300"
              >
                <li v-for="(d, i) in opts.details" :key="i" class="flex gap-2">
                  <span class="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-neutral-400 dark:bg-neutral-500" />
                  <span>{{ d }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
            <button
              type="button"
              class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
              @click="resolveConfirm(false)"
            >{{ opts.cancelLabel ?? 'Cancel' }}</button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
              :class="danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent-600 hover:bg-accent-700'"
              @click="resolveConfirm(true)"
            >{{ opts.confirmLabel ?? 'Delete' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-fade-enter-active, .confirm-fade-leave-active { transition: opacity .12s ease; }
.confirm-fade-enter-from, .confirm-fade-leave-to { opacity: 0; }
</style>
