<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VueFlow, useVueFlow, type Connection, type Edge } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import { graphError } from '@nodrix/blocks-shared';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import Spinner from '../../../components/Spinner.vue';
import BlockNode from './BlockNode.vue';
import BlockPalette from './BlockPalette.vue';
import NodeInspector from './NodeInspector.vue';
import { recipeById } from './automation-recipes';
import {
  automationToFlow, graphToFlow, flowToGraph, defaultConfig, newNodeId, wouldCycle, blockOf,
  type FlowNode,
} from './graph-edit';

const project = useProjectStore();
const route = useRoute();
const router = useRouter();

const editId = computed(() => (route.params['id'] as string | undefined) || null);
const recipeId = (route.query['recipe'] as string | undefined) || null;

const {
  onConnect, addEdges, addNodes, removeNodes, onNodeClick, onPaneClick,
  toObject, findNode, setNodes, setEdges, getEdges, fitView, onNodesInitialized,
} = useVueFlow();

// Center the whole graph in the canvas once its nodes are measured (capped so a
// small graph isn't zoomed in). Runs once — adding blocks later won't re-frame.
let framed = false;
onNodesInitialized(() => {
  if (framed) return;
  framed = true;
  fitView({ padding: 0.25, maxZoom: 1 });
});

const loading = ref(true);
const saving = ref(false);
const notFound = ref(false);
const selectedId = ref<string | null>(null);
const paletteOpen = ref(false); // off-canvas blocks drawer (below lg)
let placed = 0;

const selectedNode = computed(() => (selectedId.value ? findNode(selectedId.value) : undefined));

onNodeClick(({ node }) => { selectedId.value = node.id; });
onPaneClick(() => { selectedId.value = null; });

onConnect((c: Connection) => {
  if (!c.source || !c.target || c.source === c.target) return;
  if (wouldCycle(getEdges.value, c.source, c.target)) {
    toast.error('That connection would create a loop.');
    return;
  }
  addEdges([{ ...c, id: `e_${c.source}_${c.target}_${c.sourceHandle ?? 'out'}` }]);
});

const isValidConnection = (c: Connection): boolean =>
  !!c.source && !!c.target && c.source !== c.target && !wouldCycle(getEdges.value, c.source, c.target);

function addBlock(kind: string) {
  const manifest = blockOf(kind);
  if (!manifest) return;
  const id = newNodeId();
  const prevId = selectedId.value;
  const prev = prevId ? findNode(prevId) : undefined;
  // Cascade each new block to the right and slightly down from the previous one
  // (a readable left→right diagonal, not stacked directly below or across).
  const position = prev
    ? { x: prev.position.x + 240, y: prev.position.y + 120 }
    : { x: 80 + placed * 240, y: 80 + placed * 120 };

  addNodes([{ id, type: 'block', position, data: { kind, config: defaultConfig(manifest) } }]);
  placed++;

  // Auto-wire from the selected node to the new block when the ports allow it.
  if (prev) {
    const out = blockOf((prev.data as { kind: string }).kind)?.ports.out?.[0];
    if (out && manifest.ports.in?.length && !wouldCycle(getEdges.value, prevId!, id)) {
      addEdges([{ id: `e_${prevId}_${id}_${out}`, source: prevId!, target: id, sourceHandle: out }]);
    }
  }
  selectedId.value = id;
  paletteOpen.value = false; // close the drawer on mobile so the new node shows (no-op on lg+)
}

function deleteSelected() {
  if (!selectedId.value) return;
  removeNodes([selectedId.value]); // Vue Flow also drops connected edges
  selectedId.value = null;
}

watch(() => project.currentProjectId, init, { immediate: true });

// The editor only builds the flow graph; name/description come from the list
// (modal → pending draft). It opens either an existing automation (editId) or a
// new, not-yet-saved draft — which persists only on Save.
async function init() {
  if (!project.currentProjectId) return;
  await Promise.all([
    project.variables.length ? Promise.resolve() : project.loadVariables(),
    project.loadIntegrations(),
  ]);

  if (editId.value) {
    let a = project.automations.find((x) => x.id === editId.value);
    if (!a) { await project.loadAutomations(); a = project.automations.find((x) => x.id === editId.value); }
    if (a) {
      const { nodes, edges } = automationToFlow(a);
      setNodes(nodes);
      setEdges(edges);
      placed = nodes.length;
    } else {
      notFound.value = true;
    }
    loading.value = false;
    return;
  }

  // New draft: must come through the create modal (pending draft set). Seed a
  // recipe graph if requested; otherwise start blank.
  if (!project.pendingAutomation) { router.replace({ name: 'automations' }); return; }
  const r = recipeId ? recipeById(recipeId) : null;
  if (r) {
    const { nodes, edges } = graphToFlow(r.graph);
    setNodes(nodes);
    setEdges(edges);
    placed = nodes.length;
  }
  loading.value = false;
}

