const express = require('express');
const controller = require('../controllers/incidentController');
const validateRequest = require('../middleware/validateRequest');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  uuidParamsSchema,
  incidentFiltersSchema,
  assignmentSchema,
  statusSchema,
} = require('../validators/incidentValidator');
const { rejectionSchema } = require('../validators/responseValidator');
const { duplicateParamsSchema, duplicateReviewSchema } = require('../validators/duplicateValidator');

const router = express.Router();
router.use(authenticate, authorize('operator', 'admin'));

router.get('/', validateRequest(incidentFiltersSchema, 'query'), controller.listIncidents);
router.get('/:id', validateRequest(uuidParamsSchema, 'params'), controller.getIncident);
router.post('/:id/analyze', validateRequest(uuidParamsSchema, 'params'), controller.analyze);
router.get('/:id/analysis', validateRequest(uuidParamsSchema, 'params'), controller.getAnalysis);
router.get(
  '/:id/team-recommendations',
  validateRequest(uuidParamsSchema, 'params'),
  controller.getTeamRecommendations,
);
router.get('/:id/duplicates', validateRequest(uuidParamsSchema, 'params'), controller.getDuplicates);
router.post(
  '/:id/duplicates/:duplicateId/review',
  validateRequest(duplicateParamsSchema, 'params'),
  validateRequest(duplicateReviewSchema),
  controller.reviewDuplicate,
);
router.get('/:id/progress', validateRequest(uuidParamsSchema, 'params'), controller.getProgress);
router.get('/:id/completion', validateRequest(uuidParamsSchema, 'params'), controller.getCompletion);
router.post(
  '/:id/completion/approve',
  validateRequest(uuidParamsSchema, 'params'),
  controller.approveCompletion,
);
router.post(
  '/:id/completion/reject',
  validateRequest(uuidParamsSchema, 'params'),
  validateRequest(rejectionSchema),
  controller.rejectCompletion,
);
router.patch(
  '/:id/assign',
  validateRequest(uuidParamsSchema, 'params'),
  validateRequest(assignmentSchema),
  controller.assign,
);
router.patch(
  '/:id/status',
  validateRequest(uuidParamsSchema, 'params'),
  validateRequest(statusSchema),
  controller.updateStatus,
);

module.exports = router;
