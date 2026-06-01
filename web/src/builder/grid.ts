import type { Layout } from '../types';

export const GRID_COLUMNS = 16;
export const ROW_HEIGHT_EDIT = 60; // editor row height, px
export const ROW_HEIGHT_VIEW = 67; // viewer auto-row height, px
export const GRID_MARGIN = 12;     // gap between cells, px
export const MIN_UNITS = 2;        // smallest widget side, in grid units

// Upscale a sub-resolution (<16-col) layout to the current grid, idempotently.
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
    ...(layout.mobile !== undefined ? { mobile: layout.mobile } : {}),
    ...(layout.refresh !== undefined ? { refresh: layout.refresh } : {}),
  };
}
