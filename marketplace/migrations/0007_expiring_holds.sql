-- Applied once by the checksum/advisory-lock migration runner, in one transaction.
CREATE TABLE booking_hold_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 duration_seconds integer NOT NULL DEFAULT 172800 CHECK(duration_seconds BETWEEN 1 AND 604800)
);
INSERT INTO booking_hold_policy VALUES(true,172800);
REVOKE ALL ON booking_hold_policy FROM PUBLIC,marketplace_app,marketplace_auth;

ALTER TABLE bookings ADD COLUMN expires_at timestamptz, ADD COLUMN expired_at timestamptz;
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK(status IN ('pending','confirmed','declined','cancelled','expired'));
-- Every legacy pending request gets the full fresh grace, never from creation.
-- A separate approval cutoff below forbids approving an already-started stay.
WITH migration_clock AS MATERIALIZED (SELECT clock_timestamp() AS instant)
UPDATE bookings SET expires_at=instant+interval '48 hours'
FROM migration_clock WHERE status='pending' AND expires_at IS NULL;
ALTER TABLE bookings ADD CONSTRAINT pending_hold_deadline CHECK(status NOT IN ('pending','expired') OR expires_at IS NOT NULL);
ALTER TABLE bookings ADD CONSTRAINT expired_hold_audit CHECK((status='expired')=(expired_at IS NOT NULL));
CREATE INDEX bookings_due_holds ON bookings(expires_at,sitter_id,id) WHERE status='pending';

-- This trigger runs after booking_inventory_fence's sitter MVCC write. Time is
-- checked after waits, at the serialized transition, never inside an exclusion.
CREATE FUNCTION guard_booking_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE instant timestamptz:=clock_timestamp(); duration int;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='pending' THEN
   SELECT duration_seconds INTO STRICT duration FROM booking_hold_policy WHERE singleton;
   NEW.created_at:=instant;
   NEW.expires_at:=least(instant+duration*interval '1 second',NEW.start_date::timestamp AT TIME ZONE 'Europe/Stockholm');
   IF NEW.expires_at<=instant THEN RAISE EXCEPTION 'stay already begun' USING ERRCODE='P0003'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
  RAISE EXCEPTION 'immutable hold' USING ERRCODE='23514';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF OLD.status NOT IN ('pending','confirmed') OR (OLD.status='confirmed' AND NEW.status<>'cancelled')
   OR NEW.status NOT IN ('confirmed','declined','cancelled','expired') THEN
   RAISE EXCEPTION 'invalid transition' USING ERRCODE='23514';
  END IF;
  IF OLD.status='pending' AND OLD.expires_at<=instant THEN NEW.status:='expired';
  ELSIF NEW.status='expired' THEN RAISE EXCEPTION 'hold not due' USING ERRCODE='23514'; END IF;
  IF NEW.status='confirmed' AND NEW.start_date::timestamp AT TIME ZONE 'Europe/Stockholm'<=instant THEN
   RAISE EXCEPTION 'stay already begun' USING ERRCODE='P0003';
  END IF;
  NEW.revision:=OLD.revision+1;
  IF NEW.status='expired' THEN NEW.expired_at:=instant; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_lifecycle_guard BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION guard_booking_hold();

CREATE FUNCTION release_booking_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IN ('declined','cancelled','expired') AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE reservations SET active=false WHERE booking_id=NEW.id;
  UPDATE booking_dogs SET active=false WHERE booking_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_hold_release AFTER UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION release_booking_hold();

-- Internal helper: sitter first, then booking, then reservation/dog rows. The
-- existing inventory fence makes stale Repeatable Read/Serializable writers abort.
CREATE FUNCTION expire_sitter_holds(sid uuid, batch_size int DEFAULT 2147483647) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed int;
BEGIN
 PERFORM 1 FROM sitters WHERE id=sid FOR UPDATE;
 WITH due AS MATERIALIZED (
  SELECT id FROM bookings WHERE sitter_id=sid AND status='pending' AND expires_at<=clock_timestamp()
  ORDER BY expires_at,id LIMIT batch_size FOR UPDATE
 ) UPDATE bookings SET status='expired' WHERE id IN (SELECT id FROM due);
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END $$;

