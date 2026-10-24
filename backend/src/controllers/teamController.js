const teamRepository = require('../repositories/teamRepository');
const teamService = require('../services/teamService');
const { AppError, success } = require('../utils/apiResponse');

async function listTeams(req, res) {
  const teams = await teamRepository.listTeams({ availability: req.query.availability });
  return success(res, { data: { teams } });
}

async function getTeam(req, res) {
  const team = await teamRepository.findById(req.params.id);
  if (!team) throw new AppError(404, 'Rescue team not found');
  return success(res, { data: team });
}

async function createTeam(req, res) {
  const team = await teamService.createTeam({ data: req.body, actorId: req.user.user_id });
  return success(res, { statusCode: 201, message: 'Rescue team registered', data: team });
}

async function updateTeam(req, res) {
  const team = await teamService.updateTeam({
    teamId: req.params.id,
    data: req.body,
    actorId: req.user.user_id,
  });
  return success(res, { message: 'Rescue team updated', data: team });
}

module.exports = { listTeams, getTeam, createTeam, updateTeam };
