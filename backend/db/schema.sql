BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) >= 2),
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (role IN ('public', 'operator', 'admin', 'responder')),
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
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
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
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  progress_status VARCHAR(30) NOT NULL DEFAULT 'assigned'
    CHECK (progress_status IN ('assigned', 'acknowledged', 'en_route', 'arrived', 'rescue_in_progress', 'completion_requested')),
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_memberships (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES rescue_teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL UNIQUE REFERENCES incident_assignments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES rescue_teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_by UUID REFERENCES users(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS assignment_progress_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES incident_assignments(id) ON DELETE CASCADE,
  progress_status VARCHAR(30) NOT NULL
    CHECK (progress_status IN ('acknowledged', 'en_route', 'arrived', 'rescue_in_progress', 'completion_requested')),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS completion_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES incident_assignments(id) ON DELETE CASCADE,
  completion_summary TEXT NOT NULL CHECK (length(trim(completion_summary)) BETWEEN 10 AND 5000),
  people_assisted INTEGER CHECK (people_assisted IS NULL OR people_assisted >= 0),
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS completion_review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_report_id UUID NOT NULL UNIQUE REFERENCES completion_reports(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason TEXT,
  decided_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT completion_rejection_reason CHECK (
    decision <> 'rejected' OR length(trim(COALESCE(reason, ''))) >= 5
  )
);

CREATE TABLE IF NOT EXISTS incident_tracking_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS possible_duplicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  possible_duplicate_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  similarity_score DOUBLE PRECISION NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
  distance_km DOUBLE PRECISION CHECK (distance_km IS NULL OR distance_km >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT different_incidents CHECK (incident_id <> possible_duplicate_id),
  CONSTRAINT unique_duplicate_direction UNIQUE (incident_id, possible_duplicate_id)
);

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

CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_emergency_type ON incidents(lower(emergency_type));
CREATE INDEX IF NOT EXISTS idx_incidents_coordinates ON incidents(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_team ON incidents(assigned_team_id);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_incident_time ON ai_analyses(incident_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_urgency ON ai_analyses(urgency);
CREATE INDEX IF NOT EXISTS idx_rescue_teams_availability ON rescue_teams(availability);
CREATE INDEX IF NOT EXISTS idx_possible_duplicates_incident ON possible_duplicates(incident_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_pair_time
  ON incident_duplicate_reviews(incident_a_id, incident_b_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_duplicate_links_primary
  ON incident_duplicate_links(primary_incident_id, linked_at);
CREATE INDEX IF NOT EXISTS idx_duplicate_links_resolution
  ON incident_duplicate_links(primary_incident_id, resolution_verified_at);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX IF NOT EXISTS idx_assignment_notifications_team_unread
  ON assignment_notifications(team_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_progress_assignment_time
  ON assignment_progress_events(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_completion_assignment_time
  ON completion_reports(assignment_id, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_completion_reports_pending_assignment
  ON completion_reports(assignment_id) WHERE review_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tracking_token_hash ON incident_tracking_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_entity_time
  ON audit_events(entity_type, entity_id, created_at DESC);

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
