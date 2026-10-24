const db = require('../config/database');

const incidentColumns = `
  i.id, i.reporter_id, i.emergency_type, i.description,
  i.latitude, i.longitude, i.location_text, i.status,
  i.assigned_team_id, i.resolved_at, i.resolved_by, i.created_at, i.updated_at,
  i.submission_mode, i.contact_number, i.location_accuracy_meters, i.location_captured_at,
  i.triage_status, i.assessed_severity, i.triaged_at`;

async function createIncident(data) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO incidents
        (reporter_id, emergency_type, description, latitude, longitude, location_text, status,
         submission_mode, contact_number, location_accuracy_meters, location_captured_at, triage_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.reporter_id || null,
        data.emergency_type,
        data.description ?? null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.location_text || null,
        data.submission_mode || 'detailed',
        data.contact_number || null,
        data.location_accuracy_meters ?? null,
        data.location_captured_at || null,
        data.triage_status || 'not_required',
      ],
    );
    if (data.tracking_token_hash) {
      await client.query(
        'INSERT INTO incident_tracking_tokens (incident_id, token_hash) VALUES ($1, $2)',
        [result.rows[0].id, data.tracking_token_hash],
      );
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listIncidents({ status, urgency, emergency_type, page, limit }) {
  const conditions = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (status) add('i.status = ?', status);
  if (urgency) add('latest_analysis.urgency = ?', urgency);
  if (emergency_type) add('LOWER(i.emergency_type) = LOWER(?)', emergency_type);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT urgency FROM ai_analyses a
       WHERE a.incident_id = i.id ORDER BY a.analyzed_at DESC LIMIT 1
     ) latest_analysis ON true
     ${where}`,
    params,
  );

  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const result = await db.query(
    `SELECT ${incidentColumns},
       CASE WHEN latest_analysis.id IS NULL THEN NULL ELSE
         json_build_object(
           'id', latest_analysis.id,
           'disaster_type', latest_analysis.disaster_type,
           'urgency', latest_analysis.urgency,
           'victim_count', latest_analysis.victim_count,
           'summary', latest_analysis.summary,
           'reasoning', latest_analysis.reasoning,
           'requires_review', latest_analysis.requires_review,
           'analyzed_at', latest_analysis.analyzed_at
         ) END AS latest_analysis
       ,CASE
          WHEN duplicate_link.id IS NOT NULL THEN 'duplicate'
          WHEN primary_links.linked_count > 0 THEN 'primary'
          ELSE 'independent'
        END AS duplicate_role,
       duplicate_link.primary_incident_id,
       COALESCE(primary_links.linked_count, 0)::int AS linked_incident_count,
       duplicate_link.resolution_verified_at AS linked_resolution_verified_at
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT * FROM ai_analyses a
       WHERE a.incident_id = i.id ORDER BY a.analyzed_at DESC LIMIT 1
     ) latest_analysis ON true
     LEFT JOIN incident_duplicate_links duplicate_link
       ON duplicate_link.duplicate_incident_id = i.id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS linked_count
       FROM incident_duplicate_links link_count
       WHERE link_count.primary_incident_id = i.id
     ) primary_links ON true
     ${where}
     ORDER BY i.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams,
  );

  return {
    incidents: result.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0].total,
      total_pages: Math.ceil(countResult.rows[0].total / limit),
    },
  };
}

