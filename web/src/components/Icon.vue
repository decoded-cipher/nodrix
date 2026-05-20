<script setup lang="ts">
// Renders a single-path outline glyph. Pass a 24x24 heroicons-style path `d`.
defineProps<{ path: string }>();
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="path" />
  </svg>
</template>
