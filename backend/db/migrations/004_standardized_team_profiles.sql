BEGIN;

ALTER TABLE rescue_teams
  ADD COLUMN IF NOT EXISTS primary_category VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rescue_teams_primary_category_check'
  ) THEN
    ALTER TABLE rescue_teams ADD CONSTRAINT rescue_teams_primary_category_check CHECK (
      primary_category IS NULL OR primary_category IN (
        'flood_water_rescue',
        'fire_urban_rescue',
        'medical_response',
        'search_evacuation',
        'general_disaster_response'
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rescue_teams_primary_category
  ON rescue_teams(primary_category)
  WHERE primary_category IS NOT NULL;

COMMIT;
