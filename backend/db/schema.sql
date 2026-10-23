BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) >= 2),
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (role IN ('public', 'operator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rescue_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name VARCHAR(150) NOT NULL UNIQUE,
  availability VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'busy', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  emergency_type VARCHAR(100) NOT NULL CHECK (length(trim(emergency_type)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) >= 10),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_text TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'in_progress', 'resolved')),
  assigned_team_id UUID REFERENCES rescue_teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT usable_location CHECK (
    (latitude IS NOT NULL AND longitude IS NOT NULL)
    OR length(trim(COALESCE(location_text, ''))) > 0
  )
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  disaster_type VARCHAR(100) NOT NULL,
  urgency VARCHAR(20) NOT NULL
    CHECK (urgency IN ('critical', 'high', 'medium', 'low', 'unknown')),
  victim_count INTEGER CHECK (victim_count IS NULL OR victim_count >= 0),
  summary TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  requires_review BOOLEAN NOT NULL DEFAULT true,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incident_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES rescue_teams(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS possible_duplicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  possible_duplicate_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  similarity_score DOUBLE PRECISION NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT different_incidents CHECK (incident_id <> possible_duplicate_id),
  CONSTRAINT unique_duplicate_direction UNIQUE (incident_id, possible_duplicate_id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_emergency_type ON incidents(lower(emergency_type));
CREATE INDEX IF NOT EXISTS idx_incidents_coordinates ON incidents(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_team ON incidents(assigned_team_id);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_incident_time ON ai_analyses(incident_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_urgency ON ai_analyses(urgency);
CREATE INDEX IF NOT EXISTS idx_rescue_teams_availability ON rescue_teams(availability);
CREATE INDEX IF NOT EXISTS idx_possible_duplicates_incident ON possible_duplicates(incident_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incidents_set_updated_at ON incidents;
CREATE TRIGGER incidents_set_updated_at
BEFORE UPDATE ON incidents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
