-- One owner account represents one dog. Use its stable UUID, never its name.
-- A booking occupies a singleton dog range; a block occupies every dog range.
-- GiST checks both dimensions, including concurrent uncommitted reservations.
CREATE TYPE dog_booking_scope AS RANGE (subtype = uuid);

ALTER TABLE entries ADD CONSTRAINT no_overlapping_dog_or_block_dates
EXCLUDE USING gist (
  (CASE WHEN kind = 'block'
    THEN dog_booking_scope(NULL, NULL, '()')
    ELSE dog_booking_scope(owner_id, owner_id, '[]')
  END) WITH &&,
  daterange(start_date, end_date, '[]') WITH &&
) WHERE (status = 'active');

-- The migration runner wraps this replacement in a transaction. Install the
-- new protection before removing the old one; no rows or history are rewritten.
ALTER TABLE entries DROP CONSTRAINT no_overlapping_active_dates;
