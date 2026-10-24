const db = require('../config/database');
const { AppError } = require('../utils/apiResponse');

const nextProgress = {
  acknowledged: 'en_route',
  en_route: 'arrived',
  arrived: 'rescue_in_progress',
};

async function getResponderAssignments(userId, database = db) {
  const result = await database.query(
    `SELECT assignment.id, assignment.incident_id, assignment.team_id,
            assignment.assigned_at, assignment.progress_status,
            assignment.acknowledged_at,
            incident.emergency_type, incident.description, incident.latitude,
            incident.longitude, incident.location_text, incident.status AS incident_status,
            team.team_name,
            CASE WHEN analysis.id IS NULL THEN NULL ELSE analysis.urgency END AS urgency,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', event.id, 'progress_status', event.progress_status,
                'notes', event.notes, 'created_at', event.created_at
              ) ORDER BY event.created_at)
              FROM assignment_progress_events event
              WHERE event.assignment_id = assignment.id
            ), '[]'::json) AS progress_history,
            CASE WHEN report.id IS NULL THEN NULL ELSE json_build_object(
              'id', report.id, 'completion_summary', report.completion_summary,
              'people_assisted', report.people_assisted, 'submitted_at', report.submitted_at,
              'review_status', report.review_status, 'review_reason', decision.reason
            ) END AS latest_completion
     FROM team_memberships membership
     JOIN incident_assignments assignment ON assignment.team_id = membership.team_id
     JOIN incidents incident ON incident.id = assignment.incident_id
     JOIN rescue_teams team ON team.id = assignment.team_id
     LEFT JOIN LATERAL (
       SELECT id, urgency FROM ai_analyses WHERE incident_id = incident.id
       ORDER BY analyzed_at DESC LIMIT 1
     ) analysis ON true
     LEFT JOIN LATERAL (
       SELECT * FROM completion_reports WHERE assignment_id = assignment.id
       ORDER BY submitted_at DESC LIMIT 1
     ) report ON true
     LEFT JOIN completion_review_decisions decision ON decision.completion_report_id = report.id
     WHERE membership.user_id = $1 AND incident.status <> 'resolved'
     ORDER BY assignment.assigned_at DESC`,
    [userId],
  );
  return result.rows;
}

async function getResponderNotifications(userId, database = db) {
  const result = await database.query(
    `SELECT notification.id, notification.assignment_id, notification.created_at,
            notification.read_at, notification.acknowledged_at,
            incident.id AS incident_id, incident.emergency_type, incident.location_text,
            COALESCE(analysis.urgency, 'unknown') AS urgency,
            team.team_name
     FROM team_memberships membership
     JOIN assignment_notifications notification ON notification.team_id = membership.team_id
     JOIN incident_assignments assignment ON assignment.id = notification.assignment_id
     JOIN incidents incident ON incident.id = assignment.incident_id
     JOIN rescue_teams team ON team.id = assignment.team_id
     LEFT JOIN LATERAL (
       SELECT urgency FROM ai_analyses WHERE incident_id = incident.id
       ORDER BY analyzed_at DESC LIMIT 1
     ) analysis ON true
     WHERE membership.user_id = $1
     ORDER BY notification.created_at DESC`,
    [userId],
  );
  return result.rows;
}

async function markNotificationRead({ notificationId, userId }, database = db) {
  const result = await database.query(
    `UPDATE assignment_notifications notification
     SET read_by = COALESCE(notification.read_by, $2),
         read_at = COALESCE(notification.read_at, CURRENT_TIMESTAMP)
     FROM team_memberships membership
     WHERE notification.id = $1 AND membership.user_id = $2
       AND membership.team_id = notification.team_id
     RETURNING notification.*`,
    [notificationId, userId],
  );
  if (!result.rows[0]) throw new AppError(404, 'Notification not found');
  return result.rows[0];
}

