// Secret redaction for MCP output. Integration configs hold tokens, passwords,
// signing keys, and auth headers; the HTTP admin API shows them to a logged-in
// human, but we never expose secret values to a model. Applied at the tool layer
// so the underlying services stay truthful for the HTTP path.

const SECRET_KEY = /secret|token|password|passwd|auth|api[_-]?key|signing|credential|bearer/i;

export function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) && v != null && v !== '' ? '***redacted***' : redactConfig(v);
    }
    return out;
  }
  return value;
}

// Redact the `config` of an integration-shaped object.
export function redactIntegration<T extends { config?: unknown }>(integration: T): T {
  return { ...integration, config: redactConfig(integration.config) };
}
