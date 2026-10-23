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

const router = express.Router();
router.use(authenticate, authorize('operator', 'admin'));

router.get('/', validateRequest(incidentFiltersSchema, 'query'), controller.listIncidents);
router.get('/:id', validateRequest(uuidParamsSchema, 'params'), controller.getIncident);
router.post('/:id/analyze', validateRequest(uuidParamsSchema, 'params'), controller.analyze);
router.get('/:id/analysis', validateRequest(uuidParamsSchema, 'params'), controller.getAnalysis);
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
