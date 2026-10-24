const express = require('express');
const controller = require('../controllers/teamController');
const validateRequest = require('../middleware/validateRequest');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  teamIdParamsSchema,
  availabilityQuerySchema,
  createTeamSchema,
  updateTeamSchema,
} = require('../validators/teamValidator');

const router = express.Router();

router.get(
  '/',
  authenticate,
  authorize('operator', 'admin'),
  validateRequest(availabilityQuerySchema, 'query'),
  controller.listTeams,
);
router.post(
  '/',
  authenticate,
  authorize('admin'),
  validateRequest(createTeamSchema),
  controller.createTeam,
);
router.get(
  '/:id',
  authenticate,
  authorize('operator', 'admin'),
  validateRequest(teamIdParamsSchema, 'params'),
  controller.getTeam,
);
router.patch(
  '/:id',
  authenticate,
  authorize('admin'),
  validateRequest(teamIdParamsSchema, 'params'),
  validateRequest(updateTeamSchema),
  controller.updateTeam,
);

module.exports = router;
