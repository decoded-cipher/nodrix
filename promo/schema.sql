-- nodrix promo — wishlist signups (Cloudflare D1).
-- Applied with: wrangler d1 execute nodrix-wishlist --remote --file=./schema.sql
-- (and --local for the dev database used by `wrangler pages dev`).
CREATE TABLE IF NOT EXISTS wishlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,
  referer    TEXT
);
