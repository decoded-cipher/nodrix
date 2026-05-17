-- v3: replace display_name / avatar_url with first_name / last_name on users.
-- Initials avatar (2 letters) is sufficient — gravatar dropped.
--
-- Applied via `wrangler d1 migrations apply nodrix` against existing
-- deployments. Fresh deployments get the same end state from src/db/schema.sql
-- (and src/db/migrate.ts STATEMENTS) — keep those in sync with this file.

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name  TEXT;

-- Best-effort backfill from display_name: first whitespace-separated token
-- becomes first_name, the remainder becomes last_name. Rows with empty
-- display_name stay NULL for both.
UPDATE users
   SET first_name = CASE
         WHEN instr(display_name, ' ') > 0
         THEN substr(display_name, 1, instr(display_name, ' ') - 1)
         ELSE display_name
       END,
       last_name = CASE
         WHEN instr(display_name, ' ') > 0
         THEN trim(substr(display_name, instr(display_name, ' ') + 1))
         ELSE NULL
       END
 WHERE display_name IS NOT NULL AND length(trim(display_name)) > 0;

ALTER TABLE users DROP COLUMN display_name;
ALTER TABLE users DROP COLUMN avatar_url;
