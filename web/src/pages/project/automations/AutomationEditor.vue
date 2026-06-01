<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VueFlow, useVueFlow, type Connection, type Edge } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import { TRIGGER_CATALOG, ACTION_CATALOG, graphError } from '@nodrix/blocks-shared';
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
import { buildLinearGraph } from '@nodrix/blocks-shared';

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
    position: { x: 140 + (placed % 3) * 40, y: 40 + placed * 96 },
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
    router.push({ name: 'automations' });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
    <button type="button" class="mb-4 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100" @click="router.push({ name: 'automations' })">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      Automations
    </button>

    <div v-if="loading" class="rounded-xl border border-neutral-200 bg-white p-10 dark:border-neutral-800 dark:bg-neutral-900"><Spinner block /></div>
    <div v-else-if="notFound" class="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      Automation not found.
    </div>

    <template v-else>
      <!-- Header -->
      <div class="mb-4 grid gap-3 sm:grid-cols-2">
        <input v-model="name" type="text" required placeholder="Automation name" class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
        <input v-model="description" type="text" placeholder="Description (optional)" class="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
      </div>

      <!-- Editor: palette | canvas | inspector -->
      <div class="grid h-[64vh] grid-cols-[180px_1fr_260px] gap-3">
        <!-- Palette -->
        <div class="overflow-y-auto rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Triggers</h3>
          <button v-for="t in TRIGGER_CATALOG" :key="t.kind" type="button" class="mb-1.5 flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:border-accent-300 dark:border-neutral-700 dark:hover:border-accent-700" @click="addBlock(t.kind)">
            <Icon :path="t.icon" class="h-4 w-4 text-accent-600 dark:text-accent-400" /> {{ t.label }}
          </button>
          <h3 class="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Actions</h3>
          <button v-for="a in ACTION_CATALOG" :key="a.kind" type="button" class="mb-1.5 flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:border-accent-300 dark:border-neutral-700 dark:hover:border-accent-700" @click="addBlock(a.kind)">
            <Icon :path="a.icon" class="h-4 w-4 text-neutral-500" /> {{ a.label }}
          </button>
        </div>

        <!-- Canvas -->
        <div class="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40">
          <VueFlow :is-valid-connection="isValidConnection" :default-edge-options="{ animated: true }" fit-view-on-init class="h-full w-full">
            <template #node-block="props">
              <BlockNode v-bind="props" />
            </template>
          </VueFlow>
        </div>

        <!-- Inspector -->
        <div class="overflow-y-auto rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <template v-if="selectedNode">
            <NodeInspector :node="selectedNode.data" />
            <button type="button" class="mt-4 w-full rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/40" @click="deleteSelected">Remove block</button>
          </template>
          <p v-else class="text-xs text-neutral-400 dark:text-neutral-500">
            Add blocks from the left, drag to connect them, and click a block to configure it.
          </p>
        </div>
      </div>

      <!-- Save bar -->
      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="router.push({ name: 'automations' })">Cancel</button>
        <button type="button" :disabled="saving || !name.trim()" class="rounded-md bg-accent-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50" @click="save">
          {{ saving ? 'Saving…' : editId ? 'Save changes' : 'Create automation' }}
        </button>
      </div>
    </template>
  </div>
</template>
