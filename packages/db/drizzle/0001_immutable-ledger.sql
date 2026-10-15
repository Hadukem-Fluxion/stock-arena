CREATE FUNCTION "reject_points_ledger_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'points_ledger is append-only; insert an admin_adjustment correction instead'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "points_ledger_immutable"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "points_ledger"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_points_ledger_mutation"();
