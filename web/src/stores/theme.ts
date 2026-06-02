import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nodrix:theme';

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored());
  // Tracks the OS preference so `system` mode reacts to it live.
  const systemDark = ref<boolean>(systemPrefersDark());

  const resolved = computed<'light' | 'dark'>(() => {
    if (mode.value === 'system') return systemDark.value ? 'dark' : 'light';
    return mode.value;
  });

  function apply(): void {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved.value === 'dark');
  }

  function setMode(next: ThemeMode): void {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
  }

  // Topbar quick toggle: light ↔ dark off the resolved theme (System lives in Settings).
  function toggle(): void {
    setMode(resolved.value === 'dark' ? 'light' : 'dark');
  }

  function init(): void {
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => { systemDark.value = e.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    watch(resolved, apply);
  }

  return { mode, resolved, systemDark, setMode, toggle, init };
});
