<script setup lang="ts">
import { RouterView } from 'vue-router';
import ConfirmModal from './components/ConfirmModal.vue';
import ProgressBar from './components/ProgressBar.vue';
import Toasts from './components/Toasts.vue';
</script>

<template>
  <ProgressBar />
  <RouterView />
  <ConfirmModal />
  <Toasts />
</template>
