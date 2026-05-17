// Prefixed UUID-based ids. Cheap, sortable enough for v1, easy to eyeball in logs.
//
// usr_xxx  user
// prj_xxx  project
// dev_xxx  device
// dsh_xxx  dashboard
// tok_xxx  token (device or user)

const PREFIXES = {
  user: 'usr',
  project: 'prj',
  device: 'dev',
  dashboard: 'dsh',
  token: 'tok',
  command: 'cmd',
  automation: 'aut',
  integration: 'itg',
} as const;

export type IdKind = keyof typeof PREFIXES;

export function newId(kind: IdKind): string {
  // 22 chars of base32-ish entropy is plenty; collisions vanishingly unlikely.
  return `${PREFIXES[kind]}_${crypto.randomUUID().replace(/-/g, '').slice(0, 22)}`;
}

// Token generation: 32 random bytes, base64url. Plaintext returned to the user
// ONCE on creation; only SHA-256(token) is persisted.
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
