-- New reminder state only; effective times, booking status and existing jobs are retained.
ALTER TABLE entries ADD COLUMN arrival_resubmission_required boolean NOT NULL DEFAULT false;
ALTER TABLE entries ADD COLUMN pickup_resubmission_required boolean NOT NULL DEFAULT false;
ALTER TABLE booking_time_proposals ADD COLUMN requests_arrival boolean NOT NULL DEFAULT false;
ALTER TABLE booking_time_proposals ADD COLUMN requests_pickup boolean NOT NULL DEFAULT false;
UPDATE booking_time_proposals SET requests_arrival=proposed_arrival IS DISTINCT FROM current_arrival,
 requests_pickup=proposed_pickup IS DISTINCT FROM current_pickup;
-- Backfill only an unambiguously latest rejected owner proposal. Earlier effective agreements stay valid.
UPDATE entries e SET arrival_resubmission_required=p.requests_arrival,pickup_resubmission_required=p.requests_pickup
 FROM booking_time_proposals p WHERE p.booking_id=e.id AND p.status='declined' AND p.proposer_role='owner'
 AND e.arrival_revision=p.revision+1 AND e.booking_status IN ('pending','confirmed');
CREATE FUNCTION track_time_resubmission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='pending' AND NEW.status IN ('approved','declined') THEN
  UPDATE entries SET
   arrival_resubmission_required=CASE WHEN NEW.requests_arrival THEN NEW.status='declined' AND NEW.proposer_role='owner' ELSE arrival_resubmission_required END,
   pickup_resubmission_required=CASE WHEN NEW.requests_pickup THEN NEW.status='declined' AND NEW.proposer_role='owner' ELSE pickup_resubmission_required END
  WHERE id=NEW.booking_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_time_resubmission AFTER UPDATE OF status ON booking_time_proposals FOR EACH ROW EXECUTE FUNCTION track_time_resubmission();
CREATE FUNCTION clear_time_resubmission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.arrival_time IS DISTINCT FROM OLD.arrival_time OR (NEW.booking_status='confirmed' AND OLD.booking_status='pending') THEN NEW.arrival_resubmission_required=false; END IF;
 IF NEW.pickup_time IS DISTINCT FROM OLD.pickup_time OR (NEW.booking_status='confirmed' AND OLD.booking_status='pending') THEN NEW.pickup_resubmission_required=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entries_time_resubmission BEFORE UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION clear_time_resubmission();
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_check CHECK (event IN (
 'requested','approved','declined','owner_cancelled','admin_cancelled','arrival_changed','times_changed',
 'time_change_requested','time_change_approved','time_change_declined','time_change_proposed','time_change_accepted','time_change_rejected','time_change_direct',
 'dropoff_reminder','pickup_reminder'));
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_version_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_version_check CHECK (
 (event IN ('requested','approved','declined','owner_cancelled','admin_cancelled','dropoff_reminder','pickup_reminder') AND event_version=0) OR
 (event NOT IN ('requested','approved','declined','owner_cancelled','admin_cancelled','dropoff_reminder','pickup_reminder') AND event_version>0));
-- One lifetime slot per booking/type, independent of revisions or matching due dates.
CREATE UNIQUE INDEX booking_reminder_once ON notification_jobs(booking_id,event) WHERE event IN ('dropoff_reminder','pickup_reminder');
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_state_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_state_check CHECK (state IN ('pending','sending','sent','needs_review','skipped'));
CREATE TABLE reminder_schedule_runs (
 reminder_date date NOT NULL,event text NOT NULL CHECK(event IN ('dropoff_reminder','pickup_reminder')),
 wake_at timestamptz NOT NULL,run_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(reminder_date,event)
);
