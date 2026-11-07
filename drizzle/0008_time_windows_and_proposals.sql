-- Additive: existing effective times, bookings and notification history stay intact.
CREATE FUNCTION valid_sitting_time(t time) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT t BETWEEN TIME '06:00' AND TIME '23:00' AND EXTRACT(SECOND FROM t)=0 AND EXTRACT(MINUTE FROM t)::int % 15=0
$$;
CREATE TABLE time_window_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 arrival_start time NOT NULL DEFAULT '06:00', arrival_end time NOT NULL DEFAULT '23:00',
 pickup_start time NOT NULL DEFAULT '06:00', pickup_end time NOT NULL DEFAULT '23:00',
 CHECK (valid_sitting_time(arrival_start) AND valid_sitting_time(arrival_end) AND arrival_start<=arrival_end),
 CHECK (valid_sitting_time(pickup_start) AND valid_sitting_time(pickup_end) AND pickup_start<=pickup_end)
);
INSERT INTO time_window_settings(id) VALUES(true);
CREATE TABLE time_window_overrides (
 date date PRIMARY KEY,
 arrival_start time NOT NULL, arrival_end time NOT NULL,
 pickup_start time NOT NULL, pickup_end time NOT NULL,
 CHECK (valid_sitting_time(arrival_start) AND valid_sitting_time(arrival_end) AND arrival_start<=arrival_end),
 CHECK (valid_sitting_time(pickup_start) AND valid_sitting_time(pickup_end) AND pickup_start<=pickup_end)
);
CREATE TABLE booking_time_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK (revision>0),
 proposer_role text NOT NULL CHECK (proposer_role IN ('owner','admin')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','superseded')),
 current_arrival time, current_pickup time,
 proposed_arrival time, proposed_pickup time,
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 CHECK (proposed_arrival IS NOT DISTINCT FROM current_arrival OR valid_sitting_time(proposed_arrival)),
 CHECK (proposed_pickup IS NOT DISTINCT FROM current_pickup OR valid_sitting_time(proposed_pickup)),
 UNIQUE (booking_id,revision)
);
CREATE UNIQUE INDEX booking_one_pending_time_proposal ON booking_time_proposals(booking_id) WHERE status='pending';
-- Dates/owner changes invalidate proposals even if made by an older deployment.
CREATE FUNCTION invalidate_booking_time_proposals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date THEN
   NEW.arrival_revision := GREATEST(NEW.arrival_revision,OLD.arrival_revision+1);
 END IF;
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date
    OR NEW.arrival_time IS DISTINCT FROM OLD.arrival_time OR NEW.pickup_time IS DISTINCT FROM OLD.pickup_time
    OR NEW.booking_status IN ('cancelled','declined') THEN
   UPDATE booking_time_proposals SET status='superseded',resolved_at=clock_timestamp() WHERE booking_id=NEW.id AND status='pending';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entries_time_proposals BEFORE UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION invalidate_booking_time_proposals();
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_version_check;
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_check CHECK (event IN (
 'requested','approved','declined','owner_cancelled','admin_cancelled','arrival_changed','times_changed',
 'time_change_requested','time_change_approved','time_change_declined','time_change_proposed','time_change_accepted','time_change_rejected','time_change_direct'));
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_version_check CHECK (
 (event IN ('requested','approved','declined','owner_cancelled','admin_cancelled') AND event_version=0) OR
 (event NOT IN ('requested','approved','declined','owner_cancelled','admin_cancelled') AND event_version>0));
