// Registry of connection (integration) kinds. Drives the catalog grid AND the
// create/edit form. Adding a kind is a single entry here; no morphing v-if forms.

import type { IntegrationKind } from '../../../types';

export type ConnFieldType = 'text' | 'url' | 'textarea' | 'json' | 'select' | 'code';

export type ConnField = {
  key: string;            // maps to a config key
  label: string;
  type: ConnFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  mono?: boolean;         // monospace input
  options?: readonly string[]; // for type 'select'
  default?: string;
};

export type ConnSpec = {
  kind: IntegrationKind;
  label: string;
  description: string;
  icon: string;           // 24x24 outline path
  executable: boolean;    // false = "coming soon", not run by the engine yet
  fields: readonly ConnField[];
  // Short subtitle for the list, derived from stored config.
  summary: (config: Record<string, unknown>) => string;
};

const ICON = {
  webhook: 'M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25',
  slack: 'M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z',
  http: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m-9 9h18',
  email: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
  mqtt: 'M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.788m13.788 0c3.808 3.808 3.808 9.98 0 13.788M12.375 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  code: 'M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5',
} as const;

export const CONNECTIONS: readonly ConnSpec[] = [
  {
    kind: 'webhook',
    label: 'Webhook',
    description: 'POST the trigger context as JSON to any URL.',
    icon: ICON.webhook,
    executable: true,
    fields: [
      { key: 'url', label: 'Target URL', type: 'url', required: true, mono: true, placeholder: 'https://hooks.example.com/…', hint: 'Receives a JSON POST with the trigger context (source, variable, value, …).' },
      { key: 'secret', label: 'Signing secret (optional)', type: 'text', mono: true, placeholder: 'shared secret', hint: 'Adds an X-Nodrix-Signature HMAC-SHA256 header so the receiver can verify the payload.' },
      { key: 'headers', label: 'Headers (JSON, optional)', type: 'json', mono: true, placeholder: '{ "authorization": "Bearer …" }' },
    ],
    summary: (c) => str(c.url) || 'No URL set',
  },
  {
    kind: 'slack',
    label: 'Slack',
    description: 'Post a message to a channel via an incoming webhook.',
    icon: ICON.slack,
    executable: true,
    fields: [
      { key: 'webhook_url', label: 'Slack incoming webhook URL', type: 'url', required: true, mono: true, placeholder: 'https://hooks.slack.com/services/…' },
      { key: 'template', label: 'Message template (optional)', type: 'text', placeholder: '{{variable}} is now {{value}}', hint: 'Use {{variable}}, {{value}}, {{event}}. Defaults to an auto-generated message.' },
    ],
    summary: (c) => (str(c.webhook_url) ? 'Slack incoming webhook' : 'No webhook URL set'),
  },
  {
    kind: 'http_service',
    label: 'HTTP service',
    description: 'Generic outbound HTTP request with a templated body.',
    icon: ICON.http,
    executable: true,
    fields: [
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'], default: 'POST' },
      { key: 'url', label: 'URL', type: 'url', required: true, mono: true, placeholder: 'https://api.example.com/…' },
      { key: 'headers', label: 'Headers (JSON, optional)', type: 'json', mono: true, placeholder: '{ "authorization": "Bearer …" }' },
      { key: 'body_template', label: 'Body template (optional)', type: 'textarea', mono: true, placeholder: '{ "content": "{{value}}" }', hint: 'Sent for non-GET requests. {{variable}}, {{value}}, {{event}} are interpolated.' },
    ],
    summary: (c) => `${str(c.method) || 'POST'} ${str(c.url) || '—'}`,
  },
  {
    kind: 'email',
    label: 'Email',
    description: 'Send a templated email.',
    icon: ICON.email,
    executable: false,
    fields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'alerts@example.com' },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: '{{variable}} alert' },
      { key: 'body', label: 'Body', type: 'textarea', placeholder: '{{variable}} is now {{value}}' },
    ],
    summary: (c) => (str(c.to) ? `to ${str(c.to)}` : 'Not configured'),
  },
  {
    kind: 'mqtt',
    label: 'MQTT',
    description: 'Publish to a broker topic.',
    icon: ICON.mqtt,
    executable: false,
    fields: [
      { key: 'broker_url', label: 'Broker URL', type: 'url', mono: true, placeholder: 'mqtts://broker.example.com:8883' },
      { key: 'topic', label: 'Topic', type: 'text', mono: true, placeholder: 'home/livingroom/fan' },
    ],
    summary: (c) => str(c.topic) || 'Not configured',
  },
  {
    kind: 'code_block',
    label: 'Code block',
    description: 'Run a snippet of JavaScript as an action.',
    icon: ICON.code,
    executable: false,
    fields: [
      { key: 'source', label: 'Source (JavaScript)', type: 'code', default: 'export default function (event) {\n  return event;\n}\n' },
    ],
    summary: () => 'JavaScript snippet',
  },
];

export function connSpec(kind: IntegrationKind): ConnSpec {
  return CONNECTIONS.find((c) => c.kind === kind) ?? CONNECTIONS[0]!;
}

export const EXECUTABLE_CONNECTIONS = CONNECTIONS.filter((c) => c.executable);
export const COMING_SOON_CONNECTIONS = CONNECTIONS.filter((c) => !c.executable);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
