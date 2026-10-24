const crypto = require('crypto');
const db = require('../config/database');
const { AppError } = require('../utils/apiResponse');

function hashTrackingToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createTrackingCredential() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashTrackingToken(token) };
}

function publicProgressMessage(status, submissionMode = 'detailed') {
  if (status === 'pending' && submissionMode === 'quick_sos') {
    return 'Your Quick SOS location has been received and is awaiting operator triage.';
  }
  const messages = {
    pending: 'Your emergency report has been received and is awaiting operator review.',
    assigned: 'A rescue team has been assigned to your incident.',
    in_progress: 'The rescue response is currently in progress.',
    resolved: 'The rescue response has been verified as completed.',
  };
  return messages[status] || 'Your incident status was updated.';
}

function assertTokenShape(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw new AppError(401, 'A valid tracking token is required');
  }
}

// The public view deliberately omits contact numbers, coordinates, descriptions, and operator fields.
async function trackIncident(token, database = db) {
  assertTokenShape(token);
  const tokenHash = hashTrackingToken(token);
  const result = await database.query(
    `WITH matched AS (
       SELECT tracking.id AS tracking_id, incident.id, incident.emergency_type,
              incident.submission_mode,
              CASE WHEN link.resolution_verified_at IS NOT NULL
                THEN 'resolved' ELSE incident.status END AS effective_status,
              incident.created_at,
              CASE WHEN link.resolution_verified_at IS NOT NULL
                THEN GREATEST(incident.updated_at, link.resolution_verified_at)
                ELSE incident.updated_at END AS effective_updated_at
       FROM incident_tracking_tokens tracking
       JOIN incidents incident ON incident.id = tracking.incident_id
       LEFT JOIN incident_duplicate_links link ON link.duplicate_incident_id = incident.id
       WHERE tracking.token_hash = $1
     )
     UPDATE incident_tracking_tokens tracking
     SET last_used_at = CURRENT_TIMESTAMP
     FROM matched
     WHERE tracking.id = matched.tracking_id
     RETURNING matched.id, matched.emergency_type, matched.submission_mode,
               matched.effective_status AS status, matched.created_at,
               matched.effective_updated_at AS updated_at`,
    [tokenHash],
  );
  const incident = result.rows[0];
  if (!incident) throw new AppError(404, 'No incident was found for this tracking token');
  return {
    incident_reference: incident.id,
    emergency_type: incident.emergency_type,
    submission_mode: incident.submission_mode || 'detailed',
    status: incident.status,
    submitted_at: incident.created_at,
    last_updated_at: incident.updated_at,
    progress_messages: [publicProgressMessage(incident.status, incident.submission_mode)],
  };
}

// Lets the holder of a Quick SOS tracking token add an emergency type and/or contact number.
// The victim's type is only applied while the incident still awaits operator triage, so it never
// overrides an operator assessment. Detailed reports and resolved incidents cannot be changed.
async function updateQuickSosDetails(token, details, database = db) {
  assertTokenShape(token);
  const tokenHash = hashTrackingToken(token);
  const emergencyType = details.emergency_type ?? null;
  const contactNumber = details.contact_number ?? null;
  const result = await database.query(
    `UPDATE incidents incident
     SET emergency_type = CASE
           WHEN $2::text IS NOT NULL AND incident.triage_status = 'needs_immediate_triage'
           THEN $2::text ELSE incident.emergency_type END,
         contact_number = COALESCE($3::text, incident.contact_number)
     FROM incident_tracking_tokens tracking
     WHERE tracking.token_hash = $1
       AND tracking.incident_id = incident.id
       AND incident.submission_mode = 'quick_sos'
       AND incident.status <> 'resolved'
     RETURNING incident.id, incident.emergency_type, incident.triage_status,
               (incident.contact_number IS NOT NULL) AS contact_number_provided`,
    [tokenHash, emergencyType, contactNumber],
  );
  const incident = result.rows[0];
  if (!incident) {
    throw new AppError(404, 'No open Quick SOS was found for this tracking token');
  }
  await database.query(
    `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
     VALUES (NULL, 'quick_sos_details_added', 'incident', $1, $2::jsonb)`,
    [incident.id, JSON.stringify({
      emergency_type_submitted: emergencyType !== null,
      contact_number_submitted: contactNumber !== null,
    })],
  );
  return {
    incident_reference: incident.id,
    emergency_type: incident.emergency_type,
    contact_number_provided: incident.contact_number_provided,
    awaiting_operator_triage: incident.triage_status === 'needs_immediate_triage',
  };
}

module.exports = {
  createTrackingCredential,
  hashTrackingToken,
  trackIncident,
  updateQuickSosDetails,
  publicProgressMessage,
};
