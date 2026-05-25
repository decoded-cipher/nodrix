<script setup lang="ts">
// Share dialog for a dashboard. Toggles public visibility, shows the read-only
// share link, and provides iframe embed snippets for the whole dashboard or a
// single widget. The token is part of the URL (a capability), so it's safe to
// display and re-copy. All mutations go through the project store; we also emit
// `change` so a parent holding its own copy of the dashboard can stay in sync.

import { computed, onMounted, ref } from 'vue';
import { useProjectStore } from '../stores/project';
import { toast } from '../lib/toast';
import { confirm } from '../lib/confirm';
import Dropdown from './Dropdown.vue';
import type { Layout, WidgetInstance } from '../types';

const props = defineProps<{
  dashboard: { id: string; name: string; visibility?: 'private' | 'public'; share_token?: string | null };
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'change', next: { visibility: 'private' | 'public'; share_token: string | null }): void;
}>();

const project = useProjectStore();

const isPublic = ref(props.dashboard.visibility === 'public');
const token = ref<string | null>(props.dashboard.share_token ?? null);
const busy = ref(false);

// Widgets for the per-widget embed picker. Loaded lazily from the layout.
const widgets = ref<WidgetInstance[]>([]);
const selectedItem = ref<string>('');

// Full layout + version, kept so we can persist the refresh setting back.
const dashLayout = ref<Layout | null>(null);
const dashUpdatedAt = ref<number>(0);

