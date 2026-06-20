<script setup lang="ts">
import { ref, shallowRef, computed, watch, nextTick } from 'vue';
import { Chat } from '@ai-sdk/vue';
import { DefaultChatTransport, isToolUIPart, getToolName, type UIMessage } from 'ai';
import { useUiStore } from '../../stores/ui';
import { api } from '../../api';
import { toast } from '../../lib/toast';

const ui = useUiStore();
const open = ref(false);
const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

const projectId = computed(() => ui.currentProject?.id ?? null);

// Tools that require a confirmation card before they run — a mirror of the
// worker's WRITE_TOOLS keys. Read tools execute server-side and never appear in
// an unresolved (input-available) state on the client.
const CONFIRMABLE = new Set([
  'create_variable', 'update_variable', 'set_variable',
  'create_dashboard', 'update_dashboard', 'add_widget', 'update_widget',
  'create_automation', 'update_automation', 'run_automation', 'emit_event',
  'create_integration', 'update_integration', 'test_integration',
]);

const chat = shallowRef<Chat<UIMessage> | null>(null);

function makeChat(pid: string): Chat<UIMessage> {
  return new Chat<UIMessage>({
    transport: new DefaultChatTransport({ api: `/v1/admin/projects/${pid}/chat`, credentials: 'include' }),
  });
}

// Conversations are project-scoped: rebuild (and clear) when the project changes.
watch(projectId, (pid) => { chat.value = pid ? makeChat(pid) : null; }, { immediate: true });

const messages = computed<UIMessage[]>(() => chat.value?.messages ?? []);
const status = computed(() => chat.value?.status ?? 'ready');
const busy = computed(() => status.value === 'submitted' || status.value === 'streaming');

function send() {
  const text = input.value.trim();
  if (!text || !chat.value || busy.value) return;
  input.value = '';
  void chat.value.sendMessage({ text });
  scrollSoon();
}

function scrollSoon() {
  nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; });
}
watch(messages, scrollSoon, { deep: true });

watch(open, (o) => { if (o) nextTick(() => inputEl.value?.focus()); });

