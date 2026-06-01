<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VueFlow, useVueFlow, type Connection, type Edge } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import { TRIGGER_CATALOG, ACTION_CATALOG, graphError, buildLinearGraph } from '@nodrix/blocks-shared';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import Icon from '../../../components/Icon.vue';
import Spinner from '../../../components/Spinner.vue';
import BlockNode from './BlockNode.vue';
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
  toObject, findNode, setNodes, setEdges, getEdges,
} = useVueFlow();

const name = ref('');
const description = ref('');
const loading = ref(!!editId.value);
const saving = ref(false);
const notFound = ref(false);
const selectedId = ref<string | null>(null);
let placed = 0;

const selectedNode = computed(() => (selectedId.value ? findNode(selectedId.value) : undefined));
const canSave = computed(() => !!name.value.trim() && !saving.value);

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

async function init() {
  if (!project.currentProjectId) return;
  await Promise.all([
    project.variables.length ? Promise.resolve() : project.loadVariables(),
    project.loadIntegrations(),
  ]);

  if (recipeId) {
    const r = recipeById(recipeId);
    if (r) {
      name.value = r.name;
      const { nodes, edges } = graphToFlow(buildLinearGraph(r.trigger_type, r.trigger_config ?? {}, r.actions ?? []));
      setNodes(nodes);
      setEdges(edges);
      placed = nodes.length;
    }
    return;
  }

  if (editId.value) {
    let a = project.automations.find((x) => x.id === editId.value);
    if (!a) { await project.loadAutomations(); a = project.automations.find((x) => x.id === editId.value); }
    if (a) {
      name.value = a.name;
      description.value = a.description ?? '';
      const { nodes, edges } = automationToFlow(a);
      setNodes(nodes);
      setEdges(edges);
      placed = nodes.length;
    } else {
      notFound.value = true;
    }
    loading.value = false;
  }
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
  const n = name.value.trim();
  if (!n) return;
  const obj = toObject();
  const graph = flowToGraph(obj.nodes as FlowNode[], obj.edges as Edge[]);
  for (const node of graph.nodes) if ('value' in node.config) node.config['value'] = coerce(node.config['value']);

  const err = graphError(graph);
  if (err) { toast.error(err); return; }

  saving.value = true;
  try {
    if (editId.value) {
      await project.updateAutomation(editId.value, { name: n, description: description.value.trim() || null, graph });
    } else {
      await project.createAutomation({ name: n, description: description.value.trim() || null, graph });
    }
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
    <!-- Topbar actions: name + Done/Save, teleported into the shell topbar. -->
    <Teleport to="#topbar-actions" defer>
      <input
        v-model="name"
        type="text"
        placeholder="Automation name"
        class="w-40 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 sm:w-52"
      />
      <input
        v-model="description"
        type="text"
        placeholder="Description"
        class="hidden w-56 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm md:block dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="backToList"
      >Done</button>
      <button
        class="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        :disabled="!canSave"
        @click="save"
      >{{ saving ? 'Saving…' : editId ? 'Save' : 'Create' }}</button>
    </Teleport>

    <!-- Palette -->
    <aside class="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
        <span class="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Blocks</span>
      </div>
      <div class="flex-1 overflow-y-auto p-3">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Triggers</h3>
        <button v-for="t in TRIGGER_CATALOG" :key="t.kind" type="button" class="mb-1.5 flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:border-accent-300 dark:border-neutral-700 dark:hover:border-accent-700" @click="addBlock(t.kind)">
          <Icon :path="t.icon" class="h-4 w-4 text-accent-600 dark:text-accent-400" /> {{ t.label }}
        </button>
        <h3 class="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Actions</h3>
        <button v-for="a in ACTION_CATALOG" :key="a.kind" type="button" class="mb-1.5 flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:border-accent-300 dark:border-neutral-700 dark:hover:border-accent-700" @click="addBlock(a.kind)">
          <Icon :path="a.icon" class="h-4 w-4 text-neutral-500" /> {{ a.label }}
        </button>
      </div>
    </aside>

    <!-- Canvas + floating inspector -->
    <div class="relative flex-1">
      <div v-if="loading" class="grid h-full place-items-center"><Spinner /></div>
      <div v-else-if="notFound" class="grid h-full place-items-center text-sm text-neutral-500 dark:text-neutral-400">Automation not found.</div>

      <div v-else class="canvas-dots h-full w-full">
        <VueFlow :is-valid-connection="isValidConnection" :default-edge-options="{ animated: true }" fit-view-on-init class="h-full w-full">
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
</style>
