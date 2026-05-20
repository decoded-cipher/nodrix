<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import { confirm } from '../../lib/confirm';
import Dropdown from '../../components/Dropdown.vue';
import type { Integration, IntegrationKind } from '../../types';

const HTTP_METHOD_OPTIONS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }));

const project = useProjectStore();

type TabKey = 'webhooks' | 'code' | 'services';

const KIND_TO_TAB: Record<IntegrationKind, TabKey> = {
  webhook: 'webhooks',
  code_block: 'code',
  slack: 'services',
  email: 'services',
  mqtt: 'services',
  http_service: 'services',
};

const KIND_LABEL: Record<IntegrationKind, string> = {
  webhook: 'Webhook',
  code_block: 'Code block',
  slack: 'Slack',
  email: 'Email',
  mqtt: 'MQTT',
  http_service: 'HTTP service',
};

// Which kinds the runtime actually executes today. The rest are creatable but
// skipped by the engine until their executors land.
const EXECUTABLE: Record<IntegrationKind, boolean> = {
  webhook: true,
  slack: true,
  http_service: true,
  code_block: false,
  email: false,
  mqtt: false,
};

const SERVICE_KINDS: { kind: IntegrationKind; desc: string }[] = [
  { kind: 'slack',        desc: 'Post to a channel via an incoming webhook' },
  { kind: 'http_service', desc: 'Generic outbound HTTP request' },
  { kind: 'email',        desc: 'Send a templated email (not yet executed)' },
  { kind: 'mqtt',         desc: 'Publish to a broker (not yet executed)' },
];

const tabs: { key: TabKey; label: string }[] = [
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'code',     label: 'Code blocks' },
  { key: 'services', label: 'Services' },
];

const active = ref<TabKey>('webhooks');
const loading = ref(false);

// Create form state
const showForm = ref(false);
const formKind = ref<IntegrationKind>('webhook');
const formName = ref('');
const formWebhookUrl = ref('');
const formSlackUrl = ref('');
const formSlackTemplate = ref('');
const formHttpUrl = ref('');
const formHttpMethod = ref('POST');
const formHttpHeaders = ref('');
const formCode = ref('export default function (event) {\n  return event;\n}\n');
const formServiceConfig = ref('{}');
const slackPlaceholder = '{{variable}} is now {{value}}';
const submitting = ref(false);
const formError = ref<string | null>(null);

onMounted(async () => {
  loading.value = true;
  try { await project.loadIntegrations(); } finally { loading.value = false; }
});

const byTab = computed(() => {
  const buckets: Record<TabKey, Integration[]> = { webhooks: [], code: [], services: [] };
  for (const i of project.integrations) buckets[KIND_TO_TAB[i.kind]].push(i);
  return buckets;
});

function openCreate(kind: IntegrationKind) {
  formKind.value = kind;
  formName.value = '';
  formWebhookUrl.value = '';
  formSlackUrl.value = '';
  formSlackTemplate.value = '';
  formHttpUrl.value = '';
  formHttpMethod.value = 'POST';
  formHttpHeaders.value = '';
  formServiceConfig.value = '{}';
  formError.value = null;
  showForm.value = true;
}

function cancelCreate() {
  showForm.value = false;
  formError.value = null;
}

async function submit() {
  const name = formName.value.trim();
  if (!name) return;
  formError.value = null;
  let config: unknown = {};
  const kind = formKind.value;
  if (kind === 'webhook') {
    const url = formWebhookUrl.value.trim();
    if (!url) { formError.value = 'URL is required.'; return; }
    config = { url };
  } else if (kind === 'slack') {
    const url = formSlackUrl.value.trim();
    if (!url) { formError.value = 'Slack webhook URL is required.'; return; }
    config = { webhook_url: url, ...(formSlackTemplate.value.trim() ? { template: formSlackTemplate.value } : {}) };
  } else if (kind === 'http_service') {
    const url = formHttpUrl.value.trim();
    if (!url) { formError.value = 'URL is required.'; return; }
    let headers: Record<string, string> = {};
    if (formHttpHeaders.value.trim()) {
      try { headers = JSON.parse(formHttpHeaders.value); } catch { formError.value = 'Headers must be valid JSON.'; return; }
    }
    config = { url, method: formHttpMethod.value, ...(Object.keys(headers).length ? { headers } : {}) };
  } else if (kind === 'code_block') {
    config = { language: 'javascript', source: formCode.value };
  } else {
    // email / mqtt — raw JSON until their executors land.
    try {
      config = JSON.parse(formServiceConfig.value || '{}');
    } catch {
      formError.value = 'Config must be valid JSON.';
      return;
    }
  }

  submitting.value = true;
  try {
    await project.createIntegration({ name, kind: formKind.value, config });
    showForm.value = false;
  } finally {
    submitting.value = false;
  }
}