// Coerce string config `value`s to number/boolean where unambiguous, matching how
// the engine compares and writes them.
function coerce(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '' || s === 'true' || s === 'false') return s === 'true' ? true : s === 'false' ? false : '';
  return Number.isNaN(Number(s)) ? s : Number(s);
}

function backToList() {
  project.pendingAutomation = null; // discard an unsaved draft
  router.push({ name: 'automations' });
}

async function save() {
  const obj = toObject();
  const graph = flowToGraph(obj.nodes as FlowNode[], obj.edges as Edge[]);
  for (const node of graph.nodes) if ('value' in node.config) node.config['value'] = coerce(node.config['value']);

  const err = graphError(graph);
  if (err) { toast.error(err); return; }

  saving.value = true;
  try {
    if (editId.value) {
      await project.updateAutomation(editId.value, { graph });
      backToList();
    } else {
      // First save of a new draft: create it now, then stay in the editor.
      const draft = project.pendingAutomation;
      if (!draft) { backToList(); return; }
      const a = await project.createAutomation({ name: draft.name, description: draft.description, graph });
      project.pendingAutomation = null;
      router.replace({ name: 'automation-editor', params: { id: a.id } });
    }
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="flex h-full">
    <!-- Topbar actions: Done/Save, teleported into the shell topbar. The name
         shows in the breadcrumb; name/description are edited on the list. -->
    <Teleport to="#topbar-actions" defer>
      <button
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="backToList"
      >Done</button>
      <button
        class="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >{{ saving ? 'Saving…' : 'Save' }}</button>
    </Teleport>

    <!-- Palette (off-canvas drawer below lg) -->
    <BlockPalette :open="paletteOpen" @add="addBlock" @close="paletteOpen = false" />

    <!-- Canvas + floating inspector -->
    <div class="relative flex-1">
      <div v-if="loading" class="grid h-full place-items-center"><Spinner /></div>
      <div v-else-if="notFound" class="grid h-full place-items-center text-sm text-neutral-500 dark:text-neutral-400">Automation not found.</div>

      <div v-else class="canvas-dots h-full w-full">
        <VueFlow
          :is-valid-connection="isValidConnection"
          :default-edge-options="{ animated: true }"
          :default-viewport="{ x: 48, y: 28, zoom: 1 }"
          :min-zoom="0.4"
          :max-zoom="1.75"
          class="h-full w-full"
        >
          <template #node-block="props">
            <BlockNode v-bind="props" />
          </template>
        </VueFlow>
      </div>

      <!-- Settings panel is desktop-only; on mobile you build structure and
           configure on desktop (same as the dashboard editor). -->
      <aside
        v-if="selectedNode && !loading"
        class="absolute right-4 top-4 bottom-4 z-30 hidden w-[calc(100%-2rem)] max-w-[20rem] flex-col rounded-lg border border-neutral-200 bg-white shadow-xl lg:flex dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div class="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Block settings</span>
          <div class="flex items-center gap-1">
            <button type="button" title="Remove block" class="rounded-md p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400" @click="deleteSelected">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            </button>
            <button type="button" title="Close" class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" @click="selectedId = null">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <NodeInspector :node="selectedNode.data" />
        </div>
      </aside>

      <p v-if="!loading && !notFound" class="pointer-events-none absolute bottom-4 left-4 z-10 hidden max-w-xs text-xs text-neutral-400 lg:block dark:text-neutral-500">
        Add blocks from the left, drag between handles to connect, and click a block to configure it.
      </p>

      <!-- Opens the blocks drawer (below lg). Pinned bottom-right, always on top
           so it stays reachable while panning the canvas. -->
      <button
        v-if="!loading && !notFound"
        type="button"
        class="absolute bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-accent-700 lg:hidden"
        @click="paletteOpen = true"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
        Blocks
      </button>
    </div>
  </main>
</template>

<style scoped>
.canvas-dots {
  background-color: var(--canvas-bg);
  background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size: 16px 16px;
}

/* Connection handles are hidden until a node is selected, then shown as plain
   dots (no highlight) so you can wire from/to it. */
:deep(.vue-flow__handle) {
  width: 8px;
  height: 8px;
  background: var(--canvas-bg);
  border: 1.5px solid rgb(163 163 163);
  opacity: 0;
  transition: opacity 120ms ease;
}
:deep(.vue-flow__node.selected .vue-flow__handle) {
  opacity: 1;
}

/* Animate the live connection line (while dragging) like committed edges. */
:deep(.vue-flow__connection-path) {
  stroke-dasharray: 5;
  animation: nodrix-dash 0.5s linear infinite;
}
@keyframes nodrix-dash {
  to { stroke-dashoffset: -10; }
}
</style>
