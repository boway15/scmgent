DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'uncoverable_by_new_po';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
