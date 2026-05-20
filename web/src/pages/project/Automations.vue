<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, type FunctionalComponent } from 'vue';
import { useProjectStore } from '../../stores/project';
import { confirm } from '../../lib/confirm';
import Spinner from '../../components/Spinner.vue';
import Dropdown from '../../components/Dropdown.vue';
import type { Automation, AutomationTriggerType, VariableOperator } from '../../types';

const project = useProjectStore();

type Condition = {
  key: AutomationTriggerType;
  title: string;
  desc: string;
  icon: 'clock' | 'cube' | 'sun' | 'bell' | 'hand';
};

const conditions: Condition[] = [
  { key: 'variable',       title: 'Variable',       desc: 'Trigger when the state or value of a variable meets a condition',          icon: 'cube' },
  { key: 'scene',          title: 'Scene',          desc: 'Trigger automation manually with a Run button',                            icon: 'hand' },
  { key: 'schedule',       title: 'Schedule',       desc: 'Automation will start at a specific time of day',                          icon: 'clock' },
  { key: 'sunset_sunrise', title: 'Sunset/Sunrise', desc: 'Automation will start based on the sun',                                   icon: 'sun' },
  { key: 'event',          title: 'Event',          desc: 'Trigger when a named event is posted by hardware or another automation',  icon: 'bell' },
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

const OPERATORS: { value: VariableOperator; label: string }[] = [
  { value: '>',  label: 'is greater than' },
  { value: '<',  label: 'is less than' },
  { value: '>=', label: 'is at least' },
  { value: '<=', label: 'is at most' },
  { value: '==', label: 'equals' },
  { value: '!=', label: 'does not equal' },
  { value: 'changed', label: 'changes' },
];

// Dropdown option lists.
const variableOptions = computed(() =>
  project.variables.map((v) => ({ value: v.key, label: v.name || v.key }))
);
const integrationOptions = computed(() =>
  project.integrations.map((i) => ({ value: i.id, label: `${i.name} (${i.kind})` }))
);
const solarEventOptions = [
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'sunset', label: 'Sunset' },
];
const actionTypeOptions = [
  { value: 'set_variable', label: 'Set variable' },
  { value: 'call_integration', label: 'Call integration' },
  { value: 'emit_event', label: 'Emit event' },
];

const WEEKDAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
];

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type Draft = {
  id: string | null;
  trigger_type: AutomationTriggerType;
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trigger_config: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any[];
};

const loading = ref(false);
const saving = ref(false);
const showPicker = ref(false);
const editing = ref(false);
const runningId = ref<string | null>(null);
const runMsg = ref<{ id: string; text: string; ok: boolean } | null>(null);

const draft = reactive<Draft>(blankDraft('variable'));

function defaultConfig(t: AutomationTriggerType): Record<string, unknown> {
  switch (t) {
    case 'variable':       return { variable: project.variables[0]?.key ?? '', operator: '>', value: '', mode: 'edge' };
    case 'schedule':       return { time: '08:00', days: [], tz: browserTz };
    case 'sunset_sunrise': return { event: 'sunset', lat: 0, lng: 0, offset_minutes: 0 };
    case 'event':          return { event: '' };
    case 'scene':
    default:               return {};
  }
}

function blankDraft(t: AutomationTriggerType): Draft {
  return { id: null, trigger_type: t, name: '', description: '', trigger_config: defaultConfig(t), actions: [] };
}

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([project.loadAutomations(), project.loadIntegrations(), project.loadVariables()]);
  } finally {
    loading.value = false;
  }
});

function pick(c: Condition) {
  Object.assign(draft, blankDraft(c.key));
  showPicker.value = false;
  editing.value = true;
}

function openEdit(a: Automation) {
  draft.id = a.id;
  draft.trigger_type = a.trigger_type;
  draft.name = a.name;
  draft.description = a.description ?? '';
  draft.trigger_config = { ...defaultConfig(a.trigger_type), ...(a.trigger_config as Record<string, unknown> ?? {}) };
  draft.actions = Array.isArray(a.actions) ? JSON.parse(JSON.stringify(a.actions)) : [];
  showPicker.value = false;
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
  showPicker.value = false;
}

// Coerce string inputs to number/boolean where they clearly are one, so numeric
// comparisons and control writes carry the right type.
function coerce(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (!Number.isNaN(Number(s))) return Number(s);
  return s;
}

function buildConfig(): Record<string, unknown> {
  const cfg = { ...draft.trigger_config };
  if (draft.trigger_type === 'variable') {
    if (cfg.operator === 'changed') delete cfg.value;
    else cfg.value = coerce(cfg.value);
  }
  return cfg;
}

function buildActions(): unknown[] {
  return draft.actions.map((a) => {
    if (a.type === 'set_variable') return { type: 'set_variable', variable: a.variable, value: coerce(a.value) };
    if (a.type === 'call_integration') return { type: 'call_integration', integration_id: a.integration_id };
    if (a.type === 'emit_event') return { type: 'emit_event', event: a.event };
    return a;
  });
}