async function toggle(i: Integration) {
  await project.updateIntegration(i.id, { enabled: !i.enabled });
}

async function remove(i: Integration) {
  const ok = await confirm({
    title: `Delete integration "${i.name}"?`,
    message: 'This action cannot be undone.',
    details: [
      `Kind: ${KIND_LABEL[i.kind]}`,
      'Any automations referencing it will stop working until reconfigured',
    ],
    confirmLabel: 'Delete integration',
  });
  if (!ok) return;
  await project.deleteIntegration(i.id);
}

function webhookUrl(i: Integration): string {
  const cfg = i.config as { url?: string } | null;
  return cfg?.url ?? '';
}

const copiedId = ref<string | null>(null);
async function copyUrl(i: Integration) {
  const url = webhookUrl(i);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    copiedId.value = i.id;
    setTimeout(() => { if (copiedId.value === i.id) copiedId.value = null; }, 1200);
  } catch {
    // Clipboard API can fail in insecure contexts; fall back silently.
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Integrations</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Reusable connectors to the outside world. Trigger them from automations, dashboard
        buttons, or the API.
      </p>
    </header>

    <!-- Tabs -->
    <div class="mb-5 border-b border-neutral-200 dark:border-neutral-800">
      <nav class="-mb-px flex gap-6 text-sm">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="border-b-2 px-1 pb-2.5 font-medium transition"
          :class="active === t.key
            ? 'border-orange-600 text-orange-700 dark:text-orange-400'
            : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'"
          @click="active = t.key; showForm = false"
        >
          {{ t.label }}
          <span
            class="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >{{ byTab[t.key].length }}</span>
        </button>
      </nav>
    </div>

    <!-- Create form -->
    <form v-if="showForm" class="mb-6 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" @submit.prevent="submit">
      <div class="mb-3 text-sm font-semibold">New {{ KIND_LABEL[formKind] }}</div>

      <label class="block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
        <input
          v-model="formName"
          type="text"
          required
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          :placeholder="formKind === 'webhook' ? 'e.g. Notify Slack' : formKind === 'code_block' ? 'e.g. Convert °C to °F' : 'Name'"
        />
      </label>

      <!-- webhook -->
      <label v-if="formKind === 'webhook'" class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Target URL</span>
        <input
          v-model="formWebhookUrl"
          type="url"
          required
          placeholder="https://hooks.example.com/…"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
        <span class="mt-1 block text-[11px] text-neutral-500 dark:text-neutral-400">Receives a JSON POST with the trigger context (source, variable, value, …).</span>
      </label>

      <!-- slack -->
      <div v-else-if="formKind === 'slack'" class="mt-3 space-y-3">
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Slack incoming webhook URL</span>
          <input
            v-model="formSlackUrl"
            type="url"
            required
            placeholder="https://hooks.slack.com/services/…"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Message template (optional)</span>
          <input
            v-model="formSlackTemplate"
            type="text"
            :placeholder="slackPlaceholder"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <span class="mt-1 block text-[11px] text-neutral-500 dark:text-neutral-400">Use <code v-pre>{{variable}}</code>, <code v-pre>{{value}}</code>, <code v-pre>{{event}}</code>. Defaults to an auto message.</span>
        </label>
      </div>

      <!-- http_service -->
      <div v-else-if="formKind === 'http_service'" class="mt-3 space-y-3">
        <div class="flex gap-2">
          <Dropdown v-model="formHttpMethod" :options="HTTP_METHOD_OPTIONS" class="w-28 shrink-0" />
          <input
            v-model="formHttpUrl"
            type="url"
            required
            placeholder="https://api.example.com/…"
            class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        </div>
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Headers (JSON, optional)</span>
          <textarea
            v-model="formHttpHeaders"
            rows="3"
            placeholder='{ "authorization": "Bearer …" }'
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        </label>
      </div>

      <!-- code_block (not yet executed) -->
      <label v-else-if="formKind === 'code_block'" class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Source (JavaScript)</span>
        <textarea
          v-model="formCode"
          rows="8"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 dark:border-neutral-700"
        />
        <span class="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">Code blocks are not executed yet — saved for when the sandbox runtime lands.</span>
      </label>

      <!-- email / mqtt (not yet executed) -->
      <label v-else class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Config (JSON)</span>
        <textarea
          v-model="formServiceConfig"
          rows="6"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
        <span class="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">{{ KIND_LABEL[formKind] }} is not executed yet — saved for when its connector lands.</span>
      </label>

      <p v-if="formError" class="mt-2 text-xs text-red-600 dark:text-red-400">{{ formError }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="cancelCreate"
        >Cancel</button>
        <button
          type="submit"
          :disabled="submitting || !formName.trim()"
          class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >{{ submitting ? 'Creating…' : 'Create' }}</button>
      </div>
    </form>

    <!-- Webhooks tab -->
    <section v-if="active === 'webhooks'">
      <div class="mb-4 flex items-end justify-between">
        <div>
          <h2 class="text-sm font-semibold">Outgoing webhooks</h2>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            POST device events, metric updates, or automation runs to an external URL.
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          @click="openCreate('webhook')"
        >Add webhook</button>
      </div>

      <ul v-if="byTab.webhooks.length > 0" class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        <li v-for="i in byTab.webhooks" :key="i.id" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ i.name }}</span>
              <span
                v-if="!i.enabled"
                class="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              >disabled</span>
            </div>
            <div class="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500 dark:text-neutral-400"
                :title="webhookUrl(i)"
              >{{ webhookUrl(i) }}</span>
              <button
                type="button"
                class="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                :title="copiedId === i.id ? 'Copied' : 'Copy URL'"
                @click="copyUrl(i)"
              >
                <svg v-if="copiedId !== i.id" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
                  <path d="M9 4h7a2 2 0 0 1 2 2v10M8 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H8Z" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </button>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="toggle(i)"
            >{{ i.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="remove(i)"
            >Delete</button>
          </div>
        </li>
      </ul>
      <div v-else class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        No webhooks yet.
      </div>
    </section>

    <!-- Code blocks tab -->
    <section v-else-if="active === 'code'">
      <div class="mb-4 flex items-end justify-between">
        <div>
          <h2 class="text-sm font-semibold">Code blocks</h2>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Snippets of JavaScript invoked as automation actions. Runtime is on the roadmap.
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          @click="openCreate('code_block')"
        >New code block</button>
      </div>

      <ul v-if="byTab.code.length > 0" class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        <li v-for="i in byTab.code" :key="i.id" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ i.name }}</span>
              <span class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">preview</span>
            </div>
            <div class="mt-0.5 truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{{ i.id }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="toggle(i)"
            >{{ i.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="remove(i)"
            >Delete</button>
          </div>
        </li>
      </ul>
      <div v-else class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        No code blocks yet.
      </div>
    </section>

    <!-- Services tab -->
    <section v-else>
      <div class="mb-4">
        <h2 class="text-sm font-semibold">Services</h2>
        <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          Connectors for common destinations. Configure once, reference from automations.
        </p>
      </div>

      <ul v-if="byTab.services.length > 0" class="mb-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        <li v-for="i in byTab.services" :key="i.id" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ i.name }}</span>
              <span class="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {{ KIND_LABEL[i.kind] }}
              </span>
              <span
                v-if="!EXECUTABLE[i.kind]"
                class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                title="Saved but not executed by the runtime yet"
              >preview</span>
              <span
                v-if="!i.enabled"
                class="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              >disabled</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="toggle(i)"
            >{{ i.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="remove(i)"
            >Delete</button>
          </div>
        </li>
      </ul>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="svc in SERVICE_KINDS"
          :key="svc.kind"
          type="button"
          class="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-orange-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-orange-700"
          @click="openCreate(svc.kind)"
        >
          <div>
            <div class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ KIND_LABEL[svc.kind] }}</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ svc.desc }}</div>
          </div>
          <span class="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Add</span>
        </button>
      </div>
    </section>
  </div>
</template>
