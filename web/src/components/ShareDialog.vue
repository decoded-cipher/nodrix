<script setup lang="ts">
// Share dialog for a dashboard. Toggles public visibility, shows the read-only
// share link, provides iframe embed snippets (whole dashboard or a single
// widget), and sets the viewer auto-refresh cadence. The token is part of the
// URL (a capability), so it's safe to display and re-copy. All mutations go
// through the project store; we also emit `change` so a parent holding its own
// copy of the dashboard can stay in sync.

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
    refreshSecs.value = prev; // roll back the select on failure
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
  return title ? `${title} · ${type}` : `${type} · ${w.id}`;
}
const widgetOptions = computed(() => widgets.value.map((w) => ({ value: w.id, label: widgetLabel(w) })));

// Embed builder: one code box that targets the whole dashboard or a single widget.
const embedMode = ref<'dashboard' | 'widget'>('dashboard');
const activeEmbedCode = computed(() => (embedMode.value === 'widget' ? widgetEmbedCode.value : embedCode.value));

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

// Inline copy feedback: the clicked button flips to "Copied" for a beat.
const copied = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(text: string, key: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = null), 1500);
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
    <div class="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
      <!-- Header -->
      <header class="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold leading-tight text-neutral-900 dark:text-neutral-100">Share dashboard</h2>
          <p class="mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400">{{ dashboard.name }}</p>
        </div>
        <button
          type="button"
          class="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Close"
          @click="emit('close')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <!-- Public access -->
        <div class="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3.5 py-2.5 dark:border-neutral-800">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Public access</span>
              <span
                v-if="isPublic"
                class="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
              >
                <span class="relative flex h-1.5 w-1.5">
                  <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                </span>
                Live
              </span>
            </div>
            <p class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ isPublic ? 'Anyone with the link can view — read-only.' : 'Only project members can open this dashboard.' }}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="isPublic"
            :disabled="busy"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50"
            :class="isPublic ? 'bg-accent-600' : 'bg-neutral-300 dark:bg-neutral-700'"
            @click="isPublic ? disable() : enable()"
          >
            <span
              class="inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition"
              :class="isPublic ? 'translate-x-5' : 'translate-x-0.5'"
            ></span>
          </button>
        </div>

        <template v-if="isPublic && token">
          <!-- 1. Share link (primary) -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Share link</label>
            <div class="flex gap-2">
              <input
                :value="shareUrl"
                readonly
                class="min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-700 focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button
                type="button"
                class="inline-flex w-[68px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-700"
                @click="copy(shareUrl, 'link')"
              >
                <svg v-if="copied === 'link'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M20 6 9 17l-5-5" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V4a2 2 0 0 1 2-2h10" /></svg>
                {{ copied === 'link' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>

          <!-- 2. Embed -->
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Embed</label>
              <div class="inline-flex items-center rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-800">
                <button
                  type="button"
                  class="rounded px-2 py-0.5 text-xs transition"
                  :class="embedMode === 'dashboard' ? 'bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
                  @click="embedMode = 'dashboard'"
                >Whole dashboard</button>
                <button
                  v-if="widgets.length"
                  type="button"
                  class="rounded px-2 py-0.5 text-xs transition"
                  :class="embedMode === 'widget' ? 'bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
                  @click="embedMode = 'widget'"
                >Single widget</button>
              </div>
            </div>

            <Dropdown
              v-if="embedMode === 'widget' && widgets.length"
              v-model="selectedItem"
              :options="widgetOptions"
              size="sm"
              placeholder="Choose a widget"
            />

            <textarea
              :value="activeEmbedCode"
              readonly
              rows="2"
              class="w-full resize-none rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-600 focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300"
              @focus="($event.target as HTMLTextAreaElement).select()"
            ></textarea>
            <button
              type="button"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              @click="copy(activeEmbedCode, 'embed')"
            >
              <svg v-if="copied === 'embed'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M20 6 9 17l-5-5" /></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V4a2 2 0 0 1 2-2h10" /></svg>
              {{ copied === 'embed' ? 'Copied embed code' : 'Copy embed code' }}
            </button>
          </div>

          <!-- 3. Auto-refresh (a setting — lives below the actions) -->
          <div class="flex items-center justify-between gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <div class="min-w-0">
              <div class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Auto-refresh</div>
              <p class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                {{ savingRefresh ? 'Saving…' : 'How often the public dashboard refreshes.' }}
              </p>
            </div>
            <Dropdown
              class="w-40 shrink-0"
              :model-value="refreshSecs"
              :options="refreshOptions"
              size="sm"
              @update:model-value="(v) => { if (typeof v === 'number') void setRefresh(v); }"
            />
          </div>

          <p class="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Turning off public access disables the link. Re-enabling generates a new one.
          </p>
        </template>

        <!-- Private: empty state -->
        <div v-else class="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center dark:border-neutral-800">
          <span class="mx-auto grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
              <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
            </svg>
          </span>
          <p class="mx-auto mt-2.5 max-w-[16rem] text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Turn on public access to get a shareable link and embed code.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