async function lockScopedAssignment(client, assignmentId, userId) {
  const result = await client.query(
    `SELECT assignment.*, incident.status AS incident_status
     FROM incident_assignments assignment
     JOIN team_memberships membership ON membership.team_id = assignment.team_id
     JOIN incidents incident ON incident.id = assignment.incident_id
     WHERE assignment.id = $1 AND membership.user_id = $2
     FOR UPDATE OF assignment`,
    [assignmentId, userId],
  );
  if (!result.rows[0]) throw new AppError(404, 'Assignment not found');
  return result.rows[0];
}

async function acknowledgeAssignment({ assignmentId, userId }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await lockScopedAssignment(client, assignmentId, userId);
    if (assignment.progress_status !== 'assigned' && assignment.progress_status !== 'acknowledged') {
      throw new AppError(409, 'Assignment can no longer be acknowledged');
    }
    if (assignment.progress_status === 'assigned') {
      await client.query(
        `UPDATE incident_assignments SET progress_status = 'acknowledged',
           acknowledged_by = $2, acknowledged_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [assignmentId, userId],
      );
      await client.query(
        `INSERT INTO assignment_progress_events (assignment_id, progress_status, reported_by)
         VALUES ($1, 'acknowledged', $2)`,
        [assignmentId, userId],
      );
    }
    const notification = await client.query(
      `UPDATE assignment_notifications SET
         read_by = COALESCE(read_by, $2), read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
         acknowledged_by = COALESCE(acknowledged_by, $2),
         acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
       WHERE assignment_id = $1 RETURNING *`,
      [assignmentId, userId],
    );
    await client.query('COMMIT');
    return { ...assignment, progress_status: 'acknowledged', notification: notification.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addProgress({ assignmentId, userId, progressStatus, notes }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await lockScopedAssignment(client, assignmentId, userId);
    if (nextProgress[assignment.progress_status] !== progressStatus) {
      throw new AppError(409, `Cannot transition assignment from ${assignment.progress_status} to ${progressStatus}`);
    }
    const event = await client.query(
      `INSERT INTO assignment_progress_events
         (assignment_id, progress_status, notes, reported_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [assignmentId, progressStatus, notes || null, userId],
    );
    await client.query(
      'UPDATE incident_assignments SET progress_status = $2 WHERE id = $1',
      [assignmentId, progressStatus],
    );
    if (progressStatus === 'rescue_in_progress' && assignment.incident_status === 'assigned') {
      await client.query(
        "UPDATE incidents SET status = 'in_progress' WHERE id = $1",
        [assignment.incident_id],
      );
    }
    await client.query('COMMIT');
    return event.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function submitCompletion({ assignmentId, userId, summary, peopleAssisted }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await lockScopedAssignment(client, assignmentId, userId);
    if (assignment.progress_status !== 'rescue_in_progress') {
      throw new AppError(409, 'Completion can only be requested while rescue is in progress');
    }
    const report = await client.query(
      `INSERT INTO completion_reports
         (assignment_id, completion_summary, people_assisted, submitted_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [assignmentId, summary, peopleAssisted ?? null, userId],
    );
    await client.query(
      "UPDATE incident_assignments SET progress_status = 'completion_requested' WHERE id = $1",
      [assignmentId],
    );
    await client.query(
      `INSERT INTO assignment_progress_events
         (assignment_id, progress_status, notes, reported_by)
       VALUES ($1, 'completion_requested', $2, $3)`,
      [assignmentId, 'Completion report submitted for operator review.', userId],
    );
    await client.query('COMMIT');
    return report.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new AppError(409, 'A completion report is already awaiting review');
    throw error;
  } finally {
    client.release();
  }
}

async function getIncidentProgress(incidentId, database = db) {
  const result = await database.query(
    `SELECT event.id, event.assignment_id, event.progress_status, event.notes,
            event.created_at, reporter.id AS reported_by_id, reporter.name AS reported_by_name
     FROM incident_assignments assignment
     JOIN assignment_progress_events event ON event.assignment_id = assignment.id
     JOIN users reporter ON reporter.id = event.reported_by
     WHERE assignment.incident_id = $1 ORDER BY event.created_at`,
    [incidentId],
  );
  return result.rows;
}

async function getIncidentCompletion(incidentId, database = db) {
  const result = await database.query(
    `SELECT report.id, report.assignment_id, report.completion_summary,
            report.people_assisted, report.submitted_at, report.review_status,
            submitter.id AS submitted_by_id, submitter.name AS submitted_by_name,
            decision.decision, decision.reason, decision.decided_at,
            reviewer.id AS decided_by_id, reviewer.name AS decided_by_name
     FROM incident_assignments assignment
     JOIN completion_reports report ON report.assignment_id = assignment.id
     JOIN users submitter ON submitter.id = report.submitted_by
     LEFT JOIN completion_review_decisions decision ON decision.completion_report_id = report.id
     LEFT JOIN users reviewer ON reviewer.id = decision.decided_by
     WHERE assignment.incident_id = $1 ORDER BY report.submitted_at DESC`,
    [incidentId],
  );
  return result.rows;
}

async function reviewCompletion({ incidentId, operatorId, decision, reason = null }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT incident.id AS incident_id, incident.status AS incident_status,
              assignment.id AS assignment_id, assignment.team_id, assignment.progress_status,
              report.id AS report_id, report.review_status
       FROM incidents incident
       JOIN incident_assignments assignment ON assignment.incident_id = incident.id
       JOIN completion_reports report ON report.id = (
         SELECT candidate.id FROM completion_reports candidate
         WHERE candidate.assignment_id = assignment.id
         ORDER BY candidate.submitted_at DESC LIMIT 1
       )
       WHERE incident.id = $1 FOR UPDATE OF incident, assignment, report`,
      [incidentId],
    );
    const item = result.rows[0];
    if (!item) throw new AppError(404, 'Completion report not found');
    if (item.review_status !== 'pending') {
      if (item.review_status === decision) {
        await client.query('COMMIT');
        return { decision, incident_status: item.incident_status, idempotent: true };
      }
      throw new AppError(409, 'Completion report was already reviewed');
    }
    await client.query(
      'UPDATE completion_reports SET review_status = $2 WHERE id = $1',
      [item.report_id, decision],
    );
    const decisionResult = await client.query(
      `INSERT INTO completion_review_decisions
         (completion_report_id, decision, reason, decided_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [item.report_id, decision, reason, operatorId],
    );
    if (decision === 'approved') {
      await client.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP,
           resolved_by = $2 WHERE id = $1`,
        [incidentId, operatorId],
      );
      await client.query(
        `UPDATE incident_duplicate_links
         SET resolution_verified_at = COALESCE(resolution_verified_at, CURRENT_TIMESTAMP)
         WHERE primary_incident_id = $1`,
        [incidentId],
      );
      await client.query(
        `UPDATE rescue_teams team SET availability = 'available'
         WHERE team.id = $1 AND NOT EXISTS (
           SELECT 1 FROM incidents active
           WHERE active.assigned_team_id = team.id AND active.id <> $2
             AND active.status <> 'resolved'
         )`,
        [item.team_id, incidentId],
      );
    } else {
      await client.query(
        "UPDATE incident_assignments SET progress_status = 'rescue_in_progress' WHERE id = $1",
        [item.assignment_id],
      );
    }
    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'incident', $3, $4::jsonb)`,
      [operatorId, `completion_${decision}`, incidentId, JSON.stringify({ report_id: item.report_id, reason })],
    );
    await client.query('COMMIT');
    return { ...decisionResult.rows[0], incident_status: decision === 'approved' ? 'resolved' : item.incident_status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  nextProgress,
  getResponderAssignments,
  getResponderNotifications,
  markNotificationRead,
  acknowledgeAssignment,
  addProgress,
  submitCompletion,
  getIncidentProgress,
  getIncidentCompletion,
  reviewCompletion,
};
