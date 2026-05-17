<script setup lang="ts">
import { CATALOG } from './widget-catalog';
import type { WidgetType } from '../types';

defineEmits<{ add: [type: WidgetType] }>();
</script>

<template>
  <aside class="w-56 shrink-0 border-r border-neutral-200 bg-white">
    <div class="border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
      Widgets
    </div>
    <ul class="p-2">
      <li v-for="w in CATALOG" :key="w.type">
        <button
          type="button"
          class="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100"
          @click="$emit('add', w.type)"
        >
          <div class="font-medium">{{ w.label }}</div>
          <div class="text-xs text-neutral-500">{{ w.description }}</div>
        </button>
      </li>
    </ul>
  </aside>
</template>
