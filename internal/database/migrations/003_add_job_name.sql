-- Add name column to training_jobs for existing databases (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'training_jobs' AND column_name = 'name'
  ) THEN
    ALTER TABLE training_jobs ADD COLUMN name VARCHAR(200) DEFAULT '';
  END IF;
END $$;
