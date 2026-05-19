import { ref } from 'vue';

// Shared state for the top-of-page progress bar. start()/done() are reference-
// counted so concurrent navigations and API calls coexist without flicker.

const value = ref(0);
const active = ref(false);
let pending = 0;
let trickleTimer: number | null = null;
let finishTimer: number | null = null;

function trickle() {
  trickleTimer = window.setTimeout(() => {
    if (active.value && value.value < 90) {
      const remaining = 90 - value.value;
      value.value += Math.max(0.5, remaining * 0.1);
      trickle();
    }
  }, 220);
}

function clearTimers() {
  if (trickleTimer !== null) {
    window.clearTimeout(trickleTimer);
    trickleTimer = null;
  }
  if (finishTimer !== null) {
    window.clearTimeout(finishTimer);
    finishTimer = null;
  }
}

export const progress = {
  value,
  active,
  start() {
    pending += 1;
    if (!active.value) {
      clearTimers();
      active.value = true;
      value.value = 8;
      trickle();
    }
  },
  done() {
    if (pending === 0) return;
    pending -= 1;
    if (pending > 0) return;
    clearTimers();
    value.value = 100;
    finishTimer = window.setTimeout(() => {
      active.value = false;
      value.value = 0;
      finishTimer = null;
    }, 260);
  },
};