// ── Part helpers (templates stay readable) ──────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function isText(p: any): boolean { return p?.type === 'text'; }
function isTool(p: any): boolean { return isToolUIPart(p); }
function tName(p: any): string { return getToolName(p); }
function tResolved(p: any): boolean { return p.state === 'output-available' || p.state === 'output-error'; }
function tNeedsConfirm(p: any): boolean { return CONFIRMABLE.has(tName(p)) && p.state === 'input-available'; }
function tDeclined(p: any): boolean { return tResolved(p) && !!(p.output as any)?.declined; }
function tErrored(p: any): boolean { return p.state === 'output-error' || !!(p.output as any)?.error; }
function pretty(v: unknown): string { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
/* eslint-enable @typescript-eslint/no-explicit-any */

const applying = ref<string | null>(null);

async function approve(p: { toolCallId: string; input?: unknown } & Record<string, unknown>) {
  if (!chat.value || !projectId.value) return;
  const tool = getToolName(p as never);
  applying.value = p.toolCallId;
  try {
    const res = await api.post<{ ok: boolean; result: unknown }>(
      `/v1/admin/projects/${projectId.value}/chat/apply`,
      { tool, input: p.input ?? {} }
    );
    chat.value.addToolResult({ tool, toolCallId: p.toolCallId, output: res.result });
    toast.success('Operation applied');
  } catch (e) {
    chat.value.addToolResult({ tool, toolCallId: p.toolCallId, output: { error: (e as Error).message } });
    toast.error((e as Error).message);
  } finally {
    applying.value = null;
  }
}

function decline(p: { toolCallId: string } & Record<string, unknown>) {
  if (!chat.value) return;
  chat.value.addToolResult({ tool: getToolName(p as never), toolCallId: p.toolCallId, output: { declined: true } });
}
</script>

<template>
  <Teleport to="body">
    <!-- Launcher -->
    <button
      v-if="!open"
      type="button"
      aria-label="Open AI assistant"
      class="fixed bottom-4 right-4 z-[100] grid h-12 w-12 place-items-center rounded-full bg-accent-600 text-white shadow-lg transition hover:bg-accent-700"
      @click="open = true"
    >
      <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </svg>
    </button>

    <!-- Panel -->
    <div
      v-else
      class="fixed bottom-4 right-4 z-[100] flex h-[60vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl sm:h-[34rem] sm:w-96 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <!-- Header -->
      <header class="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div class="flex items-center gap-2">
          <span class="grid h-7 w-7 place-items-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
            </svg>
          </span>
          <div class="text-sm font-semibold">Assistant</div>
          <span class="truncate text-xs text-neutral-400">{{ ui.currentProject?.name }}</span>
        </div>
        <button
          type="button"
          aria-label="Close"
          class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="open = false"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <!-- Messages -->
      <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        <div v-if="!projectId" class="mt-8 text-center text-xs text-neutral-500">
          Select or create a project to use the assistant.
        </div>
        <div v-else-if="messages.length === 0" class="mt-8 text-center text-xs text-neutral-500">
          Ask about your project, or describe an automation, dashboard, or integration to create.
          Changes are previewed for your approval before anything is applied.
        </div>

        <div v-for="m in messages" :key="m.id" class="flex" :class="m.role === 'user' ? 'justify-end' : 'justify-start'">
          <div
            class="max-w-[85%] space-y-2"
            :class="m.role === 'user' ? 'rounded-lg bg-accent-600 px-3 py-2 text-white' : 'w-full'"
          >
            <template v-for="(p, i) in m.parts" :key="i">
              <!-- Text -->
              <div v-if="isText(p)" class="whitespace-pre-wrap break-words" :class="m.role === 'assistant' ? 'text-neutral-800 dark:text-neutral-200' : ''">{{ (p as any).text }}</div>

              <!-- Write proposal → confirm card -->
              <div
                v-else-if="isTool(p) && tNeedsConfirm(p)"
                class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30"
              >
                <div class="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
                  Proposed: <span class="font-mono">{{ tName(p) }}</span>
                </div>
                <pre class="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 font-mono text-[11px] text-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300">{{ pretty((p as any).input) }}</pre>
                <div class="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    :disabled="applying === (p as any).toolCallId"
                    @click="decline(p as any)"
                  >Decline</button>
                  <button
                    type="button"
                    class="rounded-md bg-accent-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
                    :disabled="applying === (p as any).toolCallId"
                    @click="approve(p as any)"
                  >{{ applying === (p as any).toolCallId ? 'Applying…' : 'Approve' }}</button>
                </div>
              </div>

              <!-- Resolved write -->
              <div
                v-else-if="isTool(p) && CONFIRMABLE.has(tName(p)) && tResolved(p)"
                class="flex items-center gap-1.5 text-xs"
                :class="tDeclined(p) ? 'text-neutral-500' : tErrored(p) ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'"
              >
                <span class="font-mono">{{ tName(p) }}</span>
                <span>· {{ tDeclined(p) ? 'declined' : tErrored(p) ? 'failed' : 'applied' }}</span>
              </div>

              <!-- Read tool activity (muted) -->
              <div v-else-if="isTool(p)" class="flex items-center gap-1.5 text-xs text-neutral-400">
                <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <span class="font-mono">{{ tName(p) }}</span>
              </div>
            </template>
          </div>
        </div>

        <div v-if="busy" class="flex items-center gap-1.5 text-xs text-neutral-400">
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
          Thinking…
        </div>
        <div v-if="status === 'error'" class="text-xs text-red-600 dark:text-red-400">
          Something went wrong. Check the assistant settings or try again.
        </div>
      </div>

      <!-- Composer -->
      <form class="border-t border-neutral-100 p-3 dark:border-neutral-800" @submit.prevent="send">
        <div class="flex items-end gap-2">
          <textarea
            ref="inputEl"
            v-model="input"
            rows="1"
            placeholder="Ask or describe a change…"
            :disabled="!projectId"
            class="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            @keydown.enter.exact.prevent="send"
          />
          <button
            type="submit"
            :disabled="!input.trim() || busy || !projectId"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-40"
            aria-label="Send"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
