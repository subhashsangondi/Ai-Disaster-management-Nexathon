const responseService = require('../services/responseService');
const { success } = require('../utils/apiResponse');

async function listAssignments(req, res) {
  const assignments = await responseService.getResponderAssignments(req.user.user_id);
  return success(res, { data: { assignments } });
}

async function listNotifications(req, res) {
  const notifications = await responseService.getResponderNotifications(req.user.user_id);
  return success(res, { data: { notifications } });
}

async function markNotificationRead(req, res) {
  const notification = await responseService.markNotificationRead({
    notificationId: req.params.id,
    userId: req.user.user_id,
  });
  return success(res, { message: 'Notification marked as read', data: notification });
}

async function acknowledge(req, res) {
  const assignment = await responseService.acknowledgeAssignment({
    assignmentId: req.params.id,
    userId: req.user.user_id,
  });
  return success(res, { message: 'Assignment acknowledged', data: assignment });
}

async function addProgress(req, res) {
  const event = await responseService.addProgress({
    assignmentId: req.params.id,
    userId: req.user.user_id,
    progressStatus: req.body.progress_status,
    notes: req.body.notes,
  });
  return success(res, { statusCode: 201, message: 'Progress update recorded', data: event });
}

async function submitCompletion(req, res) {
  const report = await responseService.submitCompletion({
    assignmentId: req.params.id,
    userId: req.user.user_id,
    summary: req.body.completion_summary,
    peopleAssisted: req.body.people_assisted,
  });
  return success(res, { statusCode: 201, message: 'Completion report submitted for operator review', data: report });
}

module.exports = { listAssignments, listNotifications, markNotificationRead, acknowledge, addProgress, submitCompletion };
