<script setup lang="ts">
import { computed, ref } from 'vue';
import { CATALOG, CATEGORY_ORDER, type WidgetCategory, type WidgetSpec } from './widget-catalog';
import type { WidgetType } from '../types';

defineEmits<{ add: [type: WidgetType] }>();

const hovered = ref<WidgetSpec | null>(null);
const tipPos = ref<{ top: number; left: number }>({ top: 0, left: 0 });

const groups = computed(() => {
  const seen = new Map<WidgetCategory, WidgetSpec[]>();
  for (const w of CATALOG) {
    const arr = seen.get(w.category) ?? [];
    arr.push(w);
    seen.set(w.category, arr);
  }
  return CATEGORY_ORDER.filter((c) => seen.has(c)).map((c) => ({
    category: c,
    items: seen.get(c)!,
  }));
});

function showTip(spec: WidgetSpec, e: Event) {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  // Anchor to the right edge of the card with a small gap.
  tipPos.value = { top: rect.top, left: rect.right + 10 };
  hovered.value = spec;
}

function hideTip() {
  hovered.value = null;
}
</script>

<template>
  <aside class="w-60 shrink-0 border-r border-neutral-200 bg-white">
    <div class="border-b border-neutral-200 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
      Widgets
    </div>

    <div class="space-y-3 p-2">
      <section v-for="g in groups" :key="g.category">
        <div class="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          {{ g.category }}
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="w in g.items"
            :key="w.type"
            type="button"
            class="group flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700"
            @click="$emit('add', w.type)"
            @mouseenter="showTip(w, $event)"
            @mouseleave="hideTip"
            @focus="showTip(w, $event)"
            @blur="hideTip"
          >
            <span class="h-7 w-7" v-html="w.icon"></span>
            <span class="text-[11px] font-medium leading-none">{{ w.label }}</span>
          </button>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="hovered"
        class="pointer-events-none fixed z-50 w-72 rounded-lg border border-neutral-200 bg-white p-4 shadow-xl"
        :style="{ top: `${tipPos.top}px`, left: `${tipPos.left}px` }"
        role="tooltip"
      >
        <div class="flex items-center gap-2">
          <span class="h-5 w-5 text-orange-600" v-html="hovered.icon"></span>
          <div class="text-sm font-semibold text-neutral-900">{{ hovered.label }}</div>
        </div>
        <p class="mt-2 text-xs text-neutral-600">{{ hovered.description }}</p>

        <div class="mt-3">
          <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Data types
          </div>
          <div class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="t in hovered.dataTypes"
              :key="t"
              class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
            >{{ t }}</span>
          </div>
        </div>

        <div class="mt-3">
          <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            When to use
          </div>
          <p class="mt-1 text-xs leading-relaxed text-neutral-600">{{ hovered.whenToUse }}</p>
        </div>
      </div>
    </Teleport>
  </aside>
</template>
