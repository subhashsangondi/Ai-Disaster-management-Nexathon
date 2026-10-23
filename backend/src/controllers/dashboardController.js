const incidentRepository = require('../repositories/incidentRepository');
const { success } = require('../utils/apiResponse');

async function stats(_req, res) {
  const data = await incidentRepository.getDashboardStats();
  return success(res, { data });
}

module.exports = { stats };
