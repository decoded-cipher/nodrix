<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

type Option = { value: T; label: string; hint?: string; meta?: string };

const props = defineProps<{
  modelValue: T | '';
  options: ReadonlyArray<Option>;
  placeholder?: string;
  size?: 'sm' | 'md';
}>();
const emit = defineEmits<{ 'update:modelValue': [T | ''] }>();

const open = ref(false);
const buttonEl = ref<HTMLButtonElement | null>(null);
const listEl = ref<HTMLUListElement | null>(null);
const activeIdx = ref(-1);

const selected = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null);
const sizeCls = computed(() =>
  props.size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'
);

function toggle() {
  open.value ? close() : openMenu();
}

function openMenu() {
  open.value = true;
  activeIdx.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue));
  nextTick(() => {
    document.addEventListener('mousedown', onDocMouseDown, true);
    scrollActiveIntoView();
  });
}

function close() {
  open.value = false;
  document.removeEventListener('mousedown', onDocMouseDown, true);
}

function onDocMouseDown(e: MouseEvent) {
  const t = e.target as Node;
  if (buttonEl.value?.contains(t)) return;
  if (listEl.value?.contains(t)) return;
  close();
}

function select(o: Option) {
  emit('update:modelValue', o.value);
  close();
  buttonEl.value?.focus();
}

function clear() {
  emit('update:modelValue', '');
  close();
  buttonEl.value?.focus();
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    buttonEl.value?.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx.value = Math.min(props.options.length - 1, activeIdx.value + 1);
    scrollActiveIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx.value = Math.max(0, activeIdx.value - 1);
    scrollActiveIntoView();
  } else if (e.key === 'Home') {
    e.preventDefault();
    activeIdx.value = 0;
    scrollActiveIntoView();
  } else if (e.key === 'End') {
    e.preventDefault();
    activeIdx.value = props.options.length - 1;
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const o = props.options[activeIdx.value];
    if (o) select(o);
  }
}

function scrollActiveIntoView() {
  const list = listEl.value;
  if (!list) return;
  const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx.value}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

watch(() => props.options.length, () => { if (open.value) close(); });
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown, true));
</script>

<template>
  <div class="relative">
    <button
      ref="buttonEl"
      type="button"
      :class="[
        'flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white text-left text-neutral-900 hover:border-neutral-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:border-neutral-600',
        sizeCls,
        open ? 'border-accent-500 ring-2 ring-accent-500/30 dark:border-accent-500' : '',
      ]"
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span :class="['flex-1 truncate', selected ? '' : 'text-neutral-400 dark:text-neutral-500']">
        {{ selected ? selected.label : (placeholder ?? 'Select…') }}
        <span v-if="selected?.meta" class="ml-1.5 font-normal text-neutral-400 dark:text-neutral-500">{{ selected.meta }}</span>
      </span>
      <svg
        class="h-4 w-4 shrink-0 text-neutral-500 transition-transform dark:text-neutral-400"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ><path d="M6 9l6 6 6-6"/></svg>
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <ul
        v-if="open"
        ref="listEl"
        role="listbox"
        class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        @keydown="onKeydown"
      >
        <li v-if="placeholder">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            @click="clear"
          >
            <span>{{ placeholder }}</span>
            <span v-if="!selected" class="text-accent-500">●</span>
          </button>
        </li>
        <li
          v-for="(o, idx) in options"
          :key="String(o.value)"
          role="option"
          :aria-selected="selected?.value === o.value"
        >
          <button
            type="button"
            :data-idx="idx"
            :class="[
              'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm',
              activeIdx === idx ? 'bg-accent-50 text-accent-900 dark:bg-accent-950/40 dark:text-accent-100' : 'text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800',
              selected?.value === o.value ? 'font-semibold' : '',
            ]"
            @click="select(o)"
            @mouseenter="activeIdx = idx"
          >
            <span class="flex min-w-0 flex-col">
              <span class="truncate">
                {{ o.label }}
                <span v-if="o.meta" class="ml-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-500">{{ o.meta }}</span>
              </span>
              <span v-if="o.hint" class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ o.hint }}</span>
            </span>
            <svg
              v-if="selected?.value === o.value"
              class="h-4 w-4 shrink-0 text-accent-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M20 6L9 17l-5-5"/></svg>
          </button>
        </li>
        <li v-if="options.length === 0" class="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
          No options
        </li>
      </ul>
    </Transition>
  </div>
</template>
