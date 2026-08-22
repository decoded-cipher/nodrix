// A build is an NDJSON stream: log lines as the toolchain emits them, then one
// result frame. The HTTP status only reports whether the request was accepted.

export type BuildResult = { ok: true; build: string } | { ok: false; error: string };

type Frame = { type: 'log'; line: string } | ({ type: 'result' } & BuildResult);

function parseFrame(raw: string): Frame | null {
  try {
    return JSON.parse(raw) as Frame;
  } catch {
    return null;
  }
}

export async function runBuild(
  projectId: string,
  input: { fqbn: string; sketch: string },
  onLine: (line: string) => void
): Promise<BuildResult> {
  const res = await fetch(`/v1/admin/projects/${projectId}/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let carry = '';
  let result: BuildResult = { ok: false, error: 'the build ended without a result' };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += value;
      const parts = carry.split('\n');
      carry = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.trim()) continue;
        const frame = parseFrame(part);
        if (!frame) continue;
        if (frame.type === 'log') onLine(frame.line);
        else result = frame.ok ? { ok: true, build: frame.build } : { ok: false, error: frame.error };
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}
