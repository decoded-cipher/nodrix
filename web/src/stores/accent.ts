import { defineStore } from 'pinia';
import { ref } from 'vue';

// Curated set of accent colors. Each maps to a built-in Tailwind palette via the
// [data-accent='…'] rules in style.css. 'orange' is the default brand color.
export const ACCENTS = [
  'orange',
  'rose',
  'amber',
  'emerald',
  'teal',
  'blue',
  'indigo',
  'violet',
] as const;

export type Accent = (typeof ACCENTS)[number];

const STORAGE_KEY = 'nodrix:accent';
const DEFAULT: Accent = 'orange';

function readStored(): Accent {
  const v = localStorage.getItem(STORAGE_KEY);
  return (ACCENTS as readonly string[]).includes(v ?? '') ? (v as Accent) : DEFAULT;
}

export const useAccentStore = defineStore('accent', () => {
  const accent = ref<Accent>(readStored());

  function apply(): void {
    document.documentElement.dataset.accent = accent.value;
  }

  function setAccent(next: Accent): void {
    accent.value = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply();
  }

  function init(): void {
    apply();
  }

  return { accent, setAccent, init };
});
