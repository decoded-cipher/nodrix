// The phone (<768px) layout: a re-layout of the same widgets as desktop, so it
// reuses the 24-col grid as-is. Small widgets pair two-up (12 cols), others go
// full width (24). The override is stored positions-only in layout.mobile and
// merged back onto desktop widgets by id at render time (so props never drift);
// absent means auto-derive.

import { GRID_COLUMNS } from './grid';
import type { Layout, MobilePlacement, WidgetInstance } from '../types';
import { manifestFor, type WidgetType } from '@nodrix/widgets-shared';

const HALF = GRID_COLUMNS / 2; // 12 cols — a paired "small" widget

// Driven by each widget's manifest.quirks.mobile.paired.
function isPaired(type: string): boolean {
  return manifestFor(type as WidgetType).quirks?.mobile?.paired === true;
}

// Top-to-bottom, then left-to-right (matches the viewer's compaction).
function readingOrder(items: readonly WidgetInstance[]): WidgetInstance[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function deriveMobilePlacements(desktop: Layout): MobilePlacement[] {
  const out: MobilePlacement[] = [];
  let y = 0;
  let pending: WidgetInstance | null = null;

  const flushPending = () => {
    if (!pending) return;
    out.push({ id: pending.id, x: 0, y, w: HALF, h: pending.h });
    y += pending.h;
    pending = null;
  };

  for (const it of readingOrder(desktop.items)) {
    if (isPaired(it.type)) {
      if (pending) {
        const rowH = Math.max(pending.h, it.h);
        out.push({ id: pending.id, x: 0, y, w: HALF, h: pending.h });
        out.push({ id: it.id, x: HALF, y, w: HALF, h: it.h });
        y += rowH;
        pending = null;
      } else {
        pending = it;
      }
    } else {
      flushPending();
      out.push({ id: it.id, x: 0, y, w: GRID_COLUMNS, h: it.h });
      y += it.h;
    }
  }
  flushPending();
  return out;
}

// Reconcile a saved override with the current desktop: drop deleted widgets,
// append auto-placed rows for widgets the override doesn't cover yet.
function reconcile(desktop: Layout, ov: readonly MobilePlacement[]): MobilePlacement[] {
  const desktopIds = new Set(desktop.items.map((i) => i.id));
  const kept = ov.filter((p) => desktopIds.has(p.id));

  const haveIds = new Set(kept.map((p) => p.id));
  const missing = desktop.items.filter((i) => !haveIds.has(i.id));
  if (missing.length === 0) return kept;

  const offset = kept.reduce((max, p) => Math.max(max, p.y + p.h), 0);
  const extra = deriveMobilePlacements({ grid: { columns: GRID_COLUMNS }, items: missing }).map(
    (p) => ({ ...p, y: p.y + offset })
  );
  return [...kept, ...extra];
}

// The phone layout to render/edit: override (or auto-derived) positions merged
// with desktop widgets' type/props by id.
export function effectiveMobileLayout(desktop: Layout): Layout {
  const override = desktop.mobile;
  const placements =
    override && override.items.length > 0
      ? reconcile(desktop, override.items)
      : deriveMobilePlacements(desktop);

  const byId = new Map(desktop.items.map((it) => [it.id, it]));
  const items: WidgetInstance[] = [];
  for (const p of placements) {
    const src = byId.get(p.id);
    if (!src) continue; // widget removed on desktop
    items.push({ ...src, x: p.x, y: p.y, w: p.w, h: p.h });
  }
  return { grid: { columns: GRID_COLUMNS }, items };
}