async function save() {
  const name = draft.name.trim();
  if (!name) return;
  saving.value = true;
  try {
    if (draft.id) {
      await project.updateAutomation(draft.id, {
        name,
        description: draft.description.trim() || null,
        trigger_config: buildConfig(),
        actions: buildActions(),
      });
    } else {
      await project.createAutomation({
        name,
        description: draft.description.trim() || null,
        trigger_type: draft.trigger_type,
        trigger_config: buildConfig(),
        actions: buildActions(),
      });
    }
    editing.value = false;
  } finally {
    saving.value = false;
  }
}

function addAction() {
  draft.actions.push({ type: 'set_variable', variable: project.variables[0]?.key ?? '', value: '' });
}
function removeAction(i: number) { draft.actions.splice(i, 1); }
function moveAction(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= draft.actions.length) return;
  const [item] = draft.actions.splice(i, 1);
  draft.actions.splice(j, 0, item);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onActionTypeChange(a: any) {
  if (a.type === 'set_variable') { a.variable = project.variables[0]?.key ?? ''; a.value = ''; }
  else if (a.type === 'call_integration') { a.integration_id = project.integrations[0]?.id ?? ''; }
  else if (a.type === 'emit_event') { a.event = ''; }
}

function toggleDay(n: number) {
  const days: number[] = draft.trigger_config.days ?? (draft.trigger_config.days = []);
  const idx = days.indexOf(n);
  if (idx >= 0) days.splice(idx, 1);
  else days.push(n);
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

async function run(a: Automation) {
  runningId.value = a.id;
  try {
    const res = await project.runAutomation(a.id);
    runMsg.value = {
      id: a.id,
      ok: res.status !== 'error',
      text: res.status === 'error' ? (res.error ?? 'error') : `${res.status} · ran ${res.actionsRun} action(s)`,
    };
    setTimeout(() => { if (runMsg.value?.id === a.id) runMsg.value = null; }, 4000);
  } finally {
    runningId.value = null;
  }
}

function fmtStatus(a: Automation): string {
  if (!a.last_run_at) return 'Never run';
  const when = new Date(a.last_run_at * 1000).toLocaleString();
  return `${a.last_run_status ?? 'ok'} · ${when}`;
}

function triggerLabel(t: AutomationTriggerType): string {
  return conditions.find((c) => c.key === t)?.title ?? t;
}

function conditionFor(t: AutomationTriggerType): Condition {
  return conditions.find((c) => c.key === t) ?? conditions[0]!;
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Automations</h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Actions that fire when a trigger condition is met.
        </p>
      </div>
      <button
        v-if="!editing"
        type="button"
        class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
        @click="showPicker = !showPicker"
      >{{ showPicker ? 'Close' : 'New automation' }}</button>
    </header>

    <!-- Existing automations -->
    <section v-if="!showPicker && !editing">
      <ul v-if="project.automations.length > 0" class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        <li v-for="a in project.automations" :key="a.id" class="flex items-start justify-between gap-4 px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ a.name }}</span>
              <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {{ triggerLabel(a.trigger_type) }}
              </span>
              <span
                v-if="!a.enabled"
                class="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              >disabled</span>
            </div>
            <div v-if="a.description" class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{{ a.description }}</div>
            <div class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{{ fmtStatus(a) }}</div>
            <div
              v-if="runMsg && runMsg.id === a.id"
              class="mt-1 text-[11px]"
              :class="runMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'"
            >{{ runMsg.text }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              :disabled="runningId === a.id"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="run(a)"
            >{{ runningId === a.id ? 'Running…' : 'Run' }}</button>
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="openEdit(a)"
            >Edit</button>
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="toggle(a)"
            >{{ a.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="remove(a)"
            >Delete</button>
          </div>
        </li>
      </ul>
      <div v-else-if="!loading" class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        No automations yet. Click <span class="font-semibold">New automation</span> to create one.
      </div>
      <div v-else class="rounded-lg border border-neutral-200 bg-white p-10 dark:border-neutral-800 dark:bg-neutral-900">
        <Spinner block />
      </div>
    </section>

    <!-- Trigger picker -->
    <section v-else-if="showPicker">
      <h2 class="mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100">Choose a trigger</h2>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <button
          v-for="c in conditions"
          :key="c.key"
          type="button"
          class="group flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 text-left transition hover:border-orange-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-orange-700"
          @click="pick(c)"
        >
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
            <component :is="icon(c.icon)" class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <div class="text-base font-semibold text-neutral-900 dark:text-neutral-100">{{ c.title }}</div>
            <div class="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{{ c.desc }}</div>
          </div>
        </button>
      </div>
    </section>

    <!-- Draft editor (create + edit) -->
    <section v-else>
      <form class="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" @submit.prevent="save">
        <div class="mb-4 flex items-center gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
            <component :is="icon(conditionFor(draft.trigger_type).icon)" class="h-5 w-5" />
          </div>
          <div>
            <div class="text-sm font-semibold">{{ draft.id ? 'Edit' : 'New' }} · {{ triggerLabel(draft.trigger_type) }}</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">{{ conditionFor(draft.trigger_type).desc }}</div>
          </div>
        </div>

        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
          <input
            v-model="draft.name"
            type="text"
            required
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            placeholder="e.g. Fan on when hot"
          />
        </label>

        <label class="mt-3 block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Description (optional)</span>
          <textarea
            v-model="draft.description"
            rows="2"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        </label>

        <!-- Trigger config -->
        <div class="mt-5">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">When</h3>

          <!-- variable -->
          <div v-if="draft.trigger_type === 'variable'" class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <Dropdown v-model="draft.trigger_config.variable" :options="variableOptions" placeholder="Variable" size="sm" class="w-40" />
            <Dropdown v-model="draft.trigger_config.operator" :options="OPERATORS" size="sm" class="w-48" />
            <input
              v-if="draft.trigger_config.operator !== 'changed'"
              v-model="draft.trigger_config.value"
              type="text"
              class="w-32 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="value"
            />
            <label class="ml-auto inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              <input v-model="draft.trigger_config.mode" type="checkbox" true-value="always" false-value="edge" class="rounded" />
              Fire on every reading
            </label>
          </div>

          <!-- scene -->
          <p v-else-if="draft.trigger_type === 'scene'" class="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            No condition — run this automation manually with the <span class="font-semibold">Run</span> button.
          </p>

          <!-- schedule -->
          <div v-else-if="draft.trigger_type === 'schedule'" class="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div class="flex flex-wrap items-center gap-2">
              <input v-model="draft.trigger_config.time" type="time" class="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
              <input v-model="draft.trigger_config.tz" type="text" class="w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950" placeholder="IANA timezone" />
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="d in WEEKDAYS"
                :key="d.n"
                type="button"
                class="rounded-md border px-2.5 py-1 text-xs"
                :class="(draft.trigger_config.days ?? []).includes(d.n)
                  ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                  : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'"
                @click="toggleDay(d.n)"
              >{{ d.label }}</button>
            </div>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">No days selected = every day.</p>
          </div>

          <!-- sunset_sunrise -->
          <div v-else-if="draft.trigger_type === 'sunset_sunrise'" class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <Dropdown v-model="draft.trigger_config.event" :options="solarEventOptions" size="sm" class="w-32" />
            <input v-model.number="draft.trigger_config.lat" type="number" step="any" class="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="lat" />
            <input v-model.number="draft.trigger_config.lng" type="number" step="any" class="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="lng" />
            <label class="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              offset
              <input v-model.number="draft.trigger_config.offset_minutes" type="number" class="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
              min
            </label>
          </div>

          <!-- event -->
          <div v-else-if="draft.trigger_type === 'event'" class="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <input v-model="draft.trigger_config.event" type="text" class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="event name, e.g. button_pressed" />
            <p class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">Matched against <code>POST /v1/events</code> <code>{ "event": "…" }</code>.</p>
          </div>
        </div>

        <!-- Actions -->
        <div class="mt-5">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Then do</h3>
            <button type="button" class="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="addAction">Add action</button>
          </div>

          <ul v-if="draft.actions.length > 0" class="space-y-2">
            <li v-for="(a, i) in draft.actions" :key="i" class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <Dropdown
                :model-value="a.type"
                :options="actionTypeOptions"
                size="sm"
                class="w-40"
                @update:model-value="(v) => { a.type = v; onActionTypeChange(a); }"
              />

              <template v-if="a.type === 'set_variable'">
                <Dropdown v-model="a.variable" :options="variableOptions" placeholder="Variable" size="sm" class="w-40" />
                <span class="text-xs text-neutral-500">to</span>
                <input v-model="a.value" type="text" class="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="value" />
              </template>

              <template v-else-if="a.type === 'call_integration'">
                <Dropdown v-model="a.integration_id" :options="integrationOptions" placeholder="Integration" size="sm" class="min-w-0 flex-1" />
              </template>

              <template v-else-if="a.type === 'emit_event'">
                <input v-model="a.event" type="text" class="w-48 rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="event name" />
              </template>

              <div class="ml-auto flex items-center gap-1">
                <button type="button" class="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800" title="Move up" @click="moveAction(i, -1)">↑</button>
                <button type="button" class="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800" title="Move down" @click="moveAction(i, 1)">↓</button>
                <button type="button" class="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40" title="Remove" @click="removeAction(i)">✕</button>
              </div>
            </li>
          </ul>
          <p v-else class="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            No actions yet. Add at least one for this automation to do something.
          </p>
        </div>

        <div class="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            @click="cancelEdit"
          >Cancel</button>
          <button
            type="submit"
            :disabled="saving || !draft.name.trim()"
            class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >{{ saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create automation' }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