-- Deliberately actor-free, but only expires due rows and returns an aggregate.
-- No caller-supplied clock, tenant data, arbitrary IDs or mutation privilege.
CREATE FUNCTION expire_booking_holds(batch_size int DEFAULT 100) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sid uuid; changed int:=0;
BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid batch' USING ERRCODE='22023'; END IF;
 FOR sid IN SELECT s.id FROM sitters s WHERE EXISTS(
  SELECT 1 FROM bookings b WHERE b.sitter_id=s.id AND b.status='pending' AND b.expires_at<=clock_timestamp()
 ) ORDER BY s.id LIMIT batch_size FOR UPDATE OF s SKIP LOCKED LOOP
  changed:=changed+expire_sitter_holds(sid,batch_size-changed);
  EXIT WHEN changed>=batch_size;
 END LOOP;
 RETURN changed;
END $$;

CREATE FUNCTION reconcile_actor_holds() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); sid uuid;
BEGIN
 FOR sid IN SELECT s.id FROM sitters s WHERE EXISTS(
  SELECT 1 FROM bookings b WHERE b.sitter_id=s.id AND (b.owner_id=who OR s.user_id=who)
   AND b.status='pending' AND b.expires_at<=clock_timestamp()
 ) ORDER BY s.id FOR UPDATE OF s LOOP
  PERFORM expire_sitter_holds(sid);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION guard_booking_hold(),release_booking_hold(),expire_sitter_holds(uuid,int),expire_booking_holds(int),reconcile_actor_holds() FROM PUBLIC,marketplace_app,marketplace_auth;
GRANT EXECUTE ON FUNCTION expire_booking_holds(int),reconcile_actor_holds() TO marketplace_app;

-- Sitter access to care ends at the deadline even if no cleanup has run yet.
DROP POLICY care_parties ON booking_dogs;
CREATE POLICY care_parties ON booking_dogs FOR SELECT USING(owner_id=actor_id() OR (
 active AND end_date >= (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date
 AND EXISTS(SELECT 1 FROM sitters s WHERE s.id=sitter_id AND s.user_id=actor_id())
 AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND
  (b.status='confirmed' OR (b.status='pending' AND b.expires_at>clock_timestamp())))
));

CREATE OR REPLACE FUNCTION save_sitter(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); current sitters; result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sitter:' || who::text,0));
 SELECT * INTO current FROM sitters WHERE user_id=who FOR UPDATE;
 IF current.id IS NOT NULL THEN PERFORM expire_sitter_holds(current.id); END IF;
 IF current.id IS NOT NULL AND EXISTS(SELECT 1 FROM bookings WHERE sitter_id=current.id AND status IN ('pending','confirmed') AND end_date >= (now() AT TIME ZONE 'Europe/Stockholm')::date)
 AND (current.capacity<>(p->>'capacity')::int OR current.resident_dogs<>(p->>'residentDogs')::boolean OR current.sizes<>ARRAY(SELECT jsonb_array_elements_text(p->'sizes')) OR current.services<>ARRAY(SELECT jsonb_array_elements_text(p->'services'))) THEN
   RAISE EXCEPTION 'active commitments' USING ERRCODE='P0001'; END IF;
 INSERT INTO sitters(user_id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences)
 VALUES(who,p->>'name',p->>'area',(p->>'latitude')::numeric,(p->>'longitude')::numeric,(p->>'radiusKm')::int,p->>'description',ARRAY(SELECT jsonb_array_elements_text(p->'sizes')),(p->>'experienceYears')::int,(p->>'dailyPrice')::int,(p->>'capacity')::int,(p->>'residentDogs')::boolean,ARRAY(SELECT jsonb_array_elements_text(p->'services')),ARRAY(SELECT jsonb_array_elements_text(p->'preferences')))
 ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,area=excluded.area,latitude=excluded.latitude,longitude=excluded.longitude,radius_km=excluded.radius_km,description=excluded.description,sizes=excluded.sizes,experience_years=excluded.experience_years,daily_price=excluded.daily_price,capacity=excluded.capacity,resident_dogs=excluded.resident_dogs,services=excluded.services,preferences=excluded.preferences RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION set_availability(a date,b date,available boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); sid uuid;
