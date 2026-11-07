-- Optional local clock time on the booking's first day, in Europe/Stockholm.
-- Date occupancy and the per-dog/block exclusion constraint stay untouched.
ALTER TABLE entries ADD COLUMN arrival_time time without time zone;
ALTER TABLE entries ADD COLUMN arrival_revision integer NOT NULL DEFAULT 0 CHECK (arrival_revision >= 0);
ALTER TABLE entries ADD CONSTRAINT entries_arrival_time_check CHECK (
  arrival_time IS NULL OR (
    kind = 'booking' AND arrival_time < TIME '24:00'
    AND EXTRACT(SECOND FROM arrival_time) = 0
    AND EXTRACT(MINUTE FROM arrival_time)::integer % 15 = 0
  )
);

-- Deploy the compatible ON CONFLICT DO NOTHING producer and event-filtered
-- worker before this migration. Old events remain unique at version zero;
-- each arrival revision can enqueue exactly one independent notification.
ALTER TABLE notification_jobs ADD COLUMN event_version integer NOT NULL DEFAULT 0;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_version_check
CHECK ((event = 'arrival_changed' AND event_version > 0) OR (event <> 'arrival_changed' AND event_version = 0));
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_booking_event_version_key
UNIQUE (booking_id, event, event_version);
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_booking_id_event_key;
ALTER TABLE notification_jobs DROP CONSTRAINT notification_jobs_event_check;
ALTER TABLE notification_jobs ADD CONSTRAINT notification_jobs_event_check CHECK (
  event IN ('requested','approved','declined','owner_cancelled','admin_cancelled','arrival_changed')
);
