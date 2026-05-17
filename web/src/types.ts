// Shared types used across stores, pages, and widgets.

export type User = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'viewer';
  first_name?: string | null;
  last_name?: string | null;
  last_login_at?: number | null;
  created_at?: number;
  updated_at?: number;
};

export type Project = {
  id: string;
  name: string;
  created_at: number;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  updated_at?: number;
  archived_at?: number | null;
};

export type Device = {
  id: string;
  name: string;
  created_at: number;
  last_seen: number | null;
  description?: string | null;
  updated_at?: number;
  archived_at?: number | null;
};

export type DeviceWithToken = Device & { token: string };

export type UserToken = {
  id: string;
  project_id: string | null;
  scope: 'read' | 'admin';
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  name?: string | null;
  expires_at?: number | null;
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
  description?: string | null;
  visibility?: 'private' | 'public';
  share_token?: string | null;
  archived_at?: number | null;
};

export type Dashboard = DashboardMeta & {
  layout: Layout;
};

// ─── New entities (backed by 0002_schema_v2.sql) ─────────────────────────────

export type AutomationTriggerType =
  | 'schedule'
  | 'device_state'
  | 'sunset_sunrise'
  | 'event'
  | 'scene';

export type Automation = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: AutomationTriggerType;
  trigger_config: unknown;            // JSON; shape depends on trigger_type
  actions: unknown[];                 // JSON ordered list of action descriptors
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  last_run_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
};

export type IntegrationKind =
  | 'webhook'
  | 'code_block'
  | 'slack'
  | 'email'
  | 'mqtt'
  | 'http_service';

export type Integration = {
  id: string;
  project_id: string;
  name: string;
  kind: IntegrationKind;
  config: unknown;                    // JSON; shape depends on kind
  enabled: boolean;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

export type AuditLogEntry = {
  id: number;
  project_id: string | null;
  project_name: string | null;        // joined from projects on read
  user_id: string | null;
  user_email: string | null;          // joined from users on read
  action: string;                     // e.g. 'device.create', 'automation.run'
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;                  // JSON
  created_at: number;
};

// ─── Realtime WS ─────────────────────────────────────────────────────────────

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
