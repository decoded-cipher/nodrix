<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import Icon from '../../../components/Icon.vue';
import Dropdown from '../../../components/Dropdown.vue';
import Spinner from '../../../components/Spinner.vue';
import { TRIGGERS, triggerSpec, OPERATORS, ACTION_TYPES } from './automation-catalog';
import { connSpec } from './connection-catalog';
import { recipeById } from './automation-recipes';
import type { AutomationTriggerType, Automation } from '../../../types';

const project = useProjectStore();
const route = useRoute();
const router = useRouter();

const editId = computed(() => (route.params['id'] as string | undefined) || null);
const recipeId = (route.query['recipe'] as string | undefined) || null;

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

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const WEEKDAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
];

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

const draft = reactive<Draft>(blankDraft('variable'));
const mode = ref<'picker' | 'form'>(editId.value || recipeId ? 'form' : 'picker');
const loading = ref(!!editId.value);
const saving = ref(false);
const notFound = ref(false);

// Seed from a recipe synchronously so the right trigger UI shows immediately
// (no flash of the default trigger while project data loads).
if (recipeId) {
  const r = recipeById(recipeId);
  if (r) {
    Object.assign(draft, blankDraft(r.trigger_type));
    draft.name = r.name;
    draft.trigger_config = { ...defaultConfig(r.trigger_type), ...r.trigger_config };
    draft.actions = r.actions.map((a) => ({ ...a }));
  }
}

// Dropdown option lists.
const variableOptions = computed(() => project.variables.map((v) => ({ value: v.key, label: v.name || v.key })));
const integrationOptions = computed(() =>
  project.integrations.map((i) => ({ value: i.id, label: i.name, hint: connSpec(i.kind).label }))
);
const operatorOptions = OPERATORS.map((o) => ({ value: o.value, label: o.label }));
const solarEventOptions = [{ value: 'sunrise', label: 'Sunrise' }, { value: 'sunset', label: 'Sunset' }];
const actionTypeOptions = ACTION_TYPES.map((a) => ({ value: a.value, label: a.label }));

const spec = computed(() => triggerSpec(draft.trigger_type));

// Init once the project is resolved (route may set it after this mounts).
watch(() => project.currentProjectId, init, { immediate: true });

async function init() {
  if (!project.currentProjectId) return;
  await Promise.all([
    project.variables.length ? Promise.resolve() : project.loadVariables(),
    project.loadIntegrations(),
  ]);

  if (editId.value) {
    let a = project.automations.find((x) => x.id === editId.value);
    if (!a) { await project.loadAutomations(); a = project.automations.find((x) => x.id === editId.value); }
    if (a) populateFromAutomation(a);
    else notFound.value = true;
    loading.value = false;
  }
}

function populateFromAutomation(a: Automation) {
  draft.id = a.id;
  draft.trigger_type = a.trigger_type;
  draft.name = a.name;
  draft.description = a.description ?? '';
  draft.trigger_config = { ...defaultConfig(a.trigger_type), ...((a.trigger_config as Record<string, unknown>) ?? {}) };
  draft.actions = Array.isArray(a.actions) ? JSON.parse(JSON.stringify(a.actions)) : [];
}

function pick(key: AutomationTriggerType) {
  Object.assign(draft, blankDraft(key));
  mode.value = 'form';
}

// Coerce strings to number/boolean where unambiguous, so comparisons and
// control writes carry the right type.
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

