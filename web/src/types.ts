// Shared types used across stores, pages, and widgets.

export type InstanceRole = 'owner' | 'admin' | 'member';

// A project the user has access to. owner/admin see all; members see only the
// projects they're assigned to. Everyone with access has full control.
export type ProjectRef = { id: string; name: string };

export type User = {
  id: string;
  email: string;
  role: InstanceRole;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  last_login_at?: number | null;
  created_at?: number;
  updated_at?: number;
};

export type Project = {
  id: string;
  name: string;
  created_at: number;
  description?: string | null;
  updated_at?: number;
  archived_at?: number | null;
};

// A user row in the instance Users management list, with their assigned projects
// (empty for owner/admin, who reach every project implicitly).
export type InstanceUser = {
  id: string;
  email: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: InstanceRole;
  last_login_at: number | null;
  created_at: number;
  projects: ProjectRef[];
};

// Returned once on creation — a one-time accept link.
export type InviteCreated = {
  id: string;
  email: string;
  instance_role: 'admin' | 'member';
  url: string;
  token?: string;
  expires_at?: number;
};

export type InvitePreview = {
  valid: boolean;
  email?: string | null;
  instance_role?: 'admin' | 'member';
  inviter_email?: string | null;
};

export type Variable = {
  id: string;
  key: string;
  name?: string | null;
  unit?: string | null;
  created_at: number;
  updated_at: number;
  last_seen: number | null;
};

export type ProjectToken = {
  id: string;
  name?: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type ProjectTokenWithSecret = ProjectToken & { token: string };

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

export type WidgetType = 'iot-value' | 'iot-gauge' | 'iot-chart' | 'iot-toggle' | 'iot-push' | 'iot-slider' | 'iot-map';

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
  | 'variable'
  | 'scene'
  | 'schedule'
  | 'sunset_sunrise'
  | 'event';

// ─── Trigger config shapes (stored in automations.trigger_config) ────────────

export type VariableOperator = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'changed';

export type VariableTriggerConfig = {
  variable: string;                   // variable key
  operator: VariableOperator;
  value?: number | string | boolean;  // omitted for 'changed'
  mode?: 'edge' | 'always';           // edge = fire once on entry (default)
};

export type ScheduleTriggerConfig = {
  time: string;                       // 'HH:MM' 24h
  days?: number[];                    // 0=Sun..6=Sat; empty/absent = every day
  tz?: string;                        // IANA tz, default 'UTC'
};

export type SolarTriggerConfig = {
  event: 'sunrise' | 'sunset';
  lat: number;
  lng: number;
  offset_minutes?: number;            // +/- minutes around the solar event
};

export type EventTriggerConfig = {
  event: string;                      // matched against POST /v1/events { event }
};

// ─── Action descriptors (stored in automations.actions, ordered) ─────────────

export type Action =
  | { type: 'set_variable'; variable: string; value: number | string | boolean }
  | { type: 'call_integration'; integration_id: string; payload?: Record<string, unknown> }
  | { type: 'emit_event'; event: string; payload?: Record<string, unknown> };

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
  last_run_at: number | null;
  last_run_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
};

export type IntegrationTestResult = {
  status: 'ok' | 'error' | 'skipped';
  detail?: string;
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
  variables: Record<string, { value: unknown; received_at: number }>;
  series: Array<{ ts: number; variable: string; value: unknown }>;
};

export type UpdateMsg = {
  type: 'update';
  variable: string;
  value: unknown;
  ts: number;
};

export type WsServerMsg =
  | SnapshotMsg
  | UpdateMsg
  | { type: 'error'; reason: string }
  | { type: 'ack'; req: string; ok: boolean; reason?: string };

export type WsClientMsg = {
  type: 'control';
  req?: string;
  variable: string;
  value?: unknown;
};
