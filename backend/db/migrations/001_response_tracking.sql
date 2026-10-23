BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('public', 'operator', 'admin', 'responder'));

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE incident_assignments
  ADD COLUMN IF NOT EXISTS progress_status VARCHAR(30) NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

ALTER TABLE incident_assignments DROP CONSTRAINT IF EXISTS incident_assignments_progress_status_check;
ALTER TABLE incident_assignments ADD CONSTRAINT incident_assignments_progress_status_check
  CHECK (progress_status IN (
    'assigned', 'acknowledged', 'en_route', 'arrived',
    'rescue_in_progress', 'completion_requested'
  ));

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
  progress_status VARCHAR(30) NOT NULL CHECK (progress_status IN (
    'acknowledged', 'en_route', 'arrived',
    'rescue_in_progress', 'completion_requested'
  )),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS completion_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES incident_assignments(id) ON DELETE CASCADE,
  completion_summary TEXT NOT NULL CHECK (
    length(trim(completion_summary)) BETWEEN 10 AND 5000
  ),
  people_assisted INTEGER CHECK (people_assisted IS NULL OR people_assisted >= 0),
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_completion_reports_pending_assignment
  ON completion_reports(assignment_id) WHERE review_status = 'pending';

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

CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX IF NOT EXISTS idx_assignment_notifications_team_unread
  ON assignment_notifications(team_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_progress_assignment_time
  ON assignment_progress_events(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_completion_assignment_time
  ON completion_reports(assignment_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_completion_review_decided_at
  ON completion_review_decisions(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_token_hash ON incident_tracking_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_entity_time
  ON audit_events(entity_type, entity_id, created_at DESC);

INSERT INTO assignment_notifications (assignment_id, team_id, created_at)
SELECT id, team_id, assigned_at FROM incident_assignments
ON CONFLICT (assignment_id) DO NOTHING;

COMMIT;
