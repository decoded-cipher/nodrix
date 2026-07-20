// Drizzle schema for the tables Better Auth's drizzleAdapter manages.
// Keep names + columns aligned with worker/src/db/migrations/0001_init.sql.
//
// Property names are snake_case to match the column names AND what Better
// Auth's `fields` mapping resolves to. Better Auth's TS API still uses
// camelCase (user.emailVerified); the adapter applies the `fields` map and
// then looks the resolved name up as a property here — so the property name
// has to match the renamed value, not the camelCase API name.

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  email_verified: integer('email_verified', { mode: 'boolean' }).notNull().default(true),
  name: text('name'),
  image: text('image'),
  role: text('role').notNull().default('viewer'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull(),
  provider_id: text('provider_id').notNull(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  access_token: text('access_token'),
  refresh_token: text('refresh_token'),
  id_token: text('id_token'),
  access_token_expires_at: integer('access_token_expires_at', { mode: 'timestamp' }),
  refresh_token_expires_at: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// jwt plugin signing keypair, persisted across stateless Worker runs.
export const jwks = sqliteTable('jwks', {
  id: text('id').primaryKey(),
  public_key: text('public_key').notNull(),
  private_key: text('private_key').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  expires_at: integer('expires_at', { mode: 'timestamp' }),
});

// oidcProvider tables. The app is a config-only trusted client (no row here), so
// the token/consent client_id columns carry no enforced FK.
export const oauth_applications = sqliteTable('oauth_applications', {
  id: text('id').primaryKey(),
  client_id: text('client_id').notNull().unique(),
  client_secret: text('client_secret'),
  name: text('name').notNull(),
  icon: text('icon'),
  metadata: text('metadata'),
  redirect_urls: text('redirect_urls').notNull(),
  type: text('type').notNull(),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  user_id: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const oauth_access_tokens = sqliteTable('oauth_access_tokens', {
  id: text('id').primaryKey(),
  access_token: text('access_token').notNull().unique(),
  refresh_token: text('refresh_token').notNull().unique(),
  access_token_expires_at: integer('access_token_expires_at', { mode: 'timestamp' }).notNull(),
  refresh_token_expires_at: integer('refresh_token_expires_at', { mode: 'timestamp' }).notNull(),
  client_id: text('client_id').notNull(),
  user_id: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const oauth_consents = sqliteTable('oauth_consents', {
  id: text('id').primaryKey(),
  client_id: text('client_id').notNull(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  consent_given: integer('consent_given', { mode: 'boolean' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
