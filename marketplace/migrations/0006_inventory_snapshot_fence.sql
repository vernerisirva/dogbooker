-- A row lock alone does not invalidate an older Repeatable Read snapshot.
-- Every inventory/schedule mutation must write the same sitter row that profile
-- changes lock. A no-op UPDATE creates a new MVCC version without changing data:
-- stale writers then fail with 40001, including mixed-isolation callers.
-- Runtime functions already acquire sitter before booking/dog/inventory locks.
CREATE FUNCTION fence_sitter_inventory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  UPDATE sitters SET capacity=capacity WHERE id=OLD.sitter_id;
  RETURN OLD;
 END IF;
 UPDATE sitters SET capacity=capacity WHERE id=NEW.sitter_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fence_sitter_inventory() FROM PUBLIC,marketplace_app,marketplace_auth;

CREATE TRIGGER booking_inventory_fence
BEFORE INSERT OR UPDATE OF status OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION fence_sitter_inventory();

CREATE TRIGGER availability_inventory_fence
BEFORE INSERT OR UPDATE OR DELETE ON availability
FOR EACH ROW EXECUTE FUNCTION fence_sitter_inventory();
