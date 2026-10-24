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

async function login(email, password) {
  return api('/api/auth/login', { method: 'POST', body: { email, password } });
}

async function submitSos(description) {
  return api('/api/sos', {
    method: 'POST',
    body: {
      emergency_type: 'duplicate_workflow_test',
      description,
      latitude: 12.9716,
      longitude: 77.5946,
      location_text: 'Duplicate workflow verification site',
    },
  });
}

async function main() {
  const operator = await login('operator@rescuegrid.local', 'OperatorDemo123!');
  const responder = await login('responder.verify@rescuegrid.local', 'ResponderVerify123!');
  const teams = (await api('/api/teams', { token: operator.token })).teams;
  const team = teams.find((candidate) => candidate.team_name === 'Workflow Verification Unit' && candidate.availability === 'available');
  assert(team, 'the workflow verification team must be available');

  const uniqueMarker = Date.now();
  const description = `Duplicate verification ${uniqueMarker}: two reports describe the same flooded training structure.`;
  const primary = await submitSos(description);
  const duplicate = await submitSos(description);
  await api(`/api/incidents/${duplicate.incident_id}/analyze`, { method: 'POST', token: operator.token });

  const beforeReview = await api(`/api/incidents/${duplicate.incident_id}/duplicates`, { token: operator.token });
  const candidate = beforeReview.candidates.find((item) => item.incident_id === primary.incident_id);
  assert(candidate, 'AI candidate must be stored for operator review');
  assert(beforeReview.links.length === 0, 'AI analysis must not automatically link incidents');

  await api(`/api/incidents/${duplicate.incident_id}/duplicates/${primary.incident_id}/review`, {
    method: 'POST',
    token: operator.token,
    body: {
      decision: 'confirmed',
      primary_incident_id: primary.incident_id,
      reason: 'Operator verified both reports describe the same training event.',
      assignment_conflict_acknowledged: false,
    },
  });

  const afterReview = await api(`/api/incidents/${duplicate.incident_id}/duplicates`, { token: operator.token });
  assert(afterReview.role === 'duplicate' && afterReview.links.length === 1, 'operator confirmation must create a durable primary link');
  await expectFailure(
    () => api(`/api/incidents/${duplicate.incident_id}/assign`, { method: 'PATCH', token: operator.token, body: { team_id: team.id } }),
    409,
    'a linked duplicate must not receive a redundant assignment',
  );

  const assignment = await api(`/api/incidents/${primary.incident_id}/assign`, { method: 'PATCH', token: operator.token, body: { team_id: team.id } });
  await api(`/api/responder/assignments/${assignment.assignment.id}/acknowledge`, { method: 'POST', token: responder.token });
  for (const [progressStatus, notes] of [
    ['en_route', 'Duplicate workflow verification team departed.'],
    ['arrived', 'Duplicate workflow verification team arrived.'],
    ['rescue_in_progress', 'Duplicate workflow assistance is underway.'],
  ]) {
    await api(`/api/responder/assignments/${assignment.assignment.id}/progress`, { method: 'POST', token: responder.token, body: { progress_status: progressStatus, notes } });
  }
  await api(`/api/responder/assignments/${assignment.assignment.id}/completion`, {
    method: 'POST', token: responder.token, body: { completion_summary: 'The shared incident was verified complete at the training site.', people_assisted: 2 },
  });

  const beforeApproval = await api('/api/public/incidents/track', { trackingToken: duplicate.tracking_token });
  assert(beforeApproval.status !== 'resolved', 'linking alone must not resolve public tracking');
  await api(`/api/incidents/${primary.incident_id}/completion/approve`, { method: 'POST', token: operator.token });
  const afterApproval = await api('/api/public/incidents/track', { trackingToken: duplicate.tracking_token });
  assert(afterApproval.status === 'resolved', 'verified primary completion must update linked victim tracking');
  assert(Object.keys(afterApproval).sort().join(',') === 'emergency_type,incident_reference,last_updated_at,progress_messages,status,submitted_at', 'public tracking must expose only the safe projection');
  assert(afterApproval.incident_reference === duplicate.incident_id, 'linked tracking must retain the victim original incident reference');

  const stored = await db.query(
    `SELECT duplicate.status AS duplicate_original_status,
            link.resolution_verified_at,
            link.primary_incident_id, link.duplicate_incident_id,
            review.decision,
            (SELECT count(1)::int FROM incident_tracking_tokens token
             WHERE token.incident_id IN (link.primary_incident_id, link.duplicate_incident_id)) AS tracking_tokens,
            (SELECT count(1)::int FROM audit_events audit
             WHERE audit.action = 'duplicate_confirmed'
               AND audit.entity_id = link.primary_incident_id) AS duplicate_audits
     FROM incident_duplicate_links link
     JOIN incidents duplicate ON duplicate.id = link.duplicate_incident_id
     JOIN incident_duplicate_reviews review ON review.id = link.review_id
     WHERE link.primary_incident_id = $1 AND link.duplicate_incident_id = $2`,
    [primary.incident_id, duplicate.incident_id],
  );
  const row = stored.rows[0];
  assert(row?.duplicate_original_status === 'pending', 'linked SOS incident row must remain preserved');
  assert(row.resolution_verified_at && row.decision === 'confirmed', 'link must record operator confirmation and verified resolution');
  assert(row.tracking_tokens === 2, 'both original victim tracking tokens must remain stored');
  assert(row.duplicate_audits === 1, 'duplicate confirmation must be audited');

  console.log(JSON.stringify({
    primary_incident_id: primary.incident_id,
    linked_incident_id: duplicate.incident_id,
    ai_did_not_auto_link: true,
    redundant_assignment_blocked: true,
    original_linked_status_preserved: row.duplicate_original_status,
    linked_public_status_after_verified_completion: afterApproval.status,
    tracking_tokens_preserved: row.tracking_tokens,
    public_fields: Object.keys(afterApproval).sort(),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
