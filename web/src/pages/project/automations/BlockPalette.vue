<script setup lang="ts">
import { ref } from 'vue';
import { TRIGGER_CATALOG, CONDITION_CATALOG, ACTION_CATALOG, type BlockManifest } from '@nodrix/blocks-shared';
import Icon from '../../../components/Icon.vue';

// `open` drives the off-canvas drawer below lg; on lg+ the palette is a static
// column and `open` is ignored.
defineProps<{ open?: boolean }>();
defineEmits<{ add: [kind: string]; close: [] }>();

const groups = [
  { label: 'Triggers', items: TRIGGER_CATALOG },
  { label: 'Conditions', items: CONDITION_CATALOG },
  { label: 'Actions', items: ACTION_CATALOG },
];

const hovered = ref<BlockManifest | null>(null);
const tipPos = ref<{ top: number; left: number }>({ top: 0, left: 0 });

function showTip(spec: BlockManifest, e: Event) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tipPos.value = { top: rect.top, left: rect.right + 10 };
  hovered.value = spec;
}
function hideTip() { hovered.value = null; }
</script>

<template>
  <!-- Backdrop behind the drawer (below lg only). -->
  <div v-if="open" class="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden="true" @click="$emit('close')" />
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 lg:static lg:z-auto lg:shrink-0 lg:translate-x-0 lg:transition-none dark:border-neutral-800 dark:bg-neutral-900"
    :class="open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
  >
    <div class="flex items-center justify-between border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Blocks</span>
      <button
        type="button"
        class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 lg:hidden dark:text-neutral-400 dark:hover:bg-neutral-800"
        aria-label="Close blocks"
        @click="$emit('close')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>

    <div class="flex-1 space-y-3 overflow-y-auto p-2">
      <section v-for="g in groups" :key="g.label">
        <div class="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {{ g.label }}
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="b in g.items"
            :key="b.kind"
            type="button"
            class="group flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:border-accent-700 dark:hover:bg-accent-900/30 dark:hover:text-accent-300"
            @click="$emit('add', b.kind)"
            @mouseenter="showTip(b, $event)"
            @mouseleave="hideTip"
            @focus="showTip(b, $event)"
            @blur="hideTip"
          >
            <Icon :path="b.icon" class="h-5 w-5" />
            <span class="px-1 text-center text-[10px] font-medium leading-tight">{{ b.label }}</span>
          </button>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="hovered"
        class="pointer-events-none fixed z-50 w-72 rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
        :style="{ top: `${tipPos.top}px`, left: `${tipPos.left}px` }"
        role="tooltip"
      >
        <div class="flex items-center gap-2">
          <Icon :path="hovered.icon" class="h-5 w-5 text-accent-600 dark:text-accent-400" />
          <div class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ hovered.label }}</div>
          <span class="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">{{ hovered.category }}</span>
        </div>
        <p class="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">{{ hovered.description }}</p>

        <div v-if="hovered.fields.length" class="mt-3">
          <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Settings</div>
          <div class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="f in hovered.fields"
              :key="f.key"
              class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >{{ f.label }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>