async function getIncidentById(id, client = db) {
  const result = await client.query(
    `SELECT ${incidentColumns},
       CASE WHEN a.id IS NULL THEN NULL ELSE row_to_json(a) END AS latest_analysis,
       CASE WHEN t.id IS NULL THEN NULL ELSE
         json_build_object('id', t.id, 'team_name', t.team_name, 'availability', t.availability)
       END AS assigned_team,
       CASE WHEN assignment.id IS NULL THEN NULL ELSE
         json_build_object(
           'id', assignment.id, 'progress_status', assignment.progress_status,
           'assigned_at', assignment.assigned_at,
           'acknowledged_at', assignment.acknowledged_at,
           'notification_created_at', notification.created_at,
           'notification_read_at', notification.read_at,
           'notification_acknowledged_at', notification.acknowledged_at
         ) END AS assignment
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT id, incident_id, disaster_type, urgency, victim_count, summary,
              reasoning, requires_review, analyzed_at
       FROM ai_analyses WHERE incident_id = i.id
       ORDER BY analyzed_at DESC LIMIT 1
     ) a ON true
     LEFT JOIN rescue_teams t ON t.id = i.assigned_team_id
     LEFT JOIN incident_assignments assignment ON assignment.incident_id = i.id
     LEFT JOIN assignment_notifications notification ON notification.assignment_id = assignment.id
     WHERE i.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function getAnalysis(id) {
  const result = await db.query(
    `SELECT id, incident_id, disaster_type, urgency, victim_count, summary,
            reasoning, requires_review, analyzed_at
     FROM ai_analyses WHERE incident_id = $1
     ORDER BY analyzed_at DESC LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

async function saveAnalysis(incidentId, analysis) {
  const result = await db.query(
    `INSERT INTO ai_analyses
      (incident_id, disaster_type, urgency, victim_count, summary, reasoning, requires_review)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      incidentId,
      analysis.disaster_type,
      analysis.urgency,
      analysis.victim_count ?? null,
      analysis.summary,
      analysis.reasoning,
      analysis.requires_review,
    ],
  );
  return result.rows[0];
}

async function findDuplicateCandidates(incident, lookbackHours) {
  const result = await db.query(
    `SELECT id, emergency_type, description, latitude, longitude, location_text, created_at
     FROM incidents
     WHERE id <> $1
       AND created_at >= $2::timestamptz - ($3::double precision * INTERVAL '1 hour')
       AND created_at <= $2::timestamptz + INTERVAL '15 minutes'
     ORDER BY created_at DESC
     LIMIT 100`,
    [incident.id, incident.created_at, lookbackHours],
  );
  return result.rows;
}

async function savePossibleDuplicates(incidentId, candidates) {
  const saved = [];
  for (const candidate of candidates) {
    const result = await db.query(
      `INSERT INTO possible_duplicates
         (incident_id, possible_duplicate_id, similarity_score, distance_km)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (incident_id, possible_duplicate_id)
       DO UPDATE SET similarity_score = EXCLUDED.similarity_score,
         distance_km = EXCLUDED.distance_km, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [incidentId, candidate.incident_id, candidate.similarity_score, candidate.distance_km],
    );
    saved.push({ ...candidate, match_id: result.rows[0].id });
  }
  return saved;
}

async function triageIncident({ incidentId, emergencyType, severity, operatorId }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE incidents
       SET emergency_type = $2, assessed_severity = $3, triage_status = 'assessed',
           triaged_by = $4, triaged_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, emergency_type, assessed_severity, triage_status, triaged_at`,
      [incidentId, emergencyType, severity, operatorId],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'incident_triaged', 'incident', $2, $3::jsonb)`,
      [operatorId, incidentId, JSON.stringify({ emergency_type: emergencyType, severity })],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getDashboardStats() {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM incidents) AS total_incidents,
       (SELECT COUNT(*)::int FROM incidents WHERE status = 'pending') AS pending,
       (SELECT COUNT(*)::int FROM incidents WHERE status = 'assigned') AS assigned,
       (SELECT COUNT(*)::int FROM incidents WHERE status = 'in_progress') AS in_progress,
       (SELECT COUNT(*)::int FROM incidents WHERE status = 'resolved') AS resolved,
       (SELECT COUNT(*)::int
        FROM incidents dashboard_incident
        JOIN LATERAL (
          SELECT urgency FROM ai_analyses dashboard_analysis
          WHERE dashboard_analysis.incident_id = dashboard_incident.id
          ORDER BY dashboard_analysis.analyzed_at DESC LIMIT 1
        ) dashboard_latest ON true
        WHERE dashboard_latest.urgency = 'critical') AS critical_recommendations,
       (SELECT COUNT(*)::int FROM incidents
        WHERE triage_status = 'needs_immediate_triage' AND status <> 'resolved') AS needs_triage,
       (SELECT COUNT(*)::int FROM rescue_teams WHERE availability = 'available') AS available_teams`,
  );
  return result.rows[0];
}

module.exports = {
  createIncident,
  listIncidents,
  getIncidentById,
  getAnalysis,
  saveAnalysis,
  findDuplicateCandidates,
  savePossibleDuplicates,
  getDashboardStats,
  triageIncident,
};
