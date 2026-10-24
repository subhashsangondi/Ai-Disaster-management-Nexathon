BEGIN;

-- Local demo credentials only. Change or remove these outside local hackathon use.
-- operator@rescuegrid.local / OperatorDemo123!
-- admin@rescuegrid.local / AdminDemo123!
-- responder.alpha@rescuegrid.local / ResponderDemo123!
-- responder.charlie@rescuegrid.local / ResponderOther123!
-- responder.verify@rescuegrid.local / ResponderVerify123!
INSERT INTO users (id, name, email, password_hash, role)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Demo Operator', 'operator@rescuegrid.local', crypt('OperatorDemo123!', gen_salt('bf', 12)), 'operator'),
  ('10000000-0000-4000-8000-000000000002', 'Demo Admin', 'admin@rescuegrid.local', crypt('AdminDemo123!', gen_salt('bf', 12)), 'admin'),
  ('10000000-0000-4000-8000-000000000003', 'Demo Alpha Responder', 'responder.alpha@rescuegrid.local', crypt('ResponderDemo123!', gen_salt('bf', 12)), 'responder'),
  ('10000000-0000-4000-8000-000000000004', 'Demo Charlie Responder', 'responder.charlie@rescuegrid.local', crypt('ResponderOther123!', gen_salt('bf', 12)), 'responder'),
  ('10000000-0000-4000-8000-000000000005', 'Workflow Verification Responder', 'responder.verify@rescuegrid.local', crypt('ResponderVerify123!', gen_salt('bf', 12)), 'responder')
ON CONFLICT (email) DO NOTHING;

INSERT INTO rescue_teams (id, team_name, availability)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'Demo Rapid Response Alpha', 'available'),
  ('20000000-0000-4000-8000-000000000002', 'Demo Medical Unit Bravo', 'busy'),
  ('20000000-0000-4000-8000-000000000003', 'Demo Search Team Charlie', 'available'),
  ('20000000-0000-4000-8000-000000000004', 'Demo Water Rescue Delta', 'offline'),
  ('20000000-0000-4000-8000-000000000005', 'Workflow Verification Unit', 'available')
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_memberships (user_id, team_id)
VALUES
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO incidents
  (id, emergency_type, description, latitude, longitude, location_text, status, assigned_team_id, created_at, updated_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'flood', 'Simulated report: water entering a demonstration shelter.', 12.9716, 77.5946, 'Demo Zone A', 'pending', NULL, CURRENT_TIMESTAMP - INTERVAL '30 minutes', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
  ('30000000-0000-4000-8000-000000000002', 'landslide', 'Simulated report: debris blocks a training access road.', 12.9141, 74.8560, 'Demo Village Bridge', 'assigned', '20000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '90 minutes'),
  ('30000000-0000-4000-8000-000000000003', 'fire', 'Simulated report: smoke visible from an empty training structure.', NULL, NULL, 'Demo Industrial Training Site', 'resolved', NULL, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '20 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO incident_assignments (id, incident_id, team_id, assigned_by, assigned_at)
VALUES (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP - INTERVAL '90 minutes'
)
ON CONFLICT (incident_id) DO NOTHING;

INSERT INTO ai_analyses
  (id, incident_id, disaster_type, urgency, victim_count, summary, reasoning, requires_review, analyzed_at)
VALUES (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  'landslide',
  'medium',
  NULL,
  'Debris reportedly blocks a demonstration access road.',
  'The simulated report mentions blocked access but no explicit victims.',
  true,
  CURRENT_TIMESTAMP - INTERVAL '100 minutes'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
