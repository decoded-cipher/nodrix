// Password hashing for Cloudflare Workers.
//
// Better Auth's default is scrypt, which on Workers has no libuv thread pool and
// runs as pure-JS @noble/hashes scrypt — ~2.5s of CPU per hash/verify, which
// intermittently trips the Worker CPU limit on sign-in (503 exceededCpu).
//
// PBKDF2 via Web Crypto runs as native code (tens of ms even at high iteration
// counts) and is OWASP-acceptable, so it's the right primitive here. Hashes are
// self-describing — `pbkdf2$<iterations>$<saltB64>$<hashB64>` — so the iteration
// count can be raised later without breaking existing hashes.

const ITERATIONS = 600_000; // OWASP 2023 floor for PBKDF2-HMAC-SHA256
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = 'pbkdf2';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = new Uint8Array(await deriveBits(password, salt, ITERATIONS));
  return `${PREFIX}$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = unb64(parts[2]!);
    expected = unb64(parts[3]!);
  } catch {
    return false;
  }
  const actual = new Uint8Array(await deriveBits(password, salt, iterations));
  return constantTimeEqual(actual, expected);
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