function backToList() {
  router.push({ name: 'automations' });
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
    backToList();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-8">
    <button type="button" class="mb-4 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100" @click="backToList">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      Automations
    </button>

    <div v-if="loading" class="rounded-xl border border-neutral-200 bg-white p-10 dark:border-neutral-800 dark:bg-neutral-900"><Spinner block /></div>

    <div v-else-if="notFound" class="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      Automation not found.
    </div>

    <!-- Trigger picker -->
    <section v-else-if="mode === 'picker'">
      <h1 class="text-lg font-semibold tracking-tight">New automation</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Choose what should trigger it.</p>
      <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          v-for="t in TRIGGERS"
          :key="t.key"
          type="button"
          class="group flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 text-left transition hover:border-accent-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700"
          @click="pick(t.key)"
        >
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
            <Icon :path="t.icon" class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <div class="text-base font-semibold text-neutral-900 dark:text-neutral-100">{{ t.title }}</div>
            <div class="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{{ t.desc }}</div>
          </div>
        </button>
      </div>
    </section>

    <!-- Editor form -->
    <form v-else @submit.prevent="save">
      <div class="mb-5 flex items-center gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
          <Icon :path="spec.icon" class="h-5 w-5" />
        </div>
        <div>
          <h1 class="text-lg font-semibold tracking-tight">{{ draft.id ? 'Edit automation' : 'New automation' }}</h1>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">{{ spec.title }} · {{ spec.desc }}</p>
        </div>
      </div>

      <!-- Details -->
      <div class="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
          <input v-model="draft.name" type="text" required class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" placeholder="e.g. Fan on when hot" />
        </label>
        <label class="mt-3 block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Description (optional)</span>
          <textarea v-model="draft.description" rows="2" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
        </label>
      </div>

      <!-- When -->
      <div class="mt-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">When</h3>

        <div v-if="draft.trigger_type === 'variable'" class="flex flex-wrap items-center gap-2">
          <Dropdown v-model="draft.trigger_config.variable" :options="variableOptions" placeholder="Variable" size="sm" class="w-44" />
          <Dropdown v-model="draft.trigger_config.operator" :options="operatorOptions" size="sm" class="w-48" />
          <input v-if="draft.trigger_config.operator !== 'changed'" v-model="draft.trigger_config.value" type="text" class="w-32 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="value" />
          <label class="ml-auto inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            <input v-model="draft.trigger_config.mode" type="checkbox" true-value="always" false-value="edge" class="rounded" />
            Fire on every reading
          </label>
        </div>

        <p v-else-if="draft.trigger_type === 'scene'" class="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          No condition — run this automation manually with the Run button.
        </p>

        <div v-else-if="draft.trigger_type === 'schedule'" class="space-y-3">
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
                ? 'border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'"
              @click="toggleDay(d.n)"
            >{{ d.label }}</button>
          </div>
          <p class="text-[11px] text-neutral-500 dark:text-neutral-400">No days selected = every day.</p>
        </div>

        <div v-else-if="draft.trigger_type === 'sunset_sunrise'" class="flex flex-wrap items-center gap-2">
          <Dropdown v-model="draft.trigger_config.event" :options="solarEventOptions" size="sm" class="w-32" />
          <input v-model.number="draft.trigger_config.lat" type="number" step="any" class="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="lat" />
          <input v-model.number="draft.trigger_config.lng" type="number" step="any" class="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="lng" />
          <label class="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            offset
            <input v-model.number="draft.trigger_config.offset_minutes" type="number" class="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
            min
          </label>
        </div>

        <div v-else-if="draft.trigger_type === 'event'">
          <input v-model="draft.trigger_config.event" type="text" class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="event name, e.g. button_pressed" />
          <p class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">Matched against <code>POST /v1/events</code> <code>{ "event": "…" }</code>.</p>
        </div>
      </div>

      <!-- Then -->
      <div class="mt-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Then do</h3>
          <button type="button" class="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="addAction">Add action</button>
        </div>

        <ul v-if="draft.actions.length > 0" class="space-y-2">
          <li v-for="(a, i) in draft.actions" :key="i" class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">{{ i + 1 }}</span>
            <Dropdown :model-value="a.type" :options="actionTypeOptions" size="sm" class="w-44" @update:model-value="(v) => { a.type = v; onActionTypeChange(a); }" />

            <template v-if="a.type === 'set_variable'">
              <Dropdown v-model="a.variable" :options="variableOptions" placeholder="Variable" size="sm" class="w-40" />
              <span class="text-xs text-neutral-500">to</span>
              <input v-model="a.value" type="text" class="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="value" />
            </template>

            <template v-else-if="a.type === 'call_integration'">
              <Dropdown v-model="a.integration_id" :options="integrationOptions" placeholder="Connection" size="sm" class="min-w-0 flex-1" />
              <RouterLink v-if="integrationOptions.length === 0" :to="`/p/${project.currentProjectId}/automations/connections`" class="text-xs text-accent-600 hover:underline dark:text-accent-400">Add a connection</RouterLink>
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

      <!-- Save bar -->
      <div class="sticky bottom-0 mt-4 flex items-center justify-end gap-2 rounded-xl border border-neutral-200 bg-white/90 p-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="backToList">Cancel</button>
        <button type="submit" :disabled="saving || !draft.name.trim()" class="rounded-md bg-accent-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
          {{ saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create automation' }}
        </button>
      </div>
    </form>
  </div>
</template>
