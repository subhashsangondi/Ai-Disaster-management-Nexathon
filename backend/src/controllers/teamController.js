const teamRepository = require('../repositories/teamRepository');
const { success } = require('../utils/apiResponse');

async function listTeams(req, res) {
  const teams = await teamRepository.listTeams({ availability: req.query.availability });
  return success(res, { data: { teams } });
}

module.exports = { listTeams };
