-- Independent review: serialize first profile writes and exclude suspended sitters.
CREATE OR REPLACE FUNCTION save_sitter(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); current sitters; result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sitter:' || who::text,0));
 SELECT * INTO current FROM sitters WHERE user_id=who FOR UPDATE;
 IF current.id IS NOT NULL AND EXISTS(SELECT 1 FROM bookings WHERE sitter_id=current.id AND status IN ('pending','confirmed') AND end_date >= (now() AT TIME ZONE 'Europe/Stockholm')::date)
 AND (current.capacity<>(p->>'capacity')::int OR current.resident_dogs<>(p->>'residentDogs')::boolean OR current.sizes<>ARRAY(SELECT jsonb_array_elements_text(p->'sizes')) OR current.services<>ARRAY(SELECT jsonb_array_elements_text(p->'services'))) THEN
   RAISE EXCEPTION 'active commitments' USING ERRCODE='P0001'; END IF;
 INSERT INTO sitters(user_id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences)
 VALUES(who,p->>'name',p->>'area',(p->>'latitude')::numeric,(p->>'longitude')::numeric,(p->>'radiusKm')::int,p->>'description',ARRAY(SELECT jsonb_array_elements_text(p->'sizes')),(p->>'experienceYears')::int,(p->>'dailyPrice')::int,(p->>'capacity')::int,(p->>'residentDogs')::boolean,ARRAY(SELECT jsonb_array_elements_text(p->'services')),ARRAY(SELECT jsonb_array_elements_text(p->'preferences')))
 ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,area=excluded.area,latitude=excluded.latitude,longitude=excluded.longitude,radius_km=excluded.radius_km,description=excluded.description,sizes=excluded.sizes,experience_years=excluded.experience_years,daily_price=excluded.daily_price,capacity=excluded.capacity,resident_dogs=excluded.resident_dogs,services=excluded.services,preferences=excluded.preferences RETURNING id INTO result;
 RETURN result;
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
    SELECT 1 FROM reservations r WHERE r.sitter_id=s.id AND r.slot=free.slot AND r.active AND r.start_date=a+days.i
   )) < CASE WHEN exclusive THEN s.capacity ELSE units END
 )
 FROM sitters s WHERE published AND EXISTS(SELECT 1 FROM "user" u WHERE u.id=s.user_id AND u."isActive") ORDER BY id;
END $$;

CREATE OR REPLACE FUNCTION request_booking(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); s sitters; a date:=(p->>'startDate')::date; b date:=(p->>'endDate')::date;
 ids uuid[]; existing bookings; bid uuid; dog dogs; exclusive boolean; slots int[]; needed int; reservation_day date;
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
   RETURN existing.id;
 END IF;
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
 IF b.status=decision THEN RETURN; END IF;
 IF b.revision<>expected_revision OR b.end_date<(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date OR b.status NOT IN ('pending','confirmed') OR (b.status='confirmed' AND decision<>'cancelled') THEN RAISE EXCEPTION 'stale decision' USING ERRCODE='P0001'; END IF;
 UPDATE bookings SET status=decision,revision=revision+1 WHERE id=bid;
 IF decision IN ('declined','cancelled') THEN
   UPDATE reservations SET active=false WHERE booking_id=bid;
   UPDATE booking_dogs SET active=false WHERE booking_id=bid;
 END IF;
END $$;
