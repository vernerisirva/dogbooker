CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE "user" (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 "emailVerified" boolean NOT NULL DEFAULT false, image text,
 "isActive" boolean NOT NULL DEFAULT true,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "session" (
 id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account (
 id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 "accountId" text NOT NULL, "providerId" text NOT NULL, password text,
 "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz,
 "refreshTokenExpiresAt" timestamptz, scope text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE ("providerId","accountId")
);
CREATE TABLE verification (
 id uuid PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "rateLimit" (id uuid PRIMARY KEY, key text UNIQUE NOT NULL, count integer NOT NULL, "lastRequest" bigint NOT NULL);
CREATE INDEX sessions_user_idx ON "session"("userId");
CREATE INDEX account_user ON account("userId");
CREATE INDEX verification_identifier ON verification(identifier);

CREATE FUNCTION actor_id() RETURNS uuid LANGUAGE sql STABLE SET search_path=public,pg_temp AS
 $$ SELECT nullif(current_setting('app.actor_id',true),'')::uuid $$;
CREATE FUNCTION require_actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "user" WHERE id=actor_id() AND "isActive") THEN
   RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
 END IF;
 RETURN actor_id();
END $$;

-- No addresses or contact details belong in this public-profile model.
CREATE TABLE sitters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES "user"(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80), area text NOT NULL CHECK(length(area) BETWEEN 1 AND 100),
 latitude numeric(5,2) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude numeric(5,2) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_km integer NOT NULL CHECK(radius_km BETWEEN 1 AND 100), description text NOT NULL CHECK(length(description)<=2000),
 sizes text[] NOT NULL CHECK(cardinality(sizes)>0 AND sizes <@ ARRAY['small','medium','large']),
 experience_years integer NOT NULL CHECK(experience_years BETWEEN 0 AND 80),
 daily_price integer NOT NULL CHECK(daily_price BETWEEN 100 AND 1000000),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 10), resident_dogs boolean NOT NULL,
 services text[] NOT NULL CHECK(services <@ ARRAY['medication','puppy','senior']),
 preferences text[] NOT NULL CHECK(preferences <@ ARRAY['quiet','active','garden']),
 published boolean NOT NULL DEFAULT true
);
CREATE TABLE dogs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES "user"(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80), size text NOT NULL CHECK(size IN ('small','medium','large')),
 age_years integer NOT NULL CHECK(age_years BETWEEN 0 AND 30), breed text NOT NULL DEFAULT '' CHECK(length(breed)<=100),
 social boolean NOT NULL, requirements text[] NOT NULL CHECK(requirements <@ ARRAY['medication','puppy','senior']),
 preferences text[] NOT NULL CHECK(preferences <@ ARRAY['quiet','active','garden']),
 care_notes text NOT NULL DEFAULT '' CHECK(length(care_notes)<=2000), UNIQUE(id,owner_id)
);
CREATE TABLE availability (
 sitter_id uuid NOT NULL REFERENCES sitters(id), day date NOT NULL, PRIMARY KEY(sitter_id,day)
);
CREATE TABLE bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sitter_id uuid NOT NULL REFERENCES sitters(id),
 owner_id uuid NOT NULL REFERENCES "user"(id), start_date date NOT NULL, end_date date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','declined','cancelled')),
 request_key uuid NOT NULL, payload jsonb NOT NULL,
 daily_price integer NOT NULL CHECK(daily_price>0), total_price integer NOT NULL CHECK(total_price>0),
 revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_date>=start_date AND end_date-start_date<31),
 UNIQUE(owner_id,request_key), UNIQUE(id,sitter_id,owner_id)
);
CREATE TABLE booking_dogs (
 booking_id uuid NOT NULL, sitter_id uuid NOT NULL, owner_id uuid NOT NULL, dog_id uuid NOT NULL,
 start_date date NOT NULL, end_date date NOT NULL, active boolean NOT NULL DEFAULT true, snapshot jsonb NOT NULL,
 PRIMARY KEY(booking_id,dog_id),
 FOREIGN KEY(booking_id,sitter_id,owner_id) REFERENCES bookings(id,sitter_id,owner_id),
 FOREIGN KEY(dog_id,owner_id) REFERENCES dogs(id,owner_id),
 EXCLUDE USING gist(dog_id WITH =, daterange(start_date,end_date,'[]') WITH &&) WHERE(active)
);
-- One slot per dog, or every slot for a party needing a home to itself.
CREATE TABLE reservations (
 booking_id uuid NOT NULL, sitter_id uuid NOT NULL, owner_id uuid NOT NULL,
 slot integer NOT NULL CHECK(slot BETWEEN 1 AND 10), start_date date NOT NULL, end_date date NOT NULL,
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(booking_id,slot),
 FOREIGN KEY(booking_id,sitter_id,owner_id) REFERENCES bookings(id,sitter_id,owner_id),
 EXCLUDE USING gist(sitter_id WITH =, slot WITH =, daterange(start_date,end_date,'[]') WITH &&) WHERE(active)
);
CREATE INDEX bookings_sitter_date ON bookings(sitter_id,start_date);
CREATE INDEX bookings_owner_date ON bookings(owner_id,start_date);
CREATE INDEX dogs_owner ON dogs(owner_id);

