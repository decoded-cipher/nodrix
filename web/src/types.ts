// Shared types used across stores, pages, and widgets.

export type User = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'viewer';
};

export type Project = {
  id: string;
  name: string;
  created_at: number;
};

export type Device = {
  id: string;
  name: string;
  created_at: number;
  last_seen: number | null;
};

export type DeviceWithToken = Device & { token: string };

export type UserToken = {
  id: string;
  project_id: string | null;
  scope: 'read' | 'admin';
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type WidgetType = 'iot-value' | 'iot-gauge' | 'iot-chart' | 'iot-toggle';

export type WidgetInstance = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: WidgetType;
  props: Record<string, unknown>;
};

export type Layout = {
  grid: { columns: number };
  items: WidgetInstance[];
};

export type DashboardMeta = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

export type Dashboard = DashboardMeta & {
  layout: Layout;
};

export type SnapshotMsg = {
  type: 'snapshot';
  dashboard: string;
  layout: Layout;
  devices: Record<
    string,
    {
      state: Record<string, { value: unknown; received_at: number }>;
      series: Array<{ ts: number; metric: string; value: unknown }>;
    }
  >;
};

export type UpdateMsg = {
  type: 'update';
  device: string;
  metric: string;
  value: unknown;
  ts: number;
};

export type WsServerMsg =
  | SnapshotMsg
  | UpdateMsg
  | { type: 'error'; reason: string }
  | { type: 'ack'; req: string; ok: boolean; reason?: string };

export type WsClientMsg = {
  type: 'command';
  req?: string;
  device: string;
  name: string;
  value?: unknown;
};
