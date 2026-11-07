-- Existing arrival values and notification history are preserved verbatim.
ALTER TABLE entries ADD COLUMN pickup_time time without time zone;
ALTER TABLE entries ADD CONSTRAINT entries_pickup_time_check CHECK (
  pickup_time IS NULL OR (kind='booking' AND pickup_time BETWEEN TIME '06:00' AND TIME '23:00'
    AND EXTRACT(SECOND FROM pickup_time)=0 AND EXTRACT(MINUTE FROM pickup_time)::integer % 15=0)
);
ALTER TABLE entries ADD CONSTRAINT entries_same_day_times_check CHECK (
  start_date<>end_date OR arrival_time IS NULL OR pickup_time IS NULL OR pickup_time>arrival_time
);
-- A normal CHECK would reject unrelated updates to grandfathered arrivals.
-- Validate new values only; unchanged legacy arrivals survive cancellations,
-- approvals, date edits and independent pickup edits.
CREATE FUNCTION validate_new_arrival_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.arrival_time IS DISTINCT FROM OLD.arrival_time THEN
    IF NEW.arrival_time IS NOT NULL AND NEW.arrival_time NOT BETWEEN TIME '06:00' AND TIME '23:00' THEN
      RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='entries_arrival_window_check', MESSAGE='Invalid new arrival time';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entries_arrival_window BEFORE INSERT OR UPDATE OF arrival_time ON entries
FOR EACH ROW EXECUTE FUNCTION validate_new_arrival_window();

-- The existing arrival_revision is the shared optimistic revision for both times.
-- Previous workers explicitly allowlist known events and will not claim this one.
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_version_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_version_check CHECK (
  (event IN ('arrival_changed','times_changed') AND event_version>0) OR
  (event NOT IN ('arrival_changed','times_changed') AND event_version=0)
);
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_check CHECK (
  event IN ('requested','approved','declined','owner_cancelled','admin_cancelled','arrival_changed','times_changed')
);
