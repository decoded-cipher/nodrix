<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { useProjectStore } from '../../stores/project';

const session = useSessionStore();
const project = useProjectStore();
const router = useRouter();

const current = computed(() => session.projects.find((p) => p.id === project.currentProjectId));
const canDelete = computed(() => session.projects.length > 1);

const form = ref({
  name: '',
  description: '',
  icon: '',
  color: '',
});
const saving = ref(false);
const saved = ref(false);

const COLOR_SWATCHES = ['#f97316', '#ef4444', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#64748b'];

watch(
  current,
  (p) => {
    if (!p) return;
    form.value.name = p.name ?? '';
    form.value.description = p.description ?? '';
    form.value.icon = p.icon ?? '';
    form.value.color = p.color ?? '';
  },
  { immediate: true }
);

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    await project.updateProject({
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      icon: form.value.icon.trim() || null,
      color: form.value.color.trim() || null,
    });
    // Reload from /v1/admin/me so the sidebar + Projects page see the new values.
    await session.load();
    saved.value = true;
  } finally {
    saving.value = false;
  }
}

async function deleteProject() {
  if (!current.value) return;
  const deviceCount = project.devices.length;
  const dashboardCount = project.dashboards.length;
  const msg =
    `Permanently delete project "${current.value.name}"?\n\n` +
    `This removes:\n` +
    `  • ${dashboardCount} dashboard${dashboardCount === 1 ? '' : 's'}\n` +
    `  • ${deviceCount} device${deviceCount === 1 ? '' : 's'} (tokens stop working immediately)\n` +
    `  • All telemetry history for those devices\n` +
    `  • All API tokens scoped to this project\n\n` +
    `This cannot be undone.`;
  if (!confirm(msg)) return;
  await session.deleteProject(current.value.id);
  router.replace('/');
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Project settings</h2>

    <section class="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
      <div class="mb-3 text-sm font-medium">Details</div>

      <label class="block">
        <span class="block text-xs font-medium text-neutral-600">Name</span>
        <input
          v-model="form.name"
          type="text"
          class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>

      <label class="mt-3 block">
        <span class="block text-xs font-medium text-neutral-600">Description</span>
        <textarea
          v-model="form.description"
          rows="2"
          class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          placeholder="What this project is for"
        />
      </label>

      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Icon (emoji or short label)</span>
          <input
            v-model="form.icon"
            type="text"
            maxlength="4"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="e.g. 🏠 or HQ"
          />
        </label>
        <div>
          <span class="block text-xs font-medium text-neutral-600">Color</span>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <button
              v-for="c in COLOR_SWATCHES"
              :key="c"
              type="button"
              class="h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-white"
              :style="{ backgroundColor: c }"
              :class="form.color === c ? 'ring-neutral-900' : 'ring-transparent'"
              @click="form.color = c"
            />
            <button
              v-if="form.color"
              type="button"
              class="text-xs text-neutral-500 hover:underline"
              @click="form.color = ''"
            >Clear</button>
          </div>
        </div>
      </div>

      <div class="mt-2 font-mono text-[11px] text-neutral-400">{{ current?.id }}</div>

      <div class="mt-4 flex items-center justify-end gap-3">
        <span v-if="saved" class="text-xs text-emerald-600">Saved.</span>
        <button
          type="button"
          :disabled="saving"
          class="rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          @click="save"
        >{{ saving ? 'Saving…' : 'Save changes' }}</button>
      </div>
    </section>

    <section class="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
      <div class="text-sm font-medium text-red-900">Danger zone</div>
      <p class="mt-1 text-xs text-red-800">
        Deletes all dashboards, devices, telemetry history (latest state, recent series,
        and cold storage), and API tokens scoped to this project. Cannot be undone.
      </p>
      <button
        :disabled="!canDelete"
        class="mt-3 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
        @click="deleteProject"
      >
        {{ canDelete ? 'Delete project' : 'Cannot delete the last project' }}
      </button>
    </section>
  </main>
</template>
