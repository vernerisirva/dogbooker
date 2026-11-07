-- Baseline: mirrors the inspected existing schema. IF NOT EXISTS preserves it.
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80), dog_name text,
 role text NOT NULL CHECK (role IN ('admin','owner')), password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users(lower(email));
CREATE TABLE IF NOT EXISTS entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('block','booking')),
 owner_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 start_date date NOT NULL, end_date date NOT NULL,
 note text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date>=start_date),
 CHECK((kind='block' AND owner_id IS NULL) OR (kind='booking' AND owner_id IS NOT NULL)),
 CONSTRAINT no_overlapping_active_dates EXCLUDE USING gist
 (daterange(start_date,end_date,'[]') WITH &&) WHERE(status='active')
);
