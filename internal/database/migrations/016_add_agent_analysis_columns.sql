-- 016: Add Agent-mode analysis extension columns (backward compatible)
-- Keep classic fields unchanged; only append JSONB columns for Agent outputs.

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS agent_data_report JSONB;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS agent_advice JSONB;
