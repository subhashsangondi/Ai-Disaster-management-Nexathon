const crypto = require('crypto');
const db = require('../src/config/database');

const baseUrl = (process.env.TEST_API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');

async function api(path, { method = 'GET', token, trackingToken, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(trackingToken ? { 'X-Incident-Tracking-Token': trackingToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const envelope = await response.json();
  if (!response.ok || envelope.success !== true) {
    const error = new Error(`${method} ${path} failed (${response.status}): ${envelope.message}`);
    error.status = response.status;
    throw error;
  }
  return envelope.data;
}

async function login(email, password) {
  return api('/api/auth/login', { method: 'POST', body: { email, password } });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Verification failed: ${message}`);
}

async function expectFailure(operation, expectedStatus, message) {
  try {
    await operation();
  } catch (error) {
    assert(error.status === expectedStatus, `${message}; expected HTTP ${expectedStatus}, received ${error.status || 'no status'}`);
    return;
  }
  throw new Error(`Verification failed: ${message}; request unexpectedly succeeded`);
}

async function main() {
  const operator = await login('operator@rescuegrid.local', 'OperatorDemo123!');
  const teams = (await api('/api/teams', { token: operator.token })).teams;
  const candidates = [
    { match: 'Workflow Verification Unit', email: 'responder.verify@rescuegrid.local', password: 'ResponderVerify123!' },
    { match: 'Demo Search Team Charlie', email: 'responder.charlie@rescuegrid.local', password: 'ResponderOther123!' },
    { match: 'Demo Rapid Response Alpha', email: 'responder.alpha@rescuegrid.local', password: 'ResponderDemo123!' },
  ];
  const candidate = candidates.find((item) => teams.some((team) => team.team_name === item.match && team.availability === 'available'));
  assert(candidate, 'a seeded responder team must be available');
  const team = teams.find((item) => item.team_name === candidate.match);
  const responder = await login(candidate.email, candidate.password);
  const unrelatedResponder = await login('responder.alpha@rescuegrid.local', 'ResponderDemo123!');

  const sos = await api('/api/sos', {
    method: 'POST',
    body: {
      emergency_type: 'integration_test_flood',
      description: 'Automated end-to-end verification report; two people require assistance.',
      latitude: 12.9716,
      longitude: 77.5946,
      location_text: 'RescueGrid automated verification site',
    },
  });
  assert(sos.incident_id && sos.tracking_token, 'SOS must return an incident ID and one-time tracking token');

  let analysisVerified = false;
  if (process.env.SKIP_AI_VERIFICATION !== 'true') {
    const analyzed = await api(`/api/incidents/${sos.incident_id}/analyze`, { method: 'POST', token: operator.token });
    assert(analyzed.analysis?.summary, 'Gemini analysis must be stored and returned');
    analysisVerified = true;
  }

  const assigned = await api(`/api/incidents/${sos.incident_id}/assign`, {
    method: 'PATCH', token: operator.token, body: { team_id: team.id },
  });
  assert(assigned.notification?.assignment_id === assigned.assignment.id, 'assignment must create a notification transactionally');

  const notifications = (await api('/api/responder/notifications', { token: responder.token })).notifications;
  const notification = notifications.find((item) => item.incident_id === sos.incident_id);
  assert(notification && !notification.acknowledged_at, 'assigned responder must see an unacknowledged notification');

  const assignmentId = assigned.assignment.id;
  await expectFailure(
    () => api(`/api/responder/assignments/${assignmentId}/acknowledge`, { method: 'POST', token: unrelatedResponder.token }),
    404,
    'an unrelated responder must not access the assignment',
  );
  await expectFailure(
    () => api(`/api/responder/assignments/${assignmentId}/progress`, { method: 'POST', token: responder.token, body: { progress_status: 'arrived' } }),
    409,
    'invalid progress transitions must be rejected',
  );
  await expectFailure(
    () => api(`/api/public/incidents/track?incident_id=${sos.incident_id}`),
    401,
    'an incident UUID alone must not authorize public tracking',
  );
  await expectFailure(
    () => api('/api/public/incidents/track', { trackingToken: 'x'.repeat(43) }),
    404,
    'an invalid tracking token must be rejected',
  );
  await api(`/api/responder/assignments/${assignmentId}/acknowledge`, { method: 'POST', token: responder.token });
  await api(`/api/responder/assignments/${assignmentId}/progress`, { method: 'POST', token: responder.token, body: { progress_status: 'en_route', notes: 'Verification team departed.' } });
  await api(`/api/responder/assignments/${assignmentId}/progress`, { method: 'POST', token: responder.token, body: { progress_status: 'arrived', notes: 'Verification team arrived.' } });
  await api(`/api/responder/assignments/${assignmentId}/progress`, { method: 'POST', token: responder.token, body: { progress_status: 'rescue_in_progress', notes: 'Assistance is underway.' } });
  await api(`/api/responder/assignments/${assignmentId}/completion`, { method: 'POST', token: responder.token, body: { completion_summary: 'Both reported people were assisted and moved to the designated safe area.', people_assisted: 2 } });

  const progress = (await api(`/api/incidents/${sos.incident_id}/progress`, { token: operator.token })).events;
  const completion = (await api(`/api/incidents/${sos.incident_id}/completion`, { token: operator.token })).reports;
  assert(progress.map((event) => event.progress_status).join(',') === 'acknowledged,en_route,arrived,rescue_in_progress,completion_requested', 'progress history must be complete and ordered');
  assert(completion[0]?.review_status === 'pending', 'completion must await operator review');

  await api(`/api/incidents/${sos.incident_id}/completion/reject`, { method: 'POST', token: operator.token, body: { reason: 'Verification exercise requires a second completion submission.' } });
  const rejectedPublicStatus = await api('/api/public/incidents/track', { trackingToken: sos.tracking_token });
  assert(rejectedPublicStatus.status === 'in_progress', 'rejected completion must not resolve the incident');
  await api(`/api/responder/assignments/${assignmentId}/completion`, { method: 'POST', token: responder.token, body: { completion_summary: 'Second verified report: both people are safe in the designated area.', people_assisted: 2 } });
  await api(`/api/incidents/${sos.incident_id}/completion/approve`, { method: 'POST', token: operator.token });
  const publicStatus = await api('/api/public/incidents/track', { trackingToken: sos.tracking_token });
  assert(publicStatus.status === 'resolved', 'victim tracking must show resolved after approval');
  assert(Object.keys(publicStatus).sort().join(',') === 'emergency_type,incident_reference,last_updated_at,progress_messages,status,submitted_at', 'public tracking response must remain sanitized');

  const expectedHash = crypto.createHash('sha256').update(sos.tracking_token).digest('hex');
  const stored = await db.query(
    `SELECT incident.status, incident.resolved_at, incident.resolved_by,
            tracking.token_hash, team.availability,
            notification.acknowledged_at,
            report.review_status,
            (SELECT count(1)::int FROM assignment_progress_events event WHERE event.assignment_id = assignment.id) AS progress_count,
            (SELECT count(1)::int FROM audit_events audit
             WHERE audit.entity_id = incident.id
               AND audit.action IN ('completion_rejected', 'completion_approved')) AS audit_count
     FROM incidents incident
     JOIN incident_tracking_tokens tracking ON tracking.incident_id = incident.id
     JOIN incident_assignments assignment ON assignment.incident_id = incident.id
     JOIN assignment_notifications notification ON notification.assignment_id = assignment.id
     JOIN rescue_teams team ON team.id = assignment.team_id
     JOIN completion_reports report ON report.id = (
       SELECT latest_report.id FROM completion_reports latest_report
       WHERE latest_report.assignment_id = assignment.id
       ORDER BY latest_report.submitted_at DESC LIMIT 1
     )
     WHERE incident.id = $1`,
    [sos.incident_id],
  );
  const row = stored.rows[0];
  assert(row?.status === 'resolved' && row.resolved_at && row.resolved_by, 'PostgreSQL must record verified resolution metadata');
  assert(row.token_hash.trim() === expectedHash && !row.token_hash.includes(sos.tracking_token), 'PostgreSQL must store only the tracking-token hash');
  assert(row.availability === 'available', 'team must be released when it has no other active assignments');
  assert(row.acknowledged_at && row.review_status === 'approved', 'acknowledgment and completion approval must be persisted');
  assert(row.progress_count === 6 && row.audit_count === 2, 'progress and both review audit records must be persisted');

  console.log(JSON.stringify({
    incident_id: sos.incident_id,
    team: team.team_name,
    analysis_verified: analysisVerified,
    progress_events: row.progress_count,
    completion: row.review_status,
    incident_status: row.status,
    public_tracking_status: publicStatus.status,
    token_storage: 'sha256_hash_only',
    audit_events: row.audit_count,
    rejection_kept_incident_active: true,
    unauthorized_responder_blocked: true,
    invalid_transition_blocked: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
