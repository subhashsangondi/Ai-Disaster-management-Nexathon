BEGIN;

ALTER TABLE rescue_teams
  ADD COLUMN IF NOT EXISTS capabilities TEXT[],
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS base_location_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_info VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rescue_teams_valid_coordinates'
  ) THEN
    ALTER TABLE rescue_teams ADD CONSTRAINT rescue_teams_valid_coordinates CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rescue_teams_capability_limit'
  ) THEN
    ALTER TABLE rescue_teams ADD CONSTRAINT rescue_teams_capability_limit CHECK (
      capabilities IS NULL OR cardinality(capabilities) BETWEEN 1 AND 20
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rescue_teams_base_location_length'
  ) THEN
    ALTER TABLE rescue_teams ADD CONSTRAINT rescue_teams_base_location_length CHECK (
      base_location_name IS NULL OR length(trim(base_location_name)) BETWEEN 2 AND 255
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rescue_teams_coordinates
  ON rescue_teams(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rescue_teams_capabilities
  ON rescue_teams USING GIN(capabilities);

COMMIT;
