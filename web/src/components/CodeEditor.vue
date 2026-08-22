<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        cpp(),
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
        }),
      ],
    }),
  });
});

// Echoing the user's own keystrokes back would reset the cursor every character.
watch(
  () => props.modelValue,
  (next) => {
    if (!view || next === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  }
);

onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div ref="host" class="overflow-hidden rounded-xl border border-neutral-200 text-sm dark:border-neutral-800" />
</template>
