const incidentRepository = require('../repositories/incidentRepository');
const trackingService = require('../services/trackingService');
const { success } = require('../utils/apiResponse');

const UNKNOWN_EMERGENCY_TYPE = 'Unknown';

// Quick SOS has no description or type, so it is never classified automatically: it is stored
// as an unknown emergency that an operator must triage. Severity is not inferred from location.
function incidentDataFor(body) {
  if (body.submission_mode !== 'quick_sos') {
    return { ...body, submission_mode: 'detailed', triage_status: 'not_required' };
  }
  return {
    ...body,
    emergency_type: UNKNOWN_EMERGENCY_TYPE,
    description: null,
    triage_status: 'needs_immediate_triage',
  };
}

async function createSos(req, res) {
  const tracking = trackingService.createTrackingCredential();
  const incident = await incidentRepository.createIncident({
    ...incidentDataFor(req.body),
    reporter_id: req.user?.user_id || null,
    tracking_token_hash: tracking.tokenHash,
  });
  const isQuickSos = incident.submission_mode === 'quick_sos';

  return success(res, {
    statusCode: 201,
    message: isQuickSos
      ? 'Quick SOS location received by RescueGrid AI; awaiting operator triage'
      : 'Emergency report received by RescueGrid AI',
    data: {
      incident_id: incident.id,
      tracking_token: tracking.token,
      status: incident.status,
      submission_mode: incident.submission_mode || 'detailed',
      analysis_status: isQuickSos ? 'not_applicable' : 'pending',
      triage_status: incident.triage_status || 'not_required',
      notice: 'This report is stored in RescueGrid AI and is not confirmation of delivery to official emergency services.',
    },
  });
}

module.exports = { createSos, incidentDataFor, UNKNOWN_EMERGENCY_TYPE };
