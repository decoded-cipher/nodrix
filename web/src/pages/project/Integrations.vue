<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

type TabKey = 'webhooks' | 'code' | 'services';

type Tab = { key: TabKey; label: string; count?: number };
const tabs: Tab[] = [
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'code', label: 'Code blocks' },
  { key: 'services', label: 'Services' },
];

const active = ref<TabKey>('webhooks');
const route = useRoute();
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Integrations</h1>
      <p class="mt-1 text-sm text-neutral-600">
        Reusable connectors to the outside world. Trigger them manually, from a dashboard button,
        from the API, or as the action of an
        <RouterLink
          :to="route.path.replace('/integrations', '/automations')"
          class="text-orange-700 hover:underline"
        >automation</RouterLink>.
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
          @click="active = t.key"
        >
          {{ t.label }}
          <span
            v-if="typeof t.count === 'number'"
            class="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600"
          >{{ t.count }}</span>
        </button>
      </nav>
    </div>

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
          disabled
          class="cursor-not-allowed rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white opacity-60"
        >Add webhook</button>
      </div>

      <div class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
        <div class="mx-auto grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-500">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
            <path d="M9 16.5a4.5 4.5 0 1 1 6.364-6.364l1.06-1.06a4.5 4.5 0 1 1 1.061 1.06l-7.07 7.071a4.5 4.5 0 0 1-1.415-7.778M12 12.75v6.75" />
          </svg>
        </div>
        <h3 class="mt-4 text-sm font-semibold">No webhooks yet</h3>
        <p class="mx-auto mt-2 max-w-md text-xs text-neutral-500">
          Define a target URL once, then call it from automations, dashboard buttons, or the API.
          Useful for piping data into Zapier, Slack, your own backend, etc.
        </p>
      </div>
    </section>

    <!-- Code blocks tab -->
    <section v-else-if="active === 'code'">
      <div class="mb-4 flex items-end justify-between">
        <div>
          <h2 class="text-sm font-semibold">Code blocks</h2>
          <p class="mt-0.5 text-xs text-neutral-500">
            Small snippets of JavaScript (or Python) run in a sandboxed Worker. Receive an event
            payload, do arbitrary logic, return a result.
          </p>
        </div>
        <button
          type="button"
          disabled
          class="cursor-not-allowed rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white opacity-60"
        >New code block</button>
      </div>

      <div class="rounded-lg border border-neutral-200 bg-white">
        <div class="border-b border-neutral-100 px-4 py-3">
          <div class="text-xs uppercase tracking-wide text-neutral-500">Example (preview)</div>
          <div class="mt-1 text-sm font-medium">Convert °C → °F</div>
        </div>
        <pre class="overflow-x-auto bg-neutral-950 px-4 py-3 text-[12px] leading-relaxed text-neutral-100"><code>// Triggered by: metric update on device "thermo-1"
// Output is forwarded to the next automation step.

export default function (event) {
  const c = event.value;
  return { value: (c * 9) / 5 + 32, unit: '°F' };
}</code></pre>
      </div>

      <p class="mt-4 text-xs text-neutral-500">
        Runtime is on the roadmap — JavaScript first, Python via Pyodide later.
      </p>
    </section>

    <!-- Services tab -->
    <section v-else>
      <div class="mb-4">
        <h2 class="text-sm font-semibold">Pre-built services</h2>
        <p class="mt-0.5 text-xs text-neutral-500">
          One-click connectors for common destinations. Authenticate once, use as an automation
          action everywhere.
        </p>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="svc in [
            { name: 'Slack', desc: 'Post to a channel' },
            { name: 'Email', desc: 'Send a templated email' },
            { name: 'MQTT', desc: 'Publish to a broker' },
            { name: 'Telegram', desc: 'Send a chat message' },
            { name: 'PagerDuty', desc: 'Open or resolve incidents' },
            { name: 'InfluxDB', desc: 'Forward telemetry points' },
          ]"
          :key="svc.name"
          class="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4"
        >
          <div>
            <div class="text-sm font-semibold text-neutral-900">{{ svc.name }}</div>
            <div class="mt-0.5 text-xs text-neutral-500">{{ svc.desc }}</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">Soon</span>
        </div>
      </div>
    </section>
  </div>
</template>
