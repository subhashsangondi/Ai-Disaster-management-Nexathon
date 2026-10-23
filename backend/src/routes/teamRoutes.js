const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/teamController');
const validateRequest = require('../middleware/validateRequest');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
const querySchema = z.object({ availability: z.enum(['available', 'busy', 'offline']).optional() });

router.get(
  '/',
  authenticate,
  authorize('operator', 'admin'),
  validateRequest(querySchema, 'query'),
  controller.listTeams,
);

module.exports = router;
