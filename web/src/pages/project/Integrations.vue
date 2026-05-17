<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import type { Integration, IntegrationKind } from '../../types';

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

const SERVICE_KINDS: { kind: IntegrationKind; desc: string }[] = [
  { kind: 'slack',        desc: 'Post to a channel' },
  { kind: 'email',        desc: 'Send a templated email' },
  { kind: 'mqtt',         desc: 'Publish to a broker' },
  { kind: 'http_service', desc: 'Generic outbound HTTP service' },
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
const formCode = ref('export default function (event) {\n  return event;\n}\n');
const formServiceConfig = ref('{}');
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
  formError.value = null;
  if (kind === 'http_service' || kind === 'slack' || kind === 'email' || kind === 'mqtt') {
    formServiceConfig.value = '{}';
  }
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
  if (formKind.value === 'webhook') {
    const url = formWebhookUrl.value.trim();
    if (!url) { formError.value = 'URL is required.'; return; }
    config = { url };
  } else if (formKind.value === 'code_block') {
    config = { language: 'javascript', source: formCode.value };
  } else {
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
  if (!confirm(`Delete integration "${i.name}"?`)) return;
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
      <p class="mt-1 text-sm text-neutral-600">
        Reusable connectors to the outside world. Trigger them from automations, dashboard
        buttons, or the API.
      </p>
    </header>

    <!-- Tabs -->
    <div class="mb-5 border-b border-neutral-200">
      <nav class="-mb-px flex gap-6 text-sm">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="border-b-2 px-1 pb-2.5 font-medium transition"
          :class="active === t.key
            ? 'border-orange-600 text-orange-700'
            : 'border-transparent text-neutral-500 hover:text-neutral-900'"
          @click="active = t.key; showForm = false"
        >
          {{ t.label }}
          <span
            class="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600"
          >{{ byTab[t.key].length }}</span>
        </button>
      </nav>
    </div>

    <!-- Create form -->
    <form v-if="showForm" class="mb-6 rounded-xl border border-neutral-200 bg-white p-5" @submit.prevent="submit">
      <div class="mb-3 text-sm font-semibold">New {{ KIND_LABEL[formKind] }}</div>

      <label class="block">
        <span class="block text-xs font-medium text-neutral-600">Name</span>
        <input
          v-model="formName"
          type="text"
          required
          class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          :placeholder="formKind === 'webhook' ? 'e.g. Notify Slack' : formKind === 'code_block' ? 'e.g. Convert °C to °F' : 'Name'"
        />
      </label>

      <label v-if="formKind === 'webhook'" class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600">Target URL</span>
        <input
          v-model="formWebhookUrl"
          type="url"
          required
          placeholder="https://hooks.example.com/…"
          class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
        />
      </label>

      <label v-else-if="formKind === 'code_block'" class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600">Source (JavaScript)</span>
        <textarea
          v-model="formCode"
          rows="8"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100"
        />
      </label>

      <label v-else class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600">Config (JSON)</span>
        <textarea
          v-model="formServiceConfig"
          rows="6"
          class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
        />
      </label>

      <p v-if="formError" class="mt-2 text-xs text-red-600">{{ formError }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
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
          <p class="mt-0.5 text-xs text-neutral-500">
            POST device events, metric updates, or automation runs to an external URL.
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          @click="openCreate('webhook')"
        >Add webhook</button>
      </div>

      <ul v-if="byTab.webhooks.length > 0" class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        <li v-for="i in byTab.webhooks" :key="i.id" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ i.name }}</span>
              <span
                v-if="!i.enabled"
                class="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600"
              >disabled</span>
            </div>
            <div class="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500"
                :title="webhookUrl(i)"
              >{{ webhookUrl(i) }}</span>
              <button
                type="button"
                class="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                :title="copiedId === i.id ? 'Copied' : 'Copy URL'"
                @click="copyUrl(i)"
              >
                <svg v-if="copiedId !== i.id" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
                  <path d="M9 4h7a2 2 0 0 1 2 2v10M8 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H8Z" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-emerald-600">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </button>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
              @click="toggle(i)"
            >{{ i.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
              @click="remove(i)"
            >Delete</button>
          </div>
        </li>
      </ul>
      <div v-else class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-xs text-neutral-500">
        No webhooks yet.
      </div>
    </section>

    <!-- Code blocks tab -->
    <section v-else-if="active === 'code'">
      <div class="mb-4 flex items-end justify-between">
        <div>
          <h2 class="text-sm font-semibold">Code blocks</h2>
          <p class="mt-0.5 text-xs text-neutral-500">
            Snippets of JavaScript invoked as automation actions. Runtime is on the roadmap.
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          @click="openCreate('code_block')"
        >New code block</button>
      </div>

      <ul v-if="byTab.code.length > 0" class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        <li v-for="i in byTab.code" :key="i.id" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{{ i.name }}</div>
            <div class="mt-0.5 truncate font-mono text-[11px] text-neutral-500">{{ i.id }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
              @click="toggle(i)"
            >{{ i.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
              @click="remove(i)"
            >Delete</button>
          </div>
        </li>
      </ul>
      <div v-else class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-xs text-neutral-500">
        No code blocks yet.
      </div>
    </section>

    <!-- Services tab -->
    <section v-else>
      <div class="mb-4">
        <h2 class="text-sm font-semibold">Services</h2>
        <p class="mt-0.5 text-xs text-neutral-500">
          Connectors for common destinations. Configure once, reference from automations.
        </p>
      </div>

      <ul v-if="byTab.services.length > 0" class="mb-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        <li v-for="i in byTab.services" :key="i.id" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ i.name }}</span>
              <span class="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                {{ KIND_LABEL[i.kind] }}
              </span>
              <span
                v-if="!i.enabled"
                class="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600"
              >disabled</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
              @click="toggle(i)"
            >{{ i.enabled ? 'Disable' : 'Enable' }}</button>
            <button
              type="button"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
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
          class="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-orange-300 hover:shadow-sm"
          @click="openCreate(svc.kind)"
        >
          <div>
            <div class="text-sm font-semibold text-neutral-900">{{ KIND_LABEL[svc.kind] }}</div>
            <div class="mt-0.5 text-xs text-neutral-500">{{ svc.desc }}</div>
          </div>
          <span class="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-orange-700">Add</span>
        </button>
      </div>
    </section>
  </div>
</template>
