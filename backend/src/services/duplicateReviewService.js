const db = require('../config/database');
const { AppError } = require('../utils/apiResponse');

function canonicalPair(leftId, rightId) {
  return [leftId, rightId].sort((left, right) => left.localeCompare(right));
}

async function listDuplicateMatches(incidentId, database = db) {
  const incidentResult = await database.query('SELECT id FROM incidents WHERE id = $1', [incidentId]);
  if (!incidentResult.rows[0]) throw new AppError(404, 'Incident not found');

  const candidateResult = await database.query(
    `SELECT candidate.id AS match_id, candidate.similarity_score, candidate.distance_km,
            candidate.created_at AS detected_at,
            other.id AS incident_id, other.emergency_type, other.description,
            other.location_text, other.status, other.assigned_team_id,
            review.decision AS review_decision, review.primary_incident_id,
            review.reason AS review_reason, review.reviewed_at,
            reviewer.name AS reviewed_by_name
     FROM possible_duplicates candidate
     JOIN incidents other ON other.id = CASE
       WHEN candidate.incident_id = $1 THEN candidate.possible_duplicate_id
       ELSE candidate.incident_id
     END
     LEFT JOIN LATERAL (
       SELECT * FROM incident_duplicate_reviews latest
       WHERE latest.possible_duplicate_id = candidate.id
       ORDER BY latest.reviewed_at DESC LIMIT 1
     ) review ON true
     LEFT JOIN users reviewer ON reviewer.id = review.reviewed_by
     WHERE candidate.incident_id = $1 OR candidate.possible_duplicate_id = $1
     ORDER BY candidate.similarity_score DESC, candidate.created_at DESC`,
    [incidentId],
  );

  const candidatesByIncident = new Map();
  for (const candidate of candidateResult.rows) {
    if (!candidatesByIncident.has(candidate.incident_id)) candidatesByIncident.set(candidate.incident_id, candidate);
  }

  const linkResult = await database.query(
    `SELECT link.id, link.primary_incident_id, link.duplicate_incident_id,
            link.assignment_conflict_acknowledged, link.linked_at,
            link.resolution_verified_at, linker.name AS linked_by_name,
            primary_incident.emergency_type AS primary_emergency_type,
            primary_incident.status AS primary_status,
            primary_incident.assigned_team_id AS primary_assigned_team_id,
            duplicate_incident.emergency_type AS duplicate_emergency_type,
            duplicate_incident.status AS duplicate_status,
            duplicate_incident.assigned_team_id AS duplicate_assigned_team_id
     FROM incident_duplicate_links link
     JOIN incidents primary_incident ON primary_incident.id = link.primary_incident_id
     JOIN incidents duplicate_incident ON duplicate_incident.id = link.duplicate_incident_id
     JOIN users linker ON linker.id = link.linked_by
     WHERE link.primary_incident_id = $1 OR link.duplicate_incident_id = $1
     ORDER BY link.linked_at`,
    [incidentId],
  );

  const ownLink = linkResult.rows.find((link) => link.duplicate_incident_id === incidentId);
  return {
    role: ownLink ? 'duplicate' : linkResult.rows.some((link) => link.primary_incident_id === incidentId) ? 'primary' : 'independent',
    candidates: [...candidatesByIncident.values()],
    links: linkResult.rows,
  };
}

