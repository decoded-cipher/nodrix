// Global toast notifications. Call sites stay one-liners
// (`toast.success('Project created')`) and a single <Toasts /> mounted at the
// app root renders + auto-dismisses them. Mirrors the confirm() pattern.

import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';
// `ttl` is carried so the renderer can size its duration progress bar.
export type Toast = { id: number; kind: ToastKind; message: string; ttl: number };

const toasts = ref<Toast[]>([]);
let seq = 0;

export function toastState() {
  return toasts;
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

// Errors linger a little longer than success/info since they need reading.
const DEFAULT_TTL: Record<ToastKind, number> = { success: 3000, info: 3500, error: 6000 };

function push(kind: ToastKind, message: string, ttl?: number): number {
  const id = ++seq;
  const ms = ttl ?? DEFAULT_TTL[kind];
  toasts.value = [...toasts.value, { id, kind, message, ttl: ms }];
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return id;
}

export const toast = {
  success: (message: string, ttl?: number) => push('success', message, ttl),
  error: (message: string, ttl?: number) => push('error', message, ttl),
  info: (message: string, ttl?: number) => push('info', message, ttl),
};
