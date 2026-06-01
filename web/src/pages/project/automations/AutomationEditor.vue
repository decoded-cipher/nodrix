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
import {
  automationToFlow, flowToGraph, defaultConfig, newNodeId, wouldCycle, blockOf,
  type FlowNode,
} from './graph-edit';

const project = useProjectStore();
const route = useRoute();
const router = useRouter();

const editId = computed(() => (route.params['id'] as string | undefined) || null);

const {
  onConnect, addEdges, addNodes, removeNodes, onNodeClick, onPaneClick,
  toObject, findNode, setNodes, setEdges, getEdges,
} = useVueFlow();

const name = ref('');
const loading = ref(true);
const saving = ref(false);
const notFound = ref(false);
const selectedId = ref<string | null>(null);
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
  addNodes([{
    id,
    type: 'block',
    position: { x: 160 + (placed % 3) * 48, y: 48 + placed * 104 },
    data: { kind, config: defaultConfig(manifest) },
  }]);
  placed++;
  selectedId.value = id;
}

function deleteSelected() {
  if (!selectedId.value) return;
  removeNodes([selectedId.value]); // Vue Flow also drops connected edges
  selectedId.value = null;
}

watch(() => project.currentProjectId, init, { immediate: true });

// The editor only edits the flow graph; name/description are created and edited
// outside (on the Automations list), so it always opens an existing automation.
async function init() {
  if (!project.currentProjectId || !editId.value) return;
  await Promise.all([
    project.variables.length ? Promise.resolve() : project.loadVariables(),
    project.loadIntegrations(),
  ]);

  let a = project.automations.find((x) => x.id === editId.value);
  if (!a) { await project.loadAutomations(); a = project.automations.find((x) => x.id === editId.value); }
  if (a) {
    name.value = a.name;
    const { nodes, edges } = automationToFlow(a);
    setNodes(nodes);
    setEdges(edges);
    placed = nodes.length;
  } else {
    notFound.value = true;
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
  router.push({ name: 'automations' });
}

async function save() {
  if (!editId.value) return;
  const obj = toObject();
  const graph = flowToGraph(obj.nodes as FlowNode[], obj.edges as Edge[]);
  for (const node of graph.nodes) if ('value' in node.config) node.config['value'] = coerce(node.config['value']);

  const err = graphError(graph);
  if (err) { toast.error(err); return; }

  saving.value = true;
  try {
    await project.updateAutomation(editId.value, { graph });
    backToList();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="flex h-full">
    <!-- Topbar actions: automation name (read-only) + Done/Save, teleported into
         the shell topbar. Name/description are edited on the Automations list. -->
    <Teleport to="#topbar-actions" defer>
      <span v-if="name" class="mr-1 hidden max-w-[16rem] truncate text-sm font-medium text-neutral-700 sm:inline dark:text-neutral-300">{{ name }}</span>
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

    <!-- Palette -->
    <BlockPalette @add="addBlock" />

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

      <aside
        v-if="selectedNode && !loading"
        class="absolute right-4 top-4 bottom-4 z-30 flex w-[calc(100%-2rem)] max-w-[20rem] flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
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

      <p v-if="!loading && !notFound" class="pointer-events-none absolute bottom-4 left-4 z-10 max-w-xs text-xs text-neutral-400 dark:text-neutral-500">
        Add blocks from the left, drag between handles to connect, and click a block to configure it.
      </p>
    </div>
  </main>
</template>

<style scoped>
.canvas-dots {
  background-color: var(--canvas-bg);
  background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size: 16px 16px;
}

/* Connection handles: subtle accent dots by default, prominent on the selected
   node so clicking a block clearly reveals where to wire from/to. */
:deep(.vue-flow__handle) {
  width: 9px;
  height: 9px;
  background: var(--canvas-bg);
  border: 2px solid #ea580c;
  opacity: 0.5;
}
:deep(.vue-flow__node.selected .vue-flow__handle) {
  width: 12px;
  height: 12px;
  background: #ea580c;
  opacity: 1;
  box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.25);
}
</style>
