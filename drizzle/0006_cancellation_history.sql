-- Do not invent cancellation times for historical rows. This additive trigger
-- also timestamps cancellations made by the previous app during a rolling release.
ALTER TABLE entries ADD COLUMN cancelled_at timestamptz;
ALTER TABLE entries ADD CONSTRAINT entries_cancelled_at_check CHECK (
  cancelled_at IS NULL OR (kind='booking' AND booking_status='cancelled')
);
CREATE FUNCTION record_booking_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.kind='booking' AND NEW.booking_status='cancelled' THEN
    IF OLD.booking_status IS DISTINCT FROM 'cancelled' THEN
      NEW.cancelled_at := clock_timestamp();
    ELSE
      NEW.cancelled_at := OLD.cancelled_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- PostgreSQL orders BEFORE triggers by name: reservation/status sync runs first.
CREATE TRIGGER entries_cancellation_timestamp
BEFORE UPDATE OF status,booking_status ON entries
FOR EACH ROW EXECUTE FUNCTION record_booking_cancellation();
CREATE INDEX entries_cancelled_at_idx ON entries(cancelled_at)
WHERE kind='booking' AND booking_status='cancelled';
