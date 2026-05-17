<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSessionStore } from '../../stores/session';

const session = useSessionStore();

onMounted(() => {
  if (!session.user) session.load();
});

const editing = ref(false);
const form = ref({ display_name: '', avatar_url: '' });
const saving = ref(false);
const saveError = ref<string | null>(null);
const previewBroken = ref(false);

watch(
  () => session.user,
  (u) => {
    if (!u) return;
    form.value.display_name = u.display_name ?? '';
    form.value.avatar_url = u.avatar_url ?? '';
  },
  { immediate: true }
);

const initials = computed(() => {
  const base = session.user?.display_name || session.user?.email || '';
  if (session.user?.display_name) {
    const parts = base.trim().split(/\s+/);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
  }
  return (base.split('@')[0] ?? '').slice(0, 2).toUpperCase();
});

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

function startEdit() {
  if (!session.user) return;
  form.value.display_name = session.user.display_name ?? '';
  form.value.avatar_url = session.user.avatar_url ?? '';
  saveError.value = null;
  previewBroken.value = false;
  editing.value = true;
}

function cancel() {
  editing.value = false;
  saveError.value = null;
}

async function save() {
  saving.value = true;
  saveError.value = null;
  try {
    await session.updateMe({
      display_name: form.value.display_name.trim() || null,
      avatar_url: form.value.avatar_url.trim() || null,
    });
    editing.value = false;
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Users</h1>
      <p class="mt-1 text-sm text-neutral-600">
        People with access to this deployment. Sign-in is handled by Cloudflare Access — invite
        users by adding them to your Access policy.
      </p>
    </header>

    <section class="rounded-lg border border-neutral-200 bg-white">
      <!-- Display row -->
      <div v-if="session.user && !editing" class="flex items-center justify-between px-4 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <img
            v-if="session.user.avatar_url"
            :src="session.user.avatar_url"
            :alt="session.user.email"
            class="h-10 w-10 shrink-0 rounded-full object-cover"
          />
          <div
            v-else
            class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700"
          >{{ initials }}</div>

          <div class="min-w-0">
            <div class="truncate text-sm font-medium">
              {{ session.user.display_name || session.user.email }}
            </div>
            <div v-if="session.user.display_name" class="truncate text-xs text-neutral-500">
              {{ session.user.email }}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
              <span>{{ session.user.role }}</span>
              <span>·</span>
              <span class="normal-case tracking-normal">last login: {{ fmt(session.user.last_login_at) }}</span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">You</span>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
            @click="startEdit"
          >Edit</button>
        </div>
      </div>

      <!-- Edit form -->
      <form v-else-if="session.user" class="space-y-3 px-4 py-4" @submit.prevent="save">
        <div class="flex items-center gap-3">
          <img
            v-if="form.avatar_url && !previewBroken"
            :src="form.avatar_url"
            alt="Avatar preview"
            class="h-10 w-10 rounded-full object-cover"
            @error="previewBroken = true"
            @load="previewBroken = false"
          />
          <div
            v-else
            class="grid h-10 w-10 place-items-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700"
          >{{ initials }}</div>
          <div class="min-w-0">
            <div class="text-xs text-neutral-500">{{ session.user.email }}</div>
            <div class="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
              {{ session.user.role }}
            </div>
          </div>
        </div>

        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Display name</span>
          <input
            v-model="form.display_name"
            type="text"
            maxlength="80"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="How your name appears in the app"
          />
        </label>

        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Avatar URL</span>
          <input
            v-model="form.avatar_url"
            type="url"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
            placeholder="https://…"
            @input="previewBroken = false"
          />
          <span v-if="form.avatar_url && previewBroken" class="mt-1 block text-[11px] text-amber-700">
            Couldn't load that image. Save will still work — the avatar will fall back to your initials.
          </span>
        </label>

        <p v-if="saveError" class="text-xs text-red-600">{{ saveError }}</p>

        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
            @click="cancel"
          >Cancel</button>
          <button
            type="submit"
            :disabled="saving"
            class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </section>

    <section class="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
      <h3 class="text-sm font-semibold">Multi-user management is on the roadmap</h3>
      <p class="mt-2 text-xs text-neutral-600">
        For now, anyone who satisfies your Cloudflare Access policy can sign in. Per-user roles,
        per-project access, and invitations land in a future release.
      </p>
    </section>
  </div>
</template>
