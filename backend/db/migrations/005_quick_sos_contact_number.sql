BEGIN;

-- Quick SOS (location-only reports), operator triage, and optional victim contact numbers.
-- Additive and rerunnable: existing incidents become 'detailed' reports that need no triage.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS submission_mode VARCHAR(20) NOT NULL DEFAULT 'detailed',
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS location_accuracy_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_status VARCHAR(30) NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS assessed_severity VARCHAR(20),
  ADD COLUMN IF NOT EXISTS triaged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

-- Quick SOS reports may have no description; detailed reports keep the 10-character minimum.
ALTER TABLE incidents ALTER COLUMN description DROP NOT NULL;
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_description_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_description_by_mode') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_description_by_mode CHECK (
      submission_mode = 'quick_sos'
      OR (description IS NOT NULL AND length(trim(description)) >= 10)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_submission_mode_check') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_submission_mode_check
      CHECK (submission_mode IN ('detailed', 'quick_sos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_contact_number_check') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_contact_number_check
      CHECK (contact_number IS NULL OR contact_number ~ '^\+?[0-9]{6,15}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_location_accuracy_check') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_location_accuracy_check
      CHECK (location_accuracy_meters IS NULL OR location_accuracy_meters >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_triage_status_check') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_triage_status_check
      CHECK (triage_status IN ('not_required', 'needs_immediate_triage', 'assessed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_assessed_severity_check') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_assessed_severity_check
      CHECK (assessed_severity IS NULL OR assessed_severity IN ('critical', 'high', 'medium', 'low', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incidents_needs_triage
  ON incidents(created_at DESC)
  WHERE triage_status = 'needs_immediate_triage';

COMMIT;
