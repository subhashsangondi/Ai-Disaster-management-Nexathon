const trackingService = require('../services/trackingService');
const { success } = require('../utils/apiResponse');

async function trackIncident(req, res) {
  const incident = await trackingService.trackIncident(req.get('x-incident-tracking-token'));
  return success(res, { data: incident });
}

module.exports = { trackIncident };
