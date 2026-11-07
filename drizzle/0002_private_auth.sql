-- Additive only. Existing users and calendar constraints are preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT 'managed-by-better-auth';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 ip_address text, user_agent text
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL, provider_id text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, password text,
 access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz,
 refresh_token_expires_at timestamptz, scope text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT auth_account_provider_unique UNIQUE(provider_id,account_id)
);
CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx ON auth_accounts(user_id);
CREATE TABLE IF NOT EXISTS auth_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_user_id_idx ON invitations(user_id);
CREATE INDEX IF NOT EXISTS entries_owner_start_idx ON entries(owner_id,start_date);
