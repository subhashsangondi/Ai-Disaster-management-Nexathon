const trackingService = require('../services/trackingService');
const { success } = require('../utils/apiResponse');

async function trackIncident(req, res) {
  const incident = await trackingService.trackIncident(req.get('x-incident-tracking-token'));
  return success(res, { data: incident });
}

async function addQuickSosDetails(req, res) {
  const result = await trackingService.updateQuickSosDetails(req.get('x-incident-tracking-token'), req.body);
  return success(res, { message: 'Thank you. Your details were added to your SOS.', data: result });
}

module.exports = { trackIncident, addQuickSosDetails };
