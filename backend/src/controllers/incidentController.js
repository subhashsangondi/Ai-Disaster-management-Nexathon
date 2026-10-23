const incidentRepository = require('../repositories/incidentRepository');
const aiService = require('../services/aiService');
const duplicateService = require('../services/duplicateService');
const assignmentService = require('../services/assignmentService');
const { AppError, success } = require('../utils/apiResponse');

async function listIncidents(req, res) {
  const result = await incidentRepository.listIncidents(req.query);
  return success(res, { data: result });
}

async function getIncident(req, res) {
  const incident = await incidentRepository.getIncidentById(req.params.id);
  if (!incident) throw new AppError(404, 'Incident not found');
  return success(res, { data: incident });
}

async function analyze(req, res) {
  const incident = await incidentRepository.getIncidentById(req.params.id);
  if (!incident) throw new AppError(404, 'Incident not found');

  const analysis = await aiService.analyzeIncident(incident);
  const storedAnalysis = await incidentRepository.saveAnalysis(incident.id, analysis);
  const duplicates = await duplicateService.findPossibleDuplicates(incident);
  if (duplicates.length) await incidentRepository.savePossibleDuplicates(incident.id, duplicates);

  return success(res, {
    message: 'Advisory AI analysis completed; human review remains required',
    data: { analysis: storedAnalysis, possible_duplicates: duplicates },
  });
}

async function getAnalysis(req, res) {
  const analysis = await incidentRepository.getAnalysis(req.params.id);
  if (!analysis) {
    const incident = await incidentRepository.getIncidentById(req.params.id);
    if (!incident) throw new AppError(404, 'Incident not found');
    throw new AppError(404, 'No analysis found for this incident');
  }
  return success(res, { data: analysis });
}

async function assign(req, res) {
  const result = await assignmentService.assignTeam({
    incidentId: req.params.id,
    teamId: req.body.team_id,
    assignedBy: req.user.user_id,
  });
  return success(res, { message: 'Rescue team assigned', data: result });
}

async function updateStatus(req, res) {
  const incident = await assignmentService.updateIncidentStatus({
    incidentId: req.params.id,
    status: req.body.status,
  });
  return success(res, { message: 'Incident status updated', data: incident });
}

module.exports = { listIncidents, getIncident, analyze, getAnalysis, assign, updateStatus };
