// AES-GCM helper for at-rest encryption of small secrets stored in D1
// (currently: the owner's Cloudflare API token used by the Update flow).
//
// The key is derived from the deployment signing secret (see lib/auth-secret.ts)
// via HKDF-SHA-256 with a fixed info string per use case, so different secret
// stores can't be cross-decrypted even though they share the same base secret.
// Format is `v1:<base64-iv>:<base64-ciphertext>` to leave room for future
// algorithm changes.

const ENC_VERSION = 'v1';
const IV_BYTES = 12;          // GCM standard
const KEY_INFO_PREFIX = 'nodrix/encrypt/';

async function deriveKey(secret: string, info: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // A static salt is fine — HKDF's security here relies on the
      // input secret, and the per-purpose info string scopes the key.
      salt: enc.encode('nodrix-encrypt-salt'),
      info: enc.encode(KEY_INFO_PREFIX + info),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(secret: string, plaintext: string, info: string): Promise<string> {
  const key = await deriveKey(secret, info);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  return `${ENC_VERSION}:${b64encode(iv)}:${b64encode(ct)}`;
}

export async function decryptSecret(secret: string, payload: string, info: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(':');
  if (version !== ENC_VERSION || !ivB64 || !ctB64) {
    throw new Error('encrypted payload has unexpected shape');
  }
  const key = await deriveKey(secret, info);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(ivB64) },
    key,
    b64decode(ctB64)
  );
  return new TextDecoder().decode(pt);
}
