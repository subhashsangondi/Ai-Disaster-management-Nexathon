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

function publicProgressMessage(status) {
  const messages = {
    pending: 'Your emergency report has been received and is awaiting operator review.',
    assigned: 'A rescue team has been assigned to your incident.',
    in_progress: 'The rescue response is currently in progress.',
    resolved: 'The rescue response has been verified as completed.',
  };
  return messages[status] || 'Your incident status was updated.';
}

async function trackIncident(token, database = db) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw new AppError(401, 'A valid tracking token is required');
  }
  const tokenHash = hashTrackingToken(token);
  const result = await database.query(
    `UPDATE incident_tracking_tokens tracking
     SET last_used_at = CURRENT_TIMESTAMP
     FROM incidents incident
     WHERE tracking.token_hash = $1 AND incident.id = tracking.incident_id
     RETURNING incident.id, incident.emergency_type, incident.status,
               incident.created_at, incident.updated_at`,
    [tokenHash],
  );
  const incident = result.rows[0];
  if (!incident) throw new AppError(404, 'No incident was found for this tracking token');
  return {
    incident_reference: incident.id,
    emergency_type: incident.emergency_type,
    status: incident.status,
    submitted_at: incident.created_at,
    last_updated_at: incident.updated_at,
    progress_messages: [publicProgressMessage(incident.status)],
  };
}

module.exports = { createTrackingCredential, hashTrackingToken, trackIncident, publicProgressMessage };
