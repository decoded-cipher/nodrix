<script setup lang="ts">
import { h, onMounted, ref, type FunctionalComponent } from 'vue';
import { useProjectStore } from '../../stores/project';
import { confirm } from '../../lib/confirm';
import Spinner from '../../components/Spinner.vue';
import type { Automation, AutomationTriggerType } from '../../types';

const project = useProjectStore();

type Condition = {
  key: AutomationTriggerType;
  title: string;
  desc: string;
  icon: 'clock' | 'cube' | 'sun' | 'bell' | 'hand';
};

const conditions: Condition[] = [
  { key: 'schedule',       title: 'Schedule',       desc: 'Automation will start at a specific time of day',                          icon: 'clock' },
  { key: 'device_state',   title: 'Device State',   desc: 'Trigger automation by a certain state of the device',                      icon: 'cube' },
  { key: 'sunset_sunrise', title: 'Sunset/Sunrise', desc: 'Automation will start based on the sun',                                   icon: 'sun' },
  { key: 'event',          title: 'Event',          desc: 'Trigger automation when a certain event is logged on selected devices',    icon: 'bell' },
  { key: 'scene',          title: 'Scene',          desc: 'Trigger automation manually',                                              icon: 'hand' },
];

const ICONS: Record<Condition['icon'], string> = {
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  cube:  'M21 7.5 12 3 3 7.5m18 0L12 12m9-4.5v9L12 21m0-9L3 7.5m9 4.5v9M3 7.5v9L12 21',
  sun:   'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  bell:  'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  hand:  'M15 11.25h-1.5m0 0V9.75m0 1.5h-1.5m1.5 0v-1.5M10.5 21h.75m-1.5-12.75V6.75A2.25 2.25 0 0 1 12 4.5a2.25 2.25 0 0 1 2.25 2.25V9m-4.5 0H7.5a1.5 1.5 0 0 0-1.5 1.5v8.25A2.25 2.25 0 0 0 8.25 21h7.5A2.25 2.25 0 0 0 18 18.75V10.5a1.5 1.5 0 0 0-1.5-1.5h-2.25M9.75 9h4.5',
};

const icon = (name: Condition['icon']): FunctionalComponent =>
  (_props, { attrs }) =>
    h('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      ...attrs,
    }, [h('path', { d: ICONS[name] })]);

const loading = ref(false);
const creating = ref(false);
const showPicker = ref(false);
const pendingTrigger = ref<Condition | null>(null);
const newName = ref('');
const newDesc = ref('');

onMounted(async () => {
  loading.value = true;
  try { await project.loadAutomations(); } finally { loading.value = false; }
});

function pick(c: Condition) {
  pendingTrigger.value = c;
  newName.value = '';
  newDesc.value = '';
}

function cancelCreate() {
  pendingTrigger.value = null;
}

async function submitCreate() {
  if (!pendingTrigger.value) return;
  const name = newName.value.trim();
  if (!name) return;
  creating.value = true;
  try {
    await project.createAutomation({
      name,
      description: newDesc.value.trim() || null,
      trigger_type: pendingTrigger.value.key,
      trigger_config: {},
      actions: [],
    });
    pendingTrigger.value = null;
    showPicker.value = false;
  } finally {
    creating.value = false;
  }
}

async function toggle(a: Automation) {
  await project.updateAutomation(a.id, { enabled: !a.enabled });
}

async function remove(a: Automation) {
  const ok = await confirm({
    title: `Delete automation "${a.name}"?`,
    message: 'This action cannot be undone.',
    details: [
      `Trigger: ${triggerLabel(a.trigger_type)}`,
      a.enabled ? 'Currently enabled — it will stop running' : 'Currently disabled',
    ],
    confirmLabel: 'Delete automation',
  });
  if (!ok) return;
  await project.deleteAutomation(a.id);
}

function fmtStatus(a: Automation): string {
  if (!a.last_run_at) return 'Never run';
  const when = new Date(a.last_run_at * 1000).toLocaleString();
  return `${a.last_run_status ?? 'ok'} · ${when}`;
}

function triggerLabel(t: AutomationTriggerType): string {
  return conditions.find((c) => c.key === t)?.title ?? t;
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Automations</h1>
        <p class="mt-1 text-sm text-neutral-600">
          Actions that fire when a trigger condition is met.
        </p>
      </div>
      <button
        type="button"
        class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
        @click="showPicker = !showPicker"
      >{{ showPicker ? 'Close' : 'New automation' }}</button>
    </header>

    <!-- Existing automations -->
    <section v-if="!showPicker">
      <ul v-if="project.automations.length > 0" class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        <li v-for="a in project.automations" :key="a.id" class="flex items-start justify-between gap-4 px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ a.name }}</span>
              <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                {{ triggerLabel(a.trigger_type) }}
              </span>
              <span
                v-if="!a.enabled"
                class="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600"
              >disabled</span>
            </div>
            <div v-if="a.description" class="mt-0.5 truncate text-xs text-neutral-500">{{ a.description }}</div>
            <div class="mt-1 text-[11px] text-neutral-500">{{ fmtStatus(a) }}</div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
              @click="toggle(a)"
            >{{ a.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
              @click="remove(a)"
            >Delete</button>
          </div>
        </li>
      </ul>
      <div v-else-if="!loading" class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
        No automations yet. Click <span class="font-semibold">New automation</span> to create one.
      </div>
      <div v-else class="rounded-lg border border-neutral-200 bg-white p-10">
        <Spinner block />
      </div>
    </section>

    <!-- Trigger picker / create form -->
    <section v-else>
      <div v-if="!pendingTrigger">
        <h2 class="mb-3 text-sm font-medium text-neutral-900">Choose a trigger</h2>
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
      </div>

      <form v-else class="rounded-xl border border-neutral-200 bg-white p-5" @submit.prevent="submitCreate">
        <div class="mb-4 flex items-center gap-3 border-b border-neutral-100 pb-3">
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-700">
            <component :is="icon(pendingTrigger.icon)" class="h-5 w-5" />
          </div>
          <div>
            <div class="text-sm font-semibold">{{ pendingTrigger.title }}</div>
            <div class="text-xs text-neutral-500">{{ pendingTrigger.desc }}</div>
          </div>
        </div>

        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Name</span>
          <input
            v-model="newName"
            type="text"
            required
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="e.g. Lights off at sunset"
          />
        </label>

        <label class="mt-3 block">
          <span class="block text-xs font-medium text-neutral-600">Description (optional)</span>
          <textarea
            v-model="newDesc"
            rows="2"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>

        <p class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Trigger config and actions can be edited after creation. The runtime that
          evaluates triggers and runs actions is on the roadmap.
        </p>

        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
            @click="cancelCreate"
          >Back</button>
          <button
            type="submit"
            :disabled="creating || !newName.trim()"
            class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >{{ creating ? 'Creating…' : 'Create automation' }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
