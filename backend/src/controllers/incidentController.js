const incidentRepository = require('../repositories/incidentRepository');
const aiService = require('../services/aiService');
const duplicateService = require('../services/duplicateService');
const assignmentService = require('../services/assignmentService');
const responseService = require('../services/responseService');
const duplicateReviewService = require('../services/duplicateReviewService');
const teamRecommendationService = require('../services/teamRecommendationService');
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
  // Location-only Quick SOS reports have nothing for the AI to classify; operators triage them.
  if (!incident.description?.trim()) {
    throw new AppError(
      422,
      'This Quick SOS has no description to analyze; assess it manually with operator triage',
      undefined,
      'ANALYSIS_REQUIRES_DESCRIPTION',
    );
  }

  const analysisResult = await aiService.analyzeIncident(incident);
  const storedAnalysis = await incidentRepository.saveAnalysis(incident.id, analysisResult.analysis);
  const duplicates = await duplicateService.findPossibleDuplicates(incident);
  const storedDuplicates = duplicates.length
    ? await incidentRepository.savePossibleDuplicates(incident.id, duplicates)
    : [];

  return success(res, {
    message: 'Advisory AI analysis completed; human review remains required',
    data: {
      analysis: storedAnalysis,
      possible_duplicates: storedDuplicates,
      provider_metadata: analysisResult.provider_metadata,
    },
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
    updatedBy: req.user.user_id,
  });
  return success(res, { message: 'Incident status updated', data: incident });
}

async function getProgress(req, res) {
  const events = await responseService.getIncidentProgress(req.params.id);
  return success(res, { data: { events } });
}

async function getCompletion(req, res) {
  const reports = await responseService.getIncidentCompletion(req.params.id);
  return success(res, { data: { reports, evidence_photos_supported: false } });
}

async function approveCompletion(req, res) {
  const decision = await responseService.reviewCompletion({
    incidentId: req.params.id,
    operatorId: req.user.user_id,
    decision: 'approved',
  });
  return success(res, { message: 'Completion approved and incident resolved', data: decision });
}

async function rejectCompletion(req, res) {
  const decision = await responseService.reviewCompletion({
    incidentId: req.params.id,
    operatorId: req.user.user_id,
    decision: 'rejected',
    reason: req.body.reason,
  });
  return success(res, { message: 'Completion rejected; response remains active', data: decision });
}

async function getDuplicates(req, res) {
  const duplicates = await duplicateReviewService.listDuplicateMatches(req.params.id);
  return success(res, { data: duplicates });
}

async function reviewDuplicate(req, res) {
  const result = await duplicateReviewService.reviewDuplicate({
    incidentId: req.params.id,
    duplicateIncidentId: req.params.duplicateId,
    decision: req.body.decision,
    primaryIncidentId: req.body.primary_incident_id,
    reason: req.body.reason,
    assignmentConflictAcknowledged: req.body.assignment_conflict_acknowledged,
    operatorId: req.user.user_id,
  });
  return success(res, {
    message: req.body.decision === 'confirmed'
      ? 'Duplicate incidents linked after operator review'
      : 'Potential duplicate rejected by operator',
    data: result,
  });
}

async function triage(req, res) {
  const result = await incidentRepository.triageIncident({
    incidentId: req.params.id,
    emergencyType: req.body.emergency_type,
    severity: req.body.severity,
    operatorId: req.user.user_id,
  });
  if (!result) throw new AppError(404, 'Incident not found');
  return success(res, { message: 'Incident triage recorded', data: result });
}

async function getTeamRecommendations(req, res) {
  const result = await teamRecommendationService.getTeamRecommendations(req.params.id);
  return success(res, { data: result });
}

module.exports = {
  listIncidents,
  getIncident,
  analyze,
  getAnalysis,
  assign,
  updateStatus,
  getProgress,
  getCompletion,
  approveCompletion,
  rejectCompletion,
  getDuplicates,
  reviewDuplicate,
  getTeamRecommendations,
  triage,
};