BEGIN
 PERFORM check_range(a,b);
 SELECT id INTO sid FROM sitters WHERE user_id=who FOR UPDATE;
 IF sid IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 PERFORM expire_sitter_holds(sid);
 IF available THEN INSERT INTO availability SELECT sid,a+i FROM generate_series(0,b-a) i ON CONFLICT DO NOTHING;
 ELSE
  IF EXISTS(SELECT 1 FROM bookings WHERE sitter_id=sid AND status IN ('pending','confirmed') AND daterange(start_date,end_date,'[]') && daterange(a,b,'[]')) THEN RAISE EXCEPTION 'active commitments' USING ERRCODE='P0001'; END IF;
  DELETE FROM availability WHERE sitter_id=sid AND day BETWEEN a AND b;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public_sitters(a date,b date,units int,exclusive boolean) RETURNS TABLE(profile jsonb,available boolean,capacity_ok boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM require_actor(); PERFORM check_range(a,b);
 IF units IS NULL OR exclusive IS NULL OR units NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid units' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT to_jsonb(s)-'user_id',
 (SELECT count(*) FROM availability av WHERE av.sitter_id=s.id AND day BETWEEN a AND b)=b-a+1,
 units<=s.capacity AND NOT EXISTS(
  SELECT 1 FROM generate_series(0,b-a) AS days(i) WHERE
   (SELECT count(*) FROM generate_series(1,s.capacity) AS free(slot) WHERE NOT EXISTS(
    SELECT 1 FROM reservations r JOIN bookings b ON b.id=r.booking_id WHERE r.sitter_id=s.id AND r.slot=free.slot AND r.active AND (b.status='confirmed' OR (b.status='pending' AND b.expires_at>clock_timestamp())) AND r.start_date=a+days.i
   )) < CASE WHEN exclusive THEN s.capacity ELSE units END
 )
 FROM sitters s WHERE published AND EXISTS(SELECT 1 FROM "user" u WHERE u.id=s.user_id AND u."isActive") ORDER BY id;
END $$;

CREATE OR REPLACE FUNCTION request_booking(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); s sitters; a date:=(p->>'startDate')::date; b date:=(p->>'endDate')::date;
 ids uuid[]; existing bookings; bid uuid; dog dogs; exclusive boolean; slots int[]; needed int; reservation_day date; locked_sid uuid;
BEGIN
 PERFORM check_range(a,b);
 IF jsonb_typeof(p->'dogIds') IS DISTINCT FROM 'array' OR p->>'requestKey' IS NULL
 OR p->>'latitude' IS NULL OR p->>'longitude' IS NULL
 OR NOT ((p->>'latitude')::numeric BETWEEN -90 AND 90) OR NOT ((p->>'longitude')::numeric BETWEEN -180 AND 180) THEN
 RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
 SELECT array_agg(x::uuid ORDER BY x) INTO ids FROM jsonb_array_elements_text(p->'dogIds') x;
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 5 OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'invalid dogs' USING ERRCODE='22023'; END IF;
 -- Scope retry serialization to this actor/key, including changed sitter/dates payloads.
 PERFORM pg_advisory_xact_lock(hashtextextended(who::text || (p->>'requestKey'),0));
 SELECT * INTO existing FROM bookings WHERE owner_id=who AND request_key=(p->>'requestKey')::uuid;
 IF existing.id IS NOT NULL THEN
   IF existing.payload<>p THEN RAISE EXCEPTION 'changed retry' USING ERRCODE='P0001'; END IF;
   PERFORM expire_sitter_holds(existing.sitter_id);
   RETURN existing.id;
 END IF;
 -- Lock all affected sitters in UUID order before any booking/dog writes.
 FOR locked_sid IN SELECT x.id FROM sitters x WHERE x.id=(p->>'sitterId')::uuid OR EXISTS(
  SELECT 1 FROM bookings b JOIN booking_dogs d ON d.booking_id=b.id
  WHERE b.sitter_id=x.id AND b.owner_id=who AND d.dog_id=ANY(ids)
   AND b.status='pending' AND b.expires_at<=clock_timestamp()
 ) ORDER BY x.id FOR UPDATE OF x LOOP
  PERFORM expire_sitter_holds(locked_sid);
 END LOOP;
 SELECT * INTO s FROM sitters WHERE id=(p->>'sitterId')::uuid AND published AND EXISTS(SELECT 1 FROM "user" u WHERE u.id=sitters.user_id AND u."isActive") FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF s.user_id=who THEN RAISE EXCEPTION 'self booking' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM dogs WHERE id=ANY(ids) ORDER BY id FOR SHARE;
 PERFORM check_range(a,b); -- Recheck after potentially waiting across Stockholm midnight.
 IF (SELECT count(*) FROM dogs WHERE id=ANY(ids) AND owner_id=who)<>cardinality(ids) THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF (SELECT count(*) FROM availability WHERE sitter_id=s.id AND day BETWEEN a AND b)<>b-a+1 THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='P0001'; END IF;
 IF distance_km((p->>'latitude')::float,(p->>'longitude')::float,s.latitude::float,s.longitude::float)>s.radius_km THEN RAISE EXCEPTION 'outside area' USING ERRCODE='22023'; END IF;
 SELECT bool_or(NOT social) INTO exclusive FROM dogs WHERE id=ANY(ids);
 IF cardinality(ids)>s.capacity OR (exclusive AND s.resident_dogs) OR EXISTS(SELECT 1 FROM dogs WHERE id=ANY(ids) AND (NOT size=ANY(s.sizes) OR NOT requirements<@s.services)) THEN RAISE EXCEPTION 'incompatible' USING ERRCODE='22023'; END IF;
 needed:=CASE WHEN exclusive THEN s.capacity ELSE cardinality(ids) END;
 IF (p->>'expectedDailyPrice')::int IS DISTINCT FROM s.daily_price THEN RAISE EXCEPTION 'price changed' USING ERRCODE='P0001'; END IF;
 INSERT INTO bookings(sitter_id,owner_id,start_date,end_date,request_key,payload,daily_price,total_price)
 VALUES(s.id,who,a,b,(p->>'requestKey')::uuid,p,s.daily_price,s.daily_price*(b-a+1)*cardinality(ids)) RETURNING id INTO bid;
 FOR dog IN SELECT * FROM dogs WHERE id=ANY(ids) ORDER BY id LOOP
   INSERT INTO booking_dogs VALUES(bid,s.id,who,dog.id,a,b,true,to_jsonb(dog)-'owner_id');
 END LOOP;
 FOR reservation_day IN SELECT a+i FROM generate_series(0,b-a) i LOOP
  SELECT array_agg(slot ORDER BY slot) INTO slots FROM generate_series(1,s.capacity) AS free(slot)
  WHERE NOT EXISTS(SELECT 1 FROM reservations r WHERE r.sitter_id=s.id AND r.slot=free.slot AND r.active AND r.start_date=reservation_day);
  IF coalesce(cardinality(slots),0)<needed THEN RAISE EXCEPTION 'capacity' USING ERRCODE='P0001'; END IF;
  INSERT INTO reservations SELECT bid,s.id,who,slots[i],reservation_day,reservation_day,true FROM generate_series(1,needed) i;
 END LOOP;
 PERFORM check_range(a,b); -- Exclusion constraints may also wait for another transaction.
 IF EXISTS(SELECT 1 FROM bookings WHERE id=bid AND expires_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'hold elapsed during allocation' USING ERRCODE='P0003'; END IF;
 RETURN bid;
END $$;

CREATE OR REPLACE FUNCTION decide_booking(bid uuid,decision text,expected_revision int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); b bookings; sitter_user uuid;
BEGIN
 -- Lock sitter before booking, consistently with request/profile/availability writes.
 SELECT s.user_id INTO sitter_user FROM sitters s JOIN bookings x ON x.sitter_id=s.id WHERE x.id=bid AND (s.user_id=who OR x.owner_id=who) FOR UPDATE OF s;
 SELECT * INTO b FROM bookings WHERE id=bid AND (owner_id=who OR sitter_user=who) FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF expected_revision IS NULL OR expected_revision<0 OR decision IS NULL OR decision NOT IN ('confirmed','declined','cancelled') OR (decision<>'cancelled' AND sitter_user<>who) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF b.status='pending' AND b.expires_at<=clock_timestamp() THEN
  UPDATE bookings SET status='expired' WHERE id=bid;
  RETURN; -- Commit expiration; the service reports the resulting state after COMMIT.
 END IF;
 IF b.status='expired' OR b.status=decision THEN RETURN; END IF;
 IF decision='confirmed' AND b.start_date::timestamp AT TIME ZONE 'Europe/Stockholm'<=clock_timestamp() THEN
  RAISE EXCEPTION 'stay already begun' USING ERRCODE='P0003'; END IF;
 IF b.revision<>expected_revision OR (b.status='confirmed' AND b.end_date<(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date) OR b.status NOT IN ('pending','confirmed') OR (b.status='confirmed' AND decision<>'cancelled') THEN RAISE EXCEPTION 'stale decision' USING ERRCODE='P0001'; END IF;
 UPDATE bookings SET status=decision,revision=revision+1 WHERE id=bid;

END $$;
