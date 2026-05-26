import { nanoid } from 'nanoid';

// Prefixed nanoid-based ids. URL-safe, easy to eyeball in logs.
//
// usr_xxx  user        prj_xxx  project
// var_xxx  variable    dsh_xxx  dashboard
// tok_xxx  token       ctl_xxx  control write
// aut_xxx  automation  itg_xxx  integration
// wid_xxx  widget instance (inside a dashboard layout)

const PREFIXES = {
  user: 'usr',
  project: 'prj',
  variable: 'var',
  dashboard: 'dsh',
  token: 'tok',
  control: 'ctl',
  automation: 'aut',
  integration: 'itg',
  widget: 'wid',
} as const;

export type IdKind = keyof typeof PREFIXES;

// 12 chars from nanoid's default alphabet (A-Za-z0-9_-) gives ~72 bits of
// entropy — safe well past 10^10 IDs per kind, and short enough to eyeball.
const ID_LEN = 12;

export function newId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${nanoid(ID_LEN)}`;
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
