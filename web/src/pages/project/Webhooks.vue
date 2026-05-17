<script setup lang="ts">
// Webhooks: forward telemetry / events to external URLs. Stub for now.
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Webhooks</h1>
      <p class="mt-1 text-sm text-neutral-600">
        Push telemetry, events, and state changes to an external URL. Useful for piping into
        Zapier, Slack, your own backend, or another service.
      </p>
    </header>

    <section class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
      <div class="mx-auto grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-500">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <path d="M9 16.5a4.5 4.5 0 1 1 6.364-6.364l1.06-1.06a4.5 4.5 0 1 1 1.061 1.06l-7.07 7.071a4.5 4.5 0 0 1-1.415-7.778M12 12.75v6.75" />
        </svg>
      </div>
      <h3 class="mt-4 text-sm font-semibold">No webhooks yet</h3>
      <p class="mx-auto mt-2 max-w-md text-xs text-neutral-500">
        Webhook support is on the roadmap. You'll be able to subscribe to metric updates,
        device-online/offline, and automation runs.
      </p>
      <button
        type="button"
        disabled
        class="mt-4 cursor-not-allowed rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white opacity-50"
      >Add webhook (coming soon)</button>
    </section>
  </div>
</template>
