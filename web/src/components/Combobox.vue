<script setup lang="ts">
// Typeable single-select: a dropdown of suggestions that also accepts any
// free-typed value (unlike Dropdown.vue, which is select-only). The input text
// *is* the model value; picking a suggestion just fills it in. Used for units,
// where common picks should be one click but arbitrary values must still work.
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{
  modelValue: string;
  options: ReadonlyArray<string>;
  placeholder?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [string];
  commit: [];
  cancel: [];
}>();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const activeIdx = ref(-1);

// The menu is teleported to <body> (fixed) so an ancestor's overflow:hidden
// (e.g. the variables table card) can't clip it. Anchored to the input's rect.
const menuStyle = ref<{ top: string; left: string; width: string }>({ top: '0', left: '0', width: '0' });
function position() {
  const r = rootEl.value?.getBoundingClientRect();
  if (r) menuStyle.value = { top: `${r.bottom + 4}px`, left: `${r.left}px`, width: `${r.width}px` };
}

const query = computed(() => props.modelValue.trim());

const filtered = computed(() => {
  const q = query.value.toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.toLowerCase().includes(q));
});

// Offer "use the typed text" when it isn't already an exact suggestion.
const showCustom = computed(
  () => query.value.length > 0 && !props.options.some((o) => o.toLowerCase() === query.value.toLowerCase())
);

function openMenu() {
  if (open.value) return;
  open.value = true;
  activeIdx.value = -1;
  nextTick(() => {
    position();
    document.addEventListener('mousedown', onDocMouseDown, true);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
  });
}
function close() {
  open.value = false;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  window.removeEventListener('scroll', position, true);
  window.removeEventListener('resize', position);
}
function onDocMouseDown(e: MouseEvent) {
  const t = e.target as Node;
  if (!rootEl.value?.contains(t) && !menuEl.value?.contains(t)) close();
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
  openMenu();
  activeIdx.value = -1;
}

function pick(value: string) {
  emit('update:modelValue', value);
  close();
  emit('commit');
}
function acceptTyped() {
  close();
  emit('commit');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    openMenu();
    activeIdx.value = Math.min(filtered.value.length - 1, activeIdx.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx.value = Math.max(0, activeIdx.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const opt = open.value && activeIdx.value >= 0 ? filtered.value[activeIdx.value] : undefined;
    opt ? pick(opt) : acceptTyped();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
    emit('cancel');
  }
}

function focus() {
  inputEl.value?.focus();
  inputEl.value?.select();
}
defineExpose({ focus });

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true);
  window.removeEventListener('scroll', position, true);
  window.removeEventListener('resize', position);
});
</script>

<template>
  <div ref="rootEl" class="relative">
    <div class="flex items-center rounded border border-accent-500 bg-white focus-within:ring-1 focus-within:ring-accent-500/30 dark:bg-neutral-950">
      <input
        ref="inputEl"
        :value="modelValue"
        type="text"
        :placeholder="placeholder ?? 'unit'"
        class="w-full min-w-0 bg-transparent px-2 py-1 text-xs text-neutral-800 focus:outline-none dark:text-neutral-100"
        @focus="openMenu"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        tabindex="-1"
        aria-label="Toggle suggestions"
        class="px-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        @mousedown.prevent
        @click="open ? close() : (focus(), openMenu())"
      >
        <svg class="h-3.5 w-3.5 transition-transform" :class="open ? 'rotate-180' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </div>

    <Teleport to="body">
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <ul
        v-if="open && (filtered.length > 0 || showCustom)"
        ref="menuEl"
        :style="menuStyle"
        class="fixed z-50 max-h-52 min-w-[8rem] overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        <li v-for="(o, idx) in filtered" :key="o">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs"
            :class="[
              activeIdx === idx ? 'bg-accent-50 text-accent-900 dark:bg-accent-950/40 dark:text-accent-100' : 'text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800',
              o === modelValue ? 'font-semibold' : '',
            ]"
            @mousedown.prevent
            @click="pick(o)"
            @mouseenter="activeIdx = idx"
          >
            <span class="truncate">{{ o }}</span>
            <svg v-if="o === modelValue" class="h-3.5 w-3.5 shrink-0 text-accent-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </button>
        </li>
        <li v-if="showCustom" :class="filtered.length > 0 ? 'border-t border-neutral-100 dark:border-neutral-800' : ''">
          <button
            type="button"
            class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            @mousedown.prevent
            @click="acceptTyped"
          >
            Use <span class="font-medium text-neutral-900 dark:text-neutral-100">"{{ query }}"</span>
          </button>
        </li>
      </ul>
    </Transition>
    </Teleport>
  </div>
</template>
