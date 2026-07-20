-- OIDC provider + JWT signing keys, for the Nodrix mobile app.
--
-- The instance acts as an OpenID Connect provider (Better Auth oidcProvider +
-- jwt plugins) so the app authenticates via OAuth 2.1 Authorization Code + PKCE.
-- METADATA ONLY, like 0001. Applied by name via db/auto-migrate.ts.

-- jwt plugin: signing keypair, persisted so JWTs survive stateless Worker runs.
CREATE TABLE IF NOT EXISTS jwks (
  id          TEXT PRIMARY KEY,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER
);

-- Registered OAuth clients. The official app is a config-only trusted client
-- (no row here); this table backs dynamic client registration if ever used.
CREATE TABLE IF NOT EXISTS oauth_applications (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL UNIQUE,
  client_secret TEXT,
  name          TEXT NOT NULL,
  icon          TEXT,
  metadata      TEXT,
  redirect_urls TEXT NOT NULL,
  type          TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Issued access/refresh tokens. client_id has no FK: trusted clients live in
-- config, not oauth_applications, so a token issued to the app has no parent row.
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id                       TEXT PRIMARY KEY,
  access_token             TEXT NOT NULL UNIQUE,
  refresh_token            TEXT NOT NULL UNIQUE,
  access_token_expires_at  INTEGER NOT NULL,
  refresh_token_expires_at INTEGER NOT NULL,
  client_id                TEXT NOT NULL,
  user_id                  TEXT REFERENCES users(id) ON DELETE CASCADE,
  scopes                   TEXT NOT NULL,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_client ON oauth_access_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);

-- Per-user client consents. Trusted clients skip consent, so no rows for the app.
CREATE TABLE IF NOT EXISTS oauth_consents (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes        TEXT NOT NULL,
  consent_given INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
