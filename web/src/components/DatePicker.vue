<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

// Lightweight calendar picker. Value is an ISO 'YYYY-MM-DD' string (or '' for
// none). `min`/`max` (inclusive ISO) disable out-of-range days — used to couple
// a from/to pair. No dependencies; styled to match Dropdown.
const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  min?: string;
  max?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const buttonEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLDivElement | null>(null);

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parseISO(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1]!, m: +m[2]! - 1, d: +m[3]! } : null;
}

const today = new Date();
const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());
const selected = computed(() => parseISO(props.modelValue));

const viewYear = ref(today.getFullYear());
const viewMonth = ref(today.getMonth());

function syncView() {
  const s = selected.value;
  viewYear.value = s ? s.y : today.getFullYear();
  viewMonth.value = s ? s.m : today.getMonth();
}

const label = computed(() => {
  const s = selected.value;
  if (!s) return props.placeholder ?? 'Any date';
  return new Date(s.y, s.m, s.d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
});
const monthLabel = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
);

const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type Cell = { iso: string; day: number; inMonth: boolean; disabled: boolean };
const cells = computed<Cell[]>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const start = new Date(viewYear.value, viewMonth.value, 1 - first.getDay()); // back to Sunday
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISO(d.getFullYear(), d.getMonth(), d.getDate());
    const disabled = (!!props.min && iso < props.min) || (!!props.max && iso > props.max);
    return { iso, day: d.getDate(), inMonth: d.getMonth() === viewMonth.value, disabled };
  });
});

function toggle() { open.value ? close() : openCal(); }
function openCal() {
  syncView();
  open.value = true;
  nextTick(() => document.addEventListener('mousedown', onDoc, true));
}
function close() {
  open.value = false;
  document.removeEventListener('mousedown', onDoc, true);
}
function onDoc(e: MouseEvent) {
  const t = e.target as Node;
  if (buttonEl.value?.contains(t) || panelEl.value?.contains(t)) return;
  close();
}
function prevMonth() {
  if (viewMonth.value === 0) { viewMonth.value = 11; viewYear.value -= 1; } else viewMonth.value -= 1;
}
function nextMonth() {
  if (viewMonth.value === 11) { viewMonth.value = 0; viewYear.value += 1; } else viewMonth.value += 1;
}
function pick(c: Cell) {
  if (c.disabled) return;
  emit('update:modelValue', c.iso);
  close();
}
function clear() {
  emit('update:modelValue', '');
  close();
}

onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc, true));
</script>

<template>
  <div class="relative">
    <button
      ref="buttonEl"
      type="button"
      :class="[
        'flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-left text-xs text-neutral-900 hover:border-neutral-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:border-neutral-600',
        open ? 'border-accent-500 ring-2 ring-accent-500/30 dark:border-accent-500' : '',
      ]"
      @click="toggle"
    >
      <span :class="['flex-1 truncate', selected ? '' : 'text-neutral-400 dark:text-neutral-500']">{{ label }}</span>
      <svg class="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        ref="panelEl"
        class="absolute z-50 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div class="mb-2 flex items-center justify-between">
          <button type="button" class="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" aria-label="Previous month" @click="prevMonth">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span class="text-xs font-semibold text-neutral-800 dark:text-neutral-100">{{ monthLabel }}</span>
          <button type="button" class="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" aria-label="Next month" @click="nextMonth">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>

        <div class="grid grid-cols-7 gap-0.5 text-center">
          <span v-for="w in weekdays" :key="w" class="py-1 text-[10px] font-medium text-neutral-400 dark:text-neutral-500">{{ w }}</span>
          <button
            v-for="c in cells"
            :key="c.iso"
            type="button"
            :disabled="c.disabled"
            class="h-8 rounded text-xs transition-colors"
            :class="[
              c.iso === modelValue
                ? 'bg-accent-600 font-semibold text-white'
                : c.disabled
                  ? 'cursor-not-allowed text-neutral-300 dark:text-neutral-700'
                  : c.inMonth
                    ? 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
                    : 'text-neutral-400 hover:bg-neutral-100 dark:text-neutral-600 dark:hover:bg-neutral-800',
              c.iso === todayISO && c.iso !== modelValue ? 'ring-1 ring-inset ring-accent-400' : '',
            ]"
            @click="pick(c)"
          >{{ c.day }}</button>
        </div>

        <div v-if="modelValue" class="mt-2 flex justify-end border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <button type="button" class="text-[11px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200" @click="clear">Clear</button>
        </div>
      </div>
    </Transition>
  </div>
</template>
