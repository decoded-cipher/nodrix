import type { Layout } from '../types';

export const GRID_COLUMNS = 24;
export const ROW_HEIGHT = 40;      // grid row height, px (shared by editor + viewer)
export const GRID_MARGIN = 12;     // gap between cells, px
export const MIN_UNITS = 3;        // smallest widget side, in grid units

// Upscale a sub-resolution (<GRID_COLUMNS) layout to the current grid, idempotently.
export function normalizeLayout(layout: Layout): Layout {
  const cols = layout.grid.columns;
  if (!cols || cols >= GRID_COLUMNS) return layout;
  const factor = GRID_COLUMNS / cols;
  const scale = (n: number) => Math.round(n * factor);
  return {
    grid: { columns: GRID_COLUMNS },
    items: layout.items.map((it) => {
      const w = Math.max(1, scale(it.w));
      const x = Math.max(0, Math.min(scale(it.x), GRID_COLUMNS - w));
      return { ...it, x, y: Math.max(0, scale(it.y)), w, h: Math.max(1, scale(it.h)) };
    }),
    ...(layout.mobile !== undefined ? { mobile: layout.mobile } : {}),
    ...(layout.refresh !== undefined ? { refresh: layout.refresh } : {}),
  };
}
