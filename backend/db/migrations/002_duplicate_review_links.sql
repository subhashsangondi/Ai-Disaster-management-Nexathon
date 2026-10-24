BEGIN;

ALTER TABLE possible_duplicates
  ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'possible_duplicates_distance_check'
  ) THEN
    ALTER TABLE possible_duplicates ADD CONSTRAINT possible_duplicates_distance_check
      CHECK (distance_km IS NULL OR distance_km >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS incident_duplicate_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  possible_duplicate_id UUID NOT NULL REFERENCES possible_duplicates(id) ON DELETE RESTRICT,
  incident_a_id UUID NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  incident_b_id UUID NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
  primary_incident_id UUID REFERENCES incidents(id) ON DELETE RESTRICT,
  reason TEXT CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 5 AND 2000),
  reviewed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT duplicate_review_distinct_incidents CHECK (incident_a_id <> incident_b_id),
  CONSTRAINT duplicate_review_primary_required CHECK (
    (decision = 'confirmed' AND primary_incident_id IN (incident_a_id, incident_b_id))
    OR (decision = 'rejected' AND primary_incident_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS incident_duplicate_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  duplicate_incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE RESTRICT,
  review_id UUID NOT NULL UNIQUE REFERENCES incident_duplicate_reviews(id) ON DELETE RESTRICT,
  assignment_conflict_acknowledged BOOLEAN NOT NULL DEFAULT false,
  linked_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolution_verified_at TIMESTAMPTZ,
  CONSTRAINT duplicate_link_distinct_incidents CHECK (primary_incident_id <> duplicate_incident_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_pair_time
  ON incident_duplicate_reviews(incident_a_id, incident_b_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_duplicate_links_primary
  ON incident_duplicate_links(primary_incident_id, linked_at);
CREATE INDEX IF NOT EXISTS idx_duplicate_links_resolution
  ON incident_duplicate_links(primary_incident_id, resolution_verified_at);

COMMIT;
