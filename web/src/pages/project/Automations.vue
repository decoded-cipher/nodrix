<script setup lang="ts">
import { h, type FunctionalComponent } from 'vue';

type Condition = {
  key: string;
  title: string;
  desc: string;
  icon: 'clock' | 'cube' | 'sun' | 'bell' | 'hand';
};

const conditions: Condition[] = [
  { key: 'schedule', title: 'Schedule', desc: 'Automation will start at a specific time of day', icon: 'clock' },
  { key: 'device-state', title: 'Device State', desc: 'Trigger automation by a certain state of the device', icon: 'cube' },
  { key: 'sun', title: 'Sunset/Sunrise', desc: 'Automation will start based on the sun', icon: 'sun' },
  { key: 'event', title: 'Event', desc: 'Trigger automation when a certain event is logged on selected devices', icon: 'bell' },
  { key: 'scene', title: 'Scene', desc: 'Trigger automation manually', icon: 'hand' },
];

const ICONS: Record<Condition['icon'], string> = {
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  cube: 'M21 7.5 12 3 3 7.5m18 0L12 12m9-4.5v9L12 21m0-9L3 7.5m9 4.5v9M3 7.5v9L12 21',
  sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  hand: 'M15 11.25h-1.5m0 0V9.75m0 1.5h-1.5m1.5 0v-1.5M10.5 21h.75m-1.5-12.75V6.75A2.25 2.25 0 0 1 12 4.5a2.25 2.25 0 0 1 2.25 2.25V9m-4.5 0H7.5a1.5 1.5 0 0 0-1.5 1.5v8.25A2.25 2.25 0 0 0 8.25 21h7.5A2.25 2.25 0 0 0 18 18.75V10.5a1.5 1.5 0 0 0-1.5-1.5h-2.25M9.75 9h4.5',
};

const icon = (name: Condition['icon']): FunctionalComponent =>
  (_props, { attrs }) =>
    h(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        ...attrs,
      },
      [h('path', { d: ICONS[name] })]
    );

function pick(c: Condition) {
  // TODO: open the builder for the chosen condition.
  alert(`Coming soon: build a ${c.title} automation`);
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-8">
      <h1 class="text-xl font-semibold tracking-tight">Create automations</h1>
      <p class="mt-1 text-sm text-neutral-600">
        Automations let you set up actions that start when a certain trigger happens.
      </p>
    </header>

    <h2 class="mb-3 text-sm font-medium text-neutral-900">Choose Condition</h2>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <button
        v-for="c in conditions"
        :key="c.key"
        type="button"
        class="group flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 text-left transition hover:border-orange-300 hover:shadow-sm"
        @click="pick(c)"
      >
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-700">
          <component :is="icon(c.icon)" class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <div class="text-base font-semibold text-neutral-900">{{ c.title }}</div>
          <div class="mt-1 text-sm leading-relaxed text-neutral-600">{{ c.desc }}</div>
        </div>
      </button>
    </div>

    <p class="mt-8 text-xs text-neutral-500">
      No automations yet. Pick a trigger above to create your first one.
    </p>
  </div>
</template>
