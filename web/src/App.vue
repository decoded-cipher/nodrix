<script setup lang="ts">
import { RouterView } from 'vue-router';
import ConfirmModal from './components/ConfirmModal.vue';
import ProgressBar from './components/ProgressBar.vue';
</script>

<template>
  <ProgressBar />
  <RouterView />
  <ConfirmModal />
</template>
