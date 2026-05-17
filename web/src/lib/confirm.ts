// Global confirm() replacement for destructive actions. Call sites stay
// one-liners (`if (!(await confirm({...}))) return;`) but render a styled
// modal with title, message, optional bulleted details, and a danger button.
//
// The matching <ConfirmModal /> is mounted once at the app root and consumes
// this module's state.

import { ref } from 'vue';

export type ConfirmOpts = {
  title: string;
  message?: string;
  details?: string[];           // rendered as a bulleted list
  confirmLabel?: string;        // default 'Delete'
  cancelLabel?: string;         // default 'Cancel'
  danger?: boolean;             // default true (red destructive button)
};

type State = {
  open: boolean;
  opts: ConfirmOpts | null;
  resolve: ((ok: boolean) => void) | null;
};

const state = ref<State>({ open: false, opts: null, resolve: null });

export function confirmState() {
  return state;
}

export function confirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // If an earlier prompt is somehow still pending, cancel it.
    state.value.resolve?.(false);
    state.value = { open: true, opts, resolve };
  });
}

export function resolveConfirm(ok: boolean): void {
  const r = state.value.resolve;
  state.value = { open: false, opts: null, resolve: null };
  r?.(ok);
}