// Auto-refresh cadence for the shared view. Persisted server-side in the layout
// (clamped there) and delivered to viewers via the API — never a URL param — so
// it can't be tampered with to make viewers poll faster.
const refreshSecs = ref<number>(5);
const savingRefresh = ref(false);
const refreshOptions = [
  { value: 5, label: 'Every 5 seconds' },
  { value: 10, label: 'Every 10 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
];
async function setRefresh(v: number) {
  if (!dashLayout.value || v === refreshSecs.value) return;
  const prev = refreshSecs.value;
  refreshSecs.value = v;
  savingRefresh.value = true;
  try {
    const updated = await project.saveDashboard(
      props.dashboard.id,
      { ...dashLayout.value, refresh: v },
      dashUpdatedAt.value
    );
    dashLayout.value = updated.layout;
    dashUpdatedAt.value = updated.updated_at;
    refreshSecs.value = updated.layout.refresh ?? v;
  } catch (e) {
    refreshSecs.value = prev; // roll back the dropdown on failure
    toast.error((e as Error).message);
  } finally {
    savingRefresh.value = false;
  }
}

const origin = typeof window !== 'undefined' ? window.location.origin : '';
const shareUrl = computed(() => (token.value ? `${origin}/share/${token.value}` : ''));
const embedUrl = computed(() => (token.value ? `${origin}/embed/${token.value}` : ''));
const widgetEmbedUrl = computed(() =>
  token.value && selectedItem.value ? `${embedUrl.value}?item=${encodeURIComponent(selectedItem.value)}` : ''
);

function iframe(src: string, height: number): string {
  return `<iframe src="${src}" width="100%" height="${height}" frameborder="0" style="border:0" loading="lazy"></iframe>`;
}
const embedCode = computed(() => (embedUrl.value ? iframe(embedUrl.value, 600) : ''));
const widgetEmbedCode = computed(() => (widgetEmbedUrl.value ? iframe(widgetEmbedUrl.value, 240) : ''));

function widgetLabel(w: WidgetInstance): string {
  const title = typeof w.props['title'] === 'string' ? w.props['title'] : '';
  const type = w.type.replace(/^iot-/, '');
  return title ? `${title} (${type})` : `${type} · ${w.id}`;
}

const widgetOptions = computed(() => widgets.value.map((w) => ({ value: w.id, label: widgetLabel(w) })));

onMounted(async () => {
  try {
    const d = await project.fetchDashboard(props.dashboard.id);
    dashLayout.value = d.layout;
    dashUpdatedAt.value = d.updated_at;
    refreshSecs.value = d.layout.refresh ?? 5;
    widgets.value = d.layout.items;
    if (widgets.value[0]) selectedItem.value = widgets.value[0].id;
  } catch {
    // Non-fatal: the per-widget picker just stays empty.
  }
});

async function enable() {
  busy.value = true;
  try {
    const s = await project.shareDashboard(props.dashboard.id);
    isPublic.value = true;
    token.value = s.share_token;
    emit('change', { visibility: s.visibility, share_token: s.share_token });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function disable() {
  const ok = await confirm({
    title: 'Stop sharing this dashboard?',
    message: 'The public link will stop working immediately. Anyone who has it will lose access.',
    confirmLabel: 'Stop sharing',
  });
  if (!ok) return;
  busy.value = true;
  try {
    const s = await project.unshareDashboard(props.dashboard.id);
    isPublic.value = false;
    token.value = null;
    emit('change', { visibility: s.visibility, share_token: s.share_token });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function copy(text: string, what: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Could not copy to clipboard');
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4 dark:bg-black/70"
    @click.self="emit('close')"
    @keydown="onKey"
  >
    <div class="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
      <header class="flex items-center justify-between border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
        <div>
          <div class="text-sm font-semibold">Share “{{ dashboard.name }}”</div>
          <div class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">Public dashboards are read-only.</div>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label="Close"
          @click="emit('close')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="space-y-4 px-5 py-4">
        <!-- Public toggle -->
        <div class="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
          <div>
            <div class="text-sm font-medium">Public access</div>
            <div class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Anyone with the link can view this dashboard.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="isPublic"
            :disabled="busy"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50"
            :class="isPublic ? 'bg-accent-600' : 'bg-neutral-300 dark:bg-neutral-700'"
            @click="isPublic ? disable() : enable()"
          >
            <span
              class="inline-block h-5 w-5 transform rounded-full bg-white transition"
              :class="isPublic ? 'translate-x-5' : 'translate-x-0.5'"
            ></span>
          </button>
        </div>

        <template v-if="isPublic && token">
          <!-- Auto-refresh: how often the shared/embedded view fetches new data.
               Saved on the dashboard so viewers can't change it. -->
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Auto-refresh</span>
            <Dropdown
              class="mt-1"
              :model-value="refreshSecs"
              :options="refreshOptions"
              size="sm"
              @update:model-value="(v) => { if (typeof v === 'number') void setRefresh(v); }"
            />
            <p class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ savingRefresh ? 'Saving…' : 'How often viewers fetch new data.' }}
            </p>
          </label>

          <!-- Share link -->
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Share link</span>
            <div class="mt-1 flex gap-2">
              <input
                :value="shareUrl"
                readonly
                class="flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button
                type="button"
                class="rounded-md bg-accent-600 px-3 py-2 text-xs font-semibold text-white hover:bg-accent-700"
                @click="copy(shareUrl, 'Link')"
              >Copy</button>
            </div>
          </label>

          <!-- Embed whole dashboard -->
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Embed dashboard</span>
            <div class="mt-1 flex gap-2">
              <input
                :value="embedCode"
                readonly
                class="flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                @click="copy(embedCode, 'Embed code')"
              >Copy</button>
            </div>
          </label>

          <!-- Embed single widget -->
          <label v-if="widgets.length" class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Embed a single widget</span>
            <div class="mt-1 flex flex-col gap-2 sm:flex-row">
              <Dropdown
                v-model="selectedItem"
                :options="widgetOptions"
                size="sm"
                class="w-full shrink-0 sm:w-40"
              />
              <input
                :value="widgetEmbedCode"
                readonly
                class="flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                @click="copy(widgetEmbedCode, 'Embed code')"
              >Copy</button>
            </div>
          </label>

          <p class="border-t border-neutral-100 pt-3 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Turning off public access disables the link. Re-enabling it generates a new one.
          </p>
        </template>

        <p v-else class="text-xs text-neutral-500 dark:text-neutral-400">
          Turn on public access to get a shareable link and embed code.
        </p>
      </div>
    </div>
  </div>
</template>
