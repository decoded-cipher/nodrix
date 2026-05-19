<script setup lang="ts">
defineProps<{ modelValue: boolean; label?: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :class="[
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors',
      modelValue
        ? 'bg-orange-600 hover:bg-orange-700'
        : 'bg-neutral-300 hover:bg-neutral-400 dark:bg-neutral-700 dark:hover:bg-neutral-600',
    ]"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      :class="[
        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
        modelValue ? 'translate-x-5' : 'translate-x-0.5',
      ]"
    />
  </button>
</template>