ALTER TABLE sitters ENABLE ROW LEVEL SECURITY;
ALTER TABLE dogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_dogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_sitter ON sitters FOR SELECT USING(user_id=actor_id());
CREATE POLICY own_dogs ON dogs FOR SELECT USING(owner_id=actor_id());
CREATE POLICY own_availability ON availability FOR SELECT USING(EXISTS(SELECT 1 FROM sitters s WHERE s.id=sitter_id AND s.user_id=actor_id()));
CREATE POLICY booking_parties ON bookings FOR SELECT USING(owner_id=actor_id() OR EXISTS(SELECT 1 FROM sitters s WHERE s.id=sitter_id AND s.user_id=actor_id()));
CREATE POLICY care_parties ON booking_dogs FOR SELECT USING(owner_id=actor_id() OR (active AND end_date >= (now() AT TIME ZONE 'Europe/Stockholm')::date AND EXISTS(SELECT 1 FROM sitters s WHERE s.id=sitter_id AND s.user_id=actor_id())));
-- Reservations have no runtime SELECT grant or policy: search returns eligibility only.

CREATE FUNCTION check_range(a date,b date) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF a IS NULL OR b IS NULL OR b<a OR b-a>30 OR a<(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date OR b>(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date+365 THEN
 RAISE EXCEPTION 'invalid dates' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION save_dog(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); result uuid;
BEGIN
 IF p->>'id' IS NOT NULL THEN
  UPDATE dogs SET name=p->>'name',size=p->>'size',age_years=(p->>'ageYears')::int,breed=p->>'breed',social=(p->>'social')::boolean,
    requirements=ARRAY(SELECT jsonb_array_elements_text(p->'requirements')), preferences=ARRAY(SELECT jsonb_array_elements_text(p->'preferences')),care_notes=p->>'careNotes'
  WHERE id=(p->>'id')::uuid AND owner_id=who RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 ELSE
  INSERT INTO dogs(owner_id,name,size,age_years,breed,social,requirements,preferences,care_notes)
  VALUES(who,p->>'name',p->>'size',(p->>'ageYears')::int,p->>'breed',(p->>'social')::boolean,
    ARRAY(SELECT jsonb_array_elements_text(p->'requirements')),ARRAY(SELECT jsonb_array_elements_text(p->'preferences')),p->>'careNotes') RETURNING id INTO result;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION save_sitter(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); current sitters; result uuid;
BEGIN
 SELECT * INTO current FROM sitters WHERE user_id=who FOR UPDATE;
 IF current.id IS NOT NULL AND EXISTS(SELECT 1 FROM bookings WHERE sitter_id=current.id AND status IN ('pending','confirmed') AND end_date >= (now() AT TIME ZONE 'Europe/Stockholm')::date)
 AND (current.capacity<>(p->>'capacity')::int OR current.resident_dogs<>(p->>'residentDogs')::boolean OR current.sizes<>ARRAY(SELECT jsonb_array_elements_text(p->'sizes')) OR current.services<>ARRAY(SELECT jsonb_array_elements_text(p->'services'))) THEN
   RAISE EXCEPTION 'active commitments' USING ERRCODE='P0001'; END IF;
 INSERT INTO sitters(user_id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences)
 VALUES(who,p->>'name',p->>'area',(p->>'latitude')::numeric,(p->>'longitude')::numeric,(p->>'radiusKm')::int,p->>'description',ARRAY(SELECT jsonb_array_elements_text(p->'sizes')),(p->>'experienceYears')::int,(p->>'dailyPrice')::int,(p->>'capacity')::int,(p->>'residentDogs')::boolean,ARRAY(SELECT jsonb_array_elements_text(p->'services')),ARRAY(SELECT jsonb_array_elements_text(p->'preferences')))
 ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,area=excluded.area,latitude=excluded.latitude,longitude=excluded.longitude,radius_km=excluded.radius_km,description=excluded.description,sizes=excluded.sizes,experience_years=excluded.experience_years,daily_price=excluded.daily_price,capacity=excluded.capacity,resident_dogs=excluded.resident_dogs,services=excluded.services,preferences=excluded.preferences RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION set_availability(a date,b date,available boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); sid uuid;
BEGIN
 PERFORM check_range(a,b);
 SELECT id INTO sid FROM sitters WHERE user_id=who FOR UPDATE;
 IF sid IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF available THEN INSERT INTO availability SELECT sid,a+i FROM generate_series(0,b-a) i ON CONFLICT DO NOTHING;
 ELSE
  IF EXISTS(SELECT 1 FROM bookings WHERE sitter_id=sid AND status IN ('pending','confirmed') AND daterange(start_date,end_date,'[]') && daterange(a,b,'[]')) THEN RAISE EXCEPTION 'active commitments' USING ERRCODE='P0001'; END IF;
  DELETE FROM availability WHERE sitter_id=sid AND day BETWEEN a AND b;
 END IF;
END $$;
CREATE FUNCTION distance_km(a double precision,b double precision,c double precision,d double precision) RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT 6371*2*asin(sqrt(least(1.0,power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2)))) $$;
CREATE FUNCTION public_sitters(a date,b date,units int,exclusive boolean) RETURNS TABLE(profile jsonb,available boolean,capacity_ok boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM require_actor(); PERFORM check_range(a,b);
 IF units NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid units' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT to_jsonb(s)-'user_id',
 (SELECT count(*) FROM availability av WHERE av.sitter_id=s.id AND day BETWEEN a AND b)=b-a+1,
 units<=s.capacity AND (SELECT count(*) FROM generate_series(1,s.capacity) AS free(slot) WHERE NOT EXISTS(SELECT 1 FROM reservations r WHERE r.sitter_id=s.id AND r.slot=free.slot AND r.active AND daterange(r.start_date,r.end_date,'[]') && daterange(a,b,'[]'))) >= CASE WHEN exclusive THEN s.capacity ELSE units END
 FROM sitters s WHERE published ORDER BY id;
END $$;

CREATE FUNCTION request_booking(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); s sitters; a date:=(p->>'startDate')::date; b date:=(p->>'endDate')::date;
 ids uuid[]; existing bookings; bid uuid; dog dogs; exclusive boolean; slots int[]; needed int;
BEGIN
 PERFORM check_range(a,b);
 SELECT array_agg(x::uuid ORDER BY x) INTO ids FROM jsonb_array_elements_text(p->'dogIds') x;
 IF cardinality(ids) NOT BETWEEN 1 AND 5 OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'invalid dogs' USING ERRCODE='22023'; END IF;
 -- Scope retry serialization to this actor/key, including changed sitter/dates payloads.
 PERFORM pg_advisory_xact_lock(hashtextextended(who::text || (p->>'requestKey'),0));
 SELECT * INTO existing FROM bookings WHERE owner_id=who AND request_key=(p->>'requestKey')::uuid;
 IF existing.id IS NOT NULL THEN
   IF existing.payload<>p THEN RAISE EXCEPTION 'changed retry' USING ERRCODE='P0001'; END IF;
   RETURN existing.id;
 END IF;
 SELECT * INTO s FROM sitters WHERE id=(p->>'sitterId')::uuid AND published FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF s.user_id=who THEN RAISE EXCEPTION 'self booking' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM dogs WHERE id=ANY(ids) ORDER BY id FOR SHARE;
 IF (SELECT count(*) FROM dogs WHERE id=ANY(ids) AND owner_id=who)<>cardinality(ids) THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF (SELECT count(*) FROM availability WHERE sitter_id=s.id AND day BETWEEN a AND b)<>b-a+1 THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='P0001'; END IF;
 IF distance_km((p->>'latitude')::float,(p->>'longitude')::float,s.latitude::float,s.longitude::float)>s.radius_km THEN RAISE EXCEPTION 'outside area' USING ERRCODE='22023'; END IF;
 SELECT bool_or(NOT social) INTO exclusive FROM dogs WHERE id=ANY(ids);
 IF cardinality(ids)>s.capacity OR (exclusive AND s.resident_dogs) OR EXISTS(SELECT 1 FROM dogs WHERE id=ANY(ids) AND (NOT size=ANY(s.sizes) OR NOT requirements<@s.services)) THEN RAISE EXCEPTION 'incompatible' USING ERRCODE='22023'; END IF;
 needed:=CASE WHEN exclusive THEN s.capacity ELSE cardinality(ids) END;
 SELECT array_agg(slot ORDER BY slot) INTO slots FROM generate_series(1,s.capacity) AS free(slot) WHERE NOT EXISTS(SELECT 1 FROM reservations r WHERE r.sitter_id=s.id AND r.slot=free.slot AND r.active AND daterange(r.start_date,r.end_date,'[]') && daterange(a,b,'[]'));
 IF coalesce(cardinality(slots),0)<needed THEN RAISE EXCEPTION 'capacity' USING ERRCODE='P0001'; END IF;
 IF (p->>'expectedDailyPrice')::int IS DISTINCT FROM s.daily_price THEN RAISE EXCEPTION 'price changed' USING ERRCODE='P0001'; END IF;
 INSERT INTO bookings(sitter_id,owner_id,start_date,end_date,request_key,payload,daily_price,total_price)
 VALUES(s.id,who,a,b,(p->>'requestKey')::uuid,p,s.daily_price,s.daily_price*(b-a+1)*cardinality(ids)) RETURNING id INTO bid;
 FOR dog IN SELECT * FROM dogs WHERE id=ANY(ids) ORDER BY id LOOP
   INSERT INTO booking_dogs VALUES(bid,s.id,who,dog.id,a,b,true,to_jsonb(dog)-'owner_id');
 END LOOP;
 INSERT INTO reservations SELECT bid,s.id,who,slots[i],a,b,true FROM generate_series(1,needed) i;
 RETURN bid;
END $$;
CREATE FUNCTION decide_booking(bid uuid,decision text,expected_revision int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid:=require_actor(); b bookings; sitter_user uuid;
BEGIN
 -- Lock sitter before booking, consistently with request/profile/availability writes.
 SELECT s.user_id INTO sitter_user FROM sitters s JOIN bookings x ON x.sitter_id=s.id WHERE x.id=bid AND (s.user_id=who OR x.owner_id=who) FOR UPDATE OF s;
 SELECT * INTO b FROM bookings WHERE id=bid AND (owner_id=who OR sitter_user=who) FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF decision NOT IN ('confirmed','declined','cancelled') OR (decision<>'cancelled' AND sitter_user<>who) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF b.status=decision THEN RETURN; END IF;
 IF b.revision<>expected_revision OR b.end_date<(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date OR b.status NOT IN ('pending','confirmed') OR (b.status='confirmed' AND decision<>'cancelled') THEN RAISE EXCEPTION 'stale decision' USING ERRCODE='P0001'; END IF;
 UPDATE bookings SET status=decision,revision=revision+1 WHERE id=bid;
 IF decision IN ('declined','cancelled') THEN
   UPDATE reservations SET active=false WHERE booking_id=bid;
   UPDATE booking_dogs SET active=false WHERE booking_id=bid;
 END IF;
END $$;

-- Runtime cannot mutate domain tables or bypass RLS. Definer functions are the write boundary.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO marketplace_app,marketplace_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session",account,verification,"rateLimit" TO marketplace_auth;
GRANT SELECT ON sitters,dogs,availability,bookings,booking_dogs TO marketplace_app;
GRANT EXECUTE ON FUNCTION actor_id(),save_dog(jsonb),save_sitter(jsonb),set_availability(date,date,boolean),public_sitters(date,date,int,boolean),request_booking(jsonb),decide_booking(uuid,text,int) TO marketplace_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
