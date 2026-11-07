-- Additive, rolling-deployment-compatible migration. The existing occupancy exclusion
-- remains unchanged: pending and confirmed bookings both retain status='active'.
ALTER TABLE entries ADD COLUMN booking_status text;
UPDATE entries SET booking_status=CASE WHEN status='active' THEN 'confirmed' ELSE 'cancelled' END WHERE kind='booking';

CREATE FUNCTION sync_booking_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='booking' THEN
    IF NEW.booking_status IS NULL THEN
      NEW.booking_status := CASE WHEN NEW.status='active' THEN 'confirmed' ELSE 'cancelled' END;
    ELSIF TG_OP='UPDATE' AND NEW.status='cancelled' AND OLD.status='active'
      AND NEW.booking_status IS NOT DISTINCT FROM OLD.booking_status THEN
      -- Support cancellation by the previously deployed version during rollout.
      NEW.booking_status := 'cancelled';
    END IF;
    NEW.status := CASE WHEN NEW.booking_status IN ('pending','confirmed') THEN 'active' ELSE 'cancelled' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entries_booking_reservation BEFORE INSERT OR UPDATE ON entries
FOR EACH ROW EXECUTE FUNCTION sync_booking_reservation();
ALTER TABLE entries ADD CONSTRAINT entries_booking_status_check CHECK (
 (kind='block' AND booking_status IS NULL) OR
 (kind='booking' AND booking_status IS NOT NULL AND booking_status IN ('pending','confirmed','declined','cancelled')
  AND (status='active')=(booking_status IN ('pending','confirmed')))
);
CREATE INDEX entries_pending_idx ON entries(start_date) WHERE booking_status='pending';

CREATE TABLE notification_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
 event text NOT NULL CHECK(event IN ('requested','approved','declined','owner_cancelled','admin_cancelled')),
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recipient_email text NOT NULL,
 payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','needs_review')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 first_attempt_at timestamptz,
 lease_token uuid,
 locked_until timestamptz,
 provider_id text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 UNIQUE(booking_id,event)
);
CREATE INDEX notification_jobs_due_idx ON notification_jobs(available_at) WHERE state IN ('pending','sending');
