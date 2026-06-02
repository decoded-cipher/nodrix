// At-rest sealing for integration `config` (holds API keys, webhook URLs, HMAC
// signing secrets). Same AES-GCM scheme as the OAuth client-secret store
// (crypto.ts), with its own HKDF info so the two can't be cross-decrypted.
// Writes always seal, so stored values are `v1:<iv>:<ct>`; the non-`v1:` branch
// is a defensive pass-through (e.g. an empty/unsealed value never decrypts).

import type { Env } from '../../env';
import { encryptSecret, decryptSecret } from './crypto';
import { getOrCreateSigningSecret } from './auth-secret';

const ENC_INFO = 'integration-config';

export async function sealIntegrationConfig(env: Env, config: unknown): Promise<string> {
  const secret = await getOrCreateSigningSecret(env);
  return encryptSecret(secret, JSON.stringify(config ?? {}), ENC_INFO);
}

// Returns the plaintext JSON string the runtime + admin shape expect in `config`.
export async function openIntegrationConfig(env: Env, stored: string): Promise<string> {
  if (!stored.startsWith('v1:')) return stored;
  const secret = await getOrCreateSigningSecret(env);
  return decryptSecret(secret, stored, ENC_INFO);
}