async function reviewDuplicate({
  incidentId,
  duplicateIncidentId,
  decision,
  primaryIncidentId,
  reason,
  assignmentConflictAcknowledged,
  operatorId,
}, database = db) {
  const client = await database.pool.connect();
  const [incidentAId, incidentBId] = canonicalPair(incidentId, duplicateIncidentId);
  try {
    await client.query('BEGIN');
    const incidentsResult = await client.query(
      `SELECT id, status, assigned_team_id FROM incidents
       WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[incidentAId, incidentBId]],
    );
    if (incidentsResult.rows.length !== 2) throw new AppError(404, 'One or both incidents were not found');

    const candidateResult = await client.query(
      `SELECT * FROM possible_duplicates
       WHERE (incident_id = $1 AND possible_duplicate_id = $2)
          OR (incident_id = $2 AND possible_duplicate_id = $1)
       ORDER BY similarity_score DESC, created_at DESC LIMIT 1`,
      [incidentId, duplicateIncidentId],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new AppError(404, 'No AI duplicate candidate exists for this incident pair');

    const pairLinkResult = await client.query(
      `SELECT * FROM incident_duplicate_links
       WHERE (primary_incident_id = $1 AND duplicate_incident_id = $2)
          OR (primary_incident_id = $2 AND duplicate_incident_id = $1)
       FOR UPDATE`,
      [incidentId, duplicateIncidentId],
    );
    const pairLink = pairLinkResult.rows[0];

    if (decision === 'rejected') {
      if (pairLink) throw new AppError(409, 'Linked incidents cannot be rejected without an explicit unlink workflow');
      const reviewResult = await client.query(
        `INSERT INTO incident_duplicate_reviews
           (possible_duplicate_id, incident_a_id, incident_b_id, decision, reason, reviewed_by)
         VALUES ($1, $2, $3, 'rejected', $4, $5) RETURNING *`,
        [candidate.id, incidentAId, incidentBId, reason || null, operatorId],
      );
      await client.query(
        `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'duplicate_rejected', 'incident', $2, $3::jsonb)`,
        [operatorId, incidentId, JSON.stringify({ duplicate_incident_id: duplicateIncidentId, review_id: reviewResult.rows[0].id, reason: reason || null })],
      );
      await client.query('COMMIT');
      return { review: reviewResult.rows[0], link: null };
    }

    if (![incidentId, duplicateIncidentId].includes(primaryIncidentId)) {
      throw new AppError(400, 'Primary incident must be one of the reviewed incidents');
    }
    const linkedDuplicateId = primaryIncidentId === incidentId ? duplicateIncidentId : incidentId;
    if (pairLink) {
      if (pairLink.primary_incident_id !== primaryIncidentId) {
        throw new AppError(409, 'This incident pair is already linked with a different primary incident');
      }
      await client.query('COMMIT');
      return { review: null, link: pairLink, idempotent: true };
    }

    const groupResult = await client.query(
      `SELECT * FROM incident_duplicate_links
       WHERE primary_incident_id = ANY($1::uuid[])
          OR duplicate_incident_id = ANY($1::uuid[])
       FOR UPDATE`,
      [[incidentId, duplicateIncidentId]],
    );
    if (groupResult.rows.some((link) => link.duplicate_incident_id === primaryIncidentId)) {
      throw new AppError(409, 'A linked duplicate cannot become a primary incident');
    }
    if (groupResult.rows.some((link) => link.primary_incident_id === linkedDuplicateId || link.duplicate_incident_id === linkedDuplicateId)) {
      throw new AppError(409, 'The duplicate incident already belongs to another duplicate group');
    }

    const assignedIncidentIds = incidentsResult.rows
      .filter((incident) => incident.assigned_team_id)
      .map((incident) => incident.id);
    const bothAssigned = assignedIncidentIds.length === 2;
    if (bothAssigned && !assignmentConflictAcknowledged) {
      throw new AppError(409, 'Both incidents already have assignments; explicit conflict acknowledgment is required');
    }
    if (assignedIncidentIds.length === 1 && assignedIncidentIds[0] !== primaryIncidentId) {
      throw new AppError(409, 'The incident with the existing assignment must be selected as primary');
    }

    const reviewResult = await client.query(
      `INSERT INTO incident_duplicate_reviews
         (possible_duplicate_id, incident_a_id, incident_b_id, decision,
          primary_incident_id, reason, reviewed_by)
       VALUES ($1, $2, $3, 'confirmed', $4, $5, $6) RETURNING *`,
      [candidate.id, incidentAId, incidentBId, primaryIncidentId, reason || null, operatorId],
    );
    const verifiedResult = await client.query(
      `SELECT decision.decided_at
       FROM incident_assignments assignment
       JOIN completion_reports report ON report.assignment_id = assignment.id
       JOIN completion_review_decisions decision ON decision.completion_report_id = report.id
       WHERE assignment.incident_id = $1 AND decision.decision = 'approved'
       ORDER BY decision.decided_at DESC LIMIT 1`,
      [primaryIncidentId],
    );
    const linkResult = await client.query(
      `INSERT INTO incident_duplicate_links
         (primary_incident_id, duplicate_incident_id, review_id,
          assignment_conflict_acknowledged, linked_by, resolution_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        primaryIncidentId,
        linkedDuplicateId,
        reviewResult.rows[0].id,
        bothAssigned,
        operatorId,
        verifiedResult.rows[0]?.decided_at || null,
      ],
    );
    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'duplicate_confirmed', 'incident', $2, $3::jsonb)`,
      [operatorId, primaryIncidentId, JSON.stringify({ duplicate_incident_id: linkedDuplicateId, review_id: reviewResult.rows[0].id, assignment_conflict_acknowledged: bothAssigned })],
    );
    await client.query('COMMIT');
    return { review: reviewResult.rows[0], link: linkResult.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { canonicalPair, listDuplicateMatches, reviewDuplicate };
