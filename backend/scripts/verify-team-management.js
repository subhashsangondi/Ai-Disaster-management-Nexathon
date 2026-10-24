const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const db = require('../src/config/database');

let baseUrl;

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

async function login(email, password) {
  return api('/api/auth/login', { method: 'POST', body: { email, password } });
}

async function submitSos(marker, suffix) {
  return api('/api/sos', {
    method: 'POST',
    body: {
      emergency_type: 'flood',
      description: `Team recommendation integration ${marker}: ${suffix} requires flood assistance.`,
      latitude: 12.98,
      longitude: 77.60,
      location_text: `Controlled team verification site ${marker}`,
    },
  });
}

async function cleanup(ids) {
  const targets = [...ids.incidentIds, ids.teamId].filter(Boolean);
  if (targets.length || ids.responderId) {
    await db.query(
      `DELETE FROM audit_events
       WHERE entity_id = ANY($1::uuid[]) OR actor_id = $2::uuid`,
      [targets, ids.responderId || null],
    );
  }
  for (const incidentId of ids.incidentIds) {
    await db.query('DELETE FROM incidents WHERE id = $1', [incidentId]);
  }
  if (ids.responderId) await db.query('DELETE FROM users WHERE id = $1', [ids.responderId]);
  if (ids.teamId) await db.query('DELETE FROM rescue_teams WHERE id = $1', [ids.teamId]);
}

async function main() {
  const adminPassword = process.env.RESCUEGRID_VERIFY_ADMIN_PASSWORD;
  const operatorPassword = process.env.RESCUEGRID_VERIFY_OPERATOR_PASSWORD;
  assert(adminPassword && operatorPassword, 'set RESCUEGRID_VERIFY_ADMIN_PASSWORD and RESCUEGRID_VERIFY_OPERATOR_PASSWORD for seeded test accounts');
  const before = await db.query('SELECT (SELECT count(*)::int FROM rescue_teams) AS teams, (SELECT count(*)::int FROM incidents) AS incidents');
  const marker = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const ids = { teamId: null, responderId: crypto.randomUUID(), incidentIds: [] };
  const responderEmail = `team.verify.${marker}@rescuegrid.local`;
  const responderPassword = `Verify-${crypto.randomBytes(12).toString('base64url')}!`;
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = createApp().listen(0, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const admin = await login(process.env.RESCUEGRID_VERIFY_ADMIN_EMAIL || 'admin@rescuegrid.local', adminPassword);
    const operator = await login(process.env.RESCUEGRID_VERIFY_OPERATOR_EMAIL || 'operator@rescuegrid.local', operatorPassword);
    const createdTeam = await api('/api/teams', {
      method: 'POST',
      token: admin.token,
      body: {
        team_name: `Integration Flood Unit ${marker}`,
        capabilities: ['Flood response', 'Medical first aid'],
        base_location_name: `Verification Base ${marker}`,
        latitude: 12.9716,
        longitude: 77.5946,
        availability: 'available',
        contact_info: null,
      },
    });
    ids.teamId = createdTeam.id;

    const storedTeam = await db.query('SELECT * FROM rescue_teams WHERE id = $1', [ids.teamId]);
    assert(storedTeam.rows[0]?.capabilities.includes('Flood response'), 'registered capabilities must be stored in PostgreSQL');
    assert(Number(storedTeam.rows[0]?.latitude) === 12.9716, 'registered coordinates must be stored in PostgreSQL');

    const passwordHash = await bcrypt.hash(responderPassword, 12);
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'responder')`,
      [ids.responderId, `Integration Responder ${marker}`, responderEmail, passwordHash],
    );
    await db.query('INSERT INTO team_memberships (user_id, team_id) VALUES ($1, $2)', [ids.responderId, ids.teamId]);
    const responder = await login(responderEmail, responderPassword);

    const first = await submitSos(marker, 'primary incident');
    const second = await submitSos(marker, 'separate comparison incident');
    ids.incidentIds.push(first.incident_id, second.incident_id);

    const recommendations = await api(`/api/incidents/${first.incident_id}/team-recommendations`, { token: operator.token });
    const recommended = recommendations.recommendations.find((team) => team.team_id === ids.teamId);
    assert(recommended, 'the suitable available registered team must be recommended');
    assert(recommended.distance_km > 0 && recommended.distance_km < 5, 'the Haversine distance must be geographically reasonable');

    const assigned = await api(`/api/incidents/${first.incident_id}/assign`, {
      method: 'PATCH', token: operator.token, body: { team_id: ids.teamId },
    });
    const busyTeam = await db.query('SELECT availability FROM rescue_teams WHERE id = $1', [ids.teamId]);
    assert(busyTeam.rows[0]?.availability === 'busy', 'assignment must mark the team busy');
    const secondRecommendations = await api(`/api/incidents/${second.incident_id}/team-recommendations`, { token: operator.token });
    assert(!secondRecommendations.recommendations.some((team) => team.team_id === ids.teamId), 'a busy team must not be recommended for another incident');

    const assignmentId = assigned.assignment.id;
    await api(`/api/responder/assignments/${assignmentId}/acknowledge`, { method: 'POST', token: responder.token });
    for (const progressStatus of ['en_route', 'arrived', 'rescue_in_progress']) {
      await api(`/api/responder/assignments/${assignmentId}/progress`, {
        method: 'POST', token: responder.token, body: { progress_status: progressStatus, notes: `Integration verification: ${progressStatus}.` },
      });
    }
    await api(`/api/responder/assignments/${assignmentId}/completion`, {
      method: 'POST', token: responder.token,
      body: { completion_summary: 'Integration responders completed the controlled flood assistance scenario.', people_assisted: 1 },
    });
    await api(`/api/incidents/${first.incident_id}/completion/approve`, { method: 'POST', token: operator.token });

    const finalState = await db.query(
      `SELECT incident.status, team.availability
       FROM incidents incident JOIN rescue_teams team ON team.id = incident.assigned_team_id
       WHERE incident.id = $1`,
      [first.incident_id],
    );
    assert(finalState.rows[0]?.status === 'resolved', 'completion approval must resolve the incident');
    assert(finalState.rows[0]?.availability === 'available', 'the team must return to available with no other active assignment');
    const tracking = await api('/api/public/incidents/track', { trackingToken: first.tracking_token });
    assert(tracking.status === 'resolved', 'victim tracking must reflect verified resolution');

    console.log(JSON.stringify({
      team_id: ids.teamId,
      team_name: createdTeam.team_name,
      incident_id: first.incident_id,
      recommendation_rank: recommended.rank,
      straight_line_distance_km: recommended.distance_km,
      assignment_marked_busy: true,
      busy_team_excluded_elsewhere: true,
      responder_workflow_completed: true,
      incident_status: finalState.rows[0].status,
      team_released: finalState.rows[0].availability === 'available',
      victim_tracking_status: tracking.status,
    }, null, 2));
  } finally {
    await cleanup(ids);
    const after = await db.query('SELECT (SELECT count(*)::int FROM rescue_teams) AS teams, (SELECT count(*)::int FROM incidents) AS incidents');
    assert(after.rows[0].teams === before.rows[0].teams, 'cleanup must preserve the pre-existing team count');
    assert(after.rows[0].incidents === before.rows[0].incidents, 'cleanup must preserve the pre-existing incident count');
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
