// Web adapter for automation display: trigger picker/header metadata and the
// summary chips shown on cards. All per-kind formatting lives in
// @nodrix/blocks-shared; this file only adapts it to the web (resolvers) and the
// legacy trigger_type/actions shape.

import {
  triggerSpec as triggerManifest,
  blockLines,
  blockChip,
  type SummaryResolvers,
} from '@nodrix/blocks-shared';
import type { AutomationTriggerType } from '../../../types';

export type TriggerSpec = {
  key: AutomationTriggerType;
  title: string;
  desc: string;
  icon: string; // 24x24 outline path
};

export function triggerSpec(key: AutomationTriggerType): TriggerSpec {
  const m = triggerManifest(key);
  return { key: m.kind as AutomationTriggerType, title: m.label, desc: m.description, icon: m.icon };
}

export type FlowChip = { icon: string; label: string };
export type ChipResolvers = SummaryResolvers;

const asConfig = (c: Record<string, unknown> | null | undefined) => (c ?? {}) as Record<string, unknown>;

// Longer "trigger detail" string for tooltips (all summary lines joined).
export function triggerSummary(type: AutomationTriggerType, config: Record<string, unknown> | null | undefined, r: ChipResolvers = {}): string {
  const lines = blockLines(type, asConfig(config), r);
  return lines.length ? lines.join(' · ') : blockChip(type, asConfig(config), r).label;
}

// Compact inline chip label for a trigger.
export function triggerChipLabel(type: AutomationTriggerType, config: Record<string, unknown> | null | undefined, r: ChipResolvers = {}): string {
  return blockChip(type, asConfig(config), r).label;
}

// Action list → flow chips (icon + label).
export function actionChips(actions: unknown[] | null | undefined, r: ChipResolvers = {}): FlowChip[] {
  if (!Array.isArray(actions)) return [];
  return actions.map((raw) => {
    const a = (raw ?? {}) as { type?: unknown } & Record<string, unknown>;
    return blockChip(String(a.type ?? ''), a, r);
  });
}
