const db = require('../config/database');
const { AppError } = require('../utils/apiResponse');

const incidentColumns = `
  i.id, i.reporter_id, i.emergency_type, i.description,
  i.latitude, i.longitude, i.location_text, i.status,
  i.assigned_team_id, i.created_at, i.updated_at`;

async function createIncident(data) {
  if (data.idempotency_key) {
    const inserted = await db.query(
      `INSERT INTO incidents
        (id, reporter_id, emergency_type, description, latitude, longitude, location_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        data.idempotency_key,
        data.reporter_id || null,
        data.emergency_type,
        data.description,
        data.latitude ?? null,
        data.longitude ?? null,
        data.location_text || null,
      ],
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const existingResult = await db.query('SELECT * FROM incidents WHERE id = $1', [data.idempotency_key]);
    const existing = existingResult.rows[0];
    if (!existing) throw new AppError(409, 'SOS could not be safely replayed; please retry');

    const sameReport = existing.reporter_id === (data.reporter_id || null)
      && existing.emergency_type === data.emergency_type
      && existing.description === data.description
      && (existing.latitude == null ? null : Number(existing.latitude)) === (data.latitude ?? null)
      && (existing.longitude == null ? null : Number(existing.longitude)) === (data.longitude ?? null)
      && existing.location_text === (data.location_text || null);
    if (!sameReport) throw new AppError(409, 'Idempotency key was already used for a different SOS report');
    return existing;
  }

  const result = await db.query(
    `INSERT INTO incidents
      (reporter_id, emergency_type, description, latitude, longitude, location_text, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [
      data.reporter_id || null,
      data.emergency_type,
      data.description,
      data.latitude ?? null,
      data.longitude ?? null,
      data.location_text || null,
    ],
  );
  return result.rows[0];
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
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT * FROM ai_analyses a
       WHERE a.incident_id = i.id ORDER BY a.analyzed_at DESC LIMIT 1
     ) latest_analysis ON true
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
       END AS assigned_team
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT id, incident_id, disaster_type, urgency, victim_count, summary,
              reasoning, requires_review, analyzed_at
       FROM ai_analyses WHERE incident_id = i.id
       ORDER BY analyzed_at DESC LIMIT 1
     ) a ON true
     LEFT JOIN rescue_teams t ON t.id = i.assigned_team_id
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
  for (const candidate of candidates) {
    await db.query(
      `INSERT INTO possible_duplicates (incident_id, possible_duplicate_id, similarity_score)
       VALUES ($1, $2, $3)
       ON CONFLICT (incident_id, possible_duplicate_id)
       DO UPDATE SET similarity_score = EXCLUDED.similarity_score, created_at = CURRENT_TIMESTAMP`,
      [incidentId, candidate.incident_id, candidate.similarity_score],
    );
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
};
