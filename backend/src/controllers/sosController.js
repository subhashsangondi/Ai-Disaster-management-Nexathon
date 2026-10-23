const incidentRepository = require('../repositories/incidentRepository');
const { success } = require('../utils/apiResponse');

async function createSos(req, res) {
  const incident = await incidentRepository.createIncident({
    ...req.body,
    reporter_id: req.user?.user_id || null,
  });

  return success(res, {
    statusCode: 201,
    message: 'Emergency report received by RescueGrid AI',
    data: {
      incident_id: incident.id,
      status: incident.status,
      analysis_status: 'pending',
      notice: 'This report is stored in RescueGrid AI and is not confirmation of delivery to official emergency services.',
    },
  });
}

module.exports = { createSos };
