const db = require('../config/database');
const { AppError } = require('../utils/apiResponse');

async function assignTeam({ incidentId, teamId, assignedBy }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const incidentResult = await client.query(
      'SELECT id, status, assigned_team_id FROM incidents WHERE id = $1 FOR UPDATE',
      [incidentId],
    );
    const incident = incidentResult.rows[0];
    if (!incident) throw new AppError(404, 'Incident not found');
    if (incident.assigned_team_id || incident.status !== 'pending') {
      throw new AppError(409, 'Incident already has an assignment or is not pending');
    }

    const duplicateLinkResult = await client.query(
      `SELECT link.primary_incident_id, link.duplicate_incident_id,
              EXISTS (
                SELECT 1 FROM incident_assignments linked_assignment
                WHERE linked_assignment.incident_id = link.duplicate_incident_id
              ) AS duplicate_has_assignment
       FROM incident_duplicate_links link
       WHERE link.primary_incident_id = $1 OR link.duplicate_incident_id = $1
       FOR SHARE OF link`,
      [incidentId],
    );
    if (duplicateLinkResult.rows.some((link) => link.duplicate_incident_id === incidentId)) {
      throw new AppError(409, 'Linked duplicate incidents are handled through their primary incident and cannot receive a new assignment');
    }
    if (duplicateLinkResult.rows.some((link) => link.duplicate_has_assignment)) {
      throw new AppError(409, 'A linked incident already has an assignment; operator conflict handling is required');
    }

    const teamResult = await client.query(
      'SELECT id, team_name, availability FROM rescue_teams WHERE id = $1 FOR UPDATE',
      [teamId],
    );
    const team = teamResult.rows[0];
    if (!team) throw new AppError(404, 'Rescue team not found');
    if (team.availability !== 'available') throw new AppError(409, 'Rescue team is not available');

    const assignmentResult = await client.query(
      `INSERT INTO incident_assignments (incident_id, team_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [incidentId, teamId, assignedBy],
    );
    const notificationResult = await client.query(
      `INSERT INTO assignment_notifications (assignment_id, team_id)
       VALUES ($1, $2) RETURNING *`,
      [assignmentResult.rows[0].id, teamId],
    );
    await client.query(
      `UPDATE incidents SET assigned_team_id = $1, status = 'assigned', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [teamId, incidentId],
    );
    await client.query("UPDATE rescue_teams SET availability = 'busy' WHERE id = $1", [teamId]);
    await client.query('COMMIT');

    return {
      assignment: assignmentResult.rows[0],
      notification: notificationResult.rows[0],
      team: { ...team, availability: 'busy' },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new AppError(409, 'Incident already has an assignment');
    throw error;
  } finally {
    client.release();
  }
}

const allowedTransitions = {
  pending: [],
  assigned: ['in_progress'],
  in_progress: ['resolved'],
  resolved: [],
};

async function updateIncidentStatus({ incidentId, status, updatedBy = null }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id, status, assigned_team_id FROM incidents WHERE id = $1 FOR UPDATE',
      [incidentId],
    );
    const incident = result.rows[0];
    if (!incident) throw new AppError(404, 'Incident not found');
    if (!allowedTransitions[incident.status]?.includes(status)) {
      throw new AppError(409, `Cannot transition incident from ${incident.status} to ${status}`);
    }


    const updatedResult = await client.query(
  `UPDATE incidents
   SET
     status = $1::varchar,
     updated_at = CURRENT_TIMESTAMP,
     resolved_at = CASE
       WHEN $1::varchar = 'resolved'
       THEN CURRENT_TIMESTAMP
       ELSE resolved_at
     END,
     resolved_by = CASE
       WHEN $1::varchar = 'resolved'
       THEN $3::uuid
       ELSE resolved_by
     END
   WHERE id = $2::uuid
   RETURNING *`,
  [status, incidentId, updatedBy],
);
    if (status === 'resolved' && incident.assigned_team_id) {
      await client.query(
        `UPDATE rescue_teams team SET availability = 'available'
         WHERE team.id = $1 AND NOT EXISTS (
           SELECT 1 FROM incidents active
           WHERE active.assigned_team_id = team.id AND active.status <> 'resolved'
         )`,
        [incident.assigned_team_id],
      );
    }
    await client.query('COMMIT');
    return updatedResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { assignTeam, updateIncidentStatus, allowedTransitions };
