-- 015: add ai_analysis JSONB column for upload-time AI task inference
ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
