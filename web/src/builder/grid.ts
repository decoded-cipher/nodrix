// Dashboard grid resolution. We use a 24-column grid with half-height rows so
// widgets can be sized at finer steps than the legacy 12-col / full-row grid —
// every old size now has an in-between stop in both width and height.
//
// Legacy layouts are stored in 12-col units; normalizeLayout() upscales them on
// read so they render unchanged, and the new coordinates persist on the next
// save. The helper is idempotent, so it's safe to apply on every load.

import type { Layout } from '../types';

export const GRID_COLUMNS = 24;
export const ROW_HEIGHT_EDIT = 40; // grid-layout-plus row height (editor), px
export const ROW_HEIGHT_VIEW = 45; // CSS grid auto-row height (viewer), px
export const GRID_MARGIN = 12;     // gap between cells, px (editor + viewer)
export const MIN_UNITS = 2;        // smallest widget side == one legacy cell

// Upscale a legacy (<24-col) layout to the current resolution. Item coordinates
// and sizes scale by the same integer factor, so the arrangement is preserved.
// A layout already at GRID_COLUMNS (or finer) is returned unchanged.
export function normalizeLayout(layout: Layout): Layout {
  const cols = layout.grid.columns;
  if (!cols || cols >= GRID_COLUMNS) return layout;
  const factor = Math.round(GRID_COLUMNS / cols);
  return {
    grid: { columns: GRID_COLUMNS },
    items: layout.items.map((it) => ({
      ...it,
      x: it.x * factor,
      y: it.y * factor,
      w: it.w * factor,
      h: it.h * factor,
    })),
    // Preserve nested settings (authored at the current resolution).
    ...(layout.mobile !== undefined ? { mobile: layout.mobile } : {}),
    ...(layout.refresh !== undefined ? { refresh: layout.refresh } : {}),
  };
}
