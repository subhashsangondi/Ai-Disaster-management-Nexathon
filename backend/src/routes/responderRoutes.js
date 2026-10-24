const express = require('express');
const controller = require('../controllers/responderController');
const validateRequest = require('../middleware/validateRequest');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  uuidParamsSchema,
  progressSchema,
  completionSchema,
} = require('../validators/responseValidator');

const router = express.Router();
router.use(authenticate, authorize('responder'));

router.get('/assignments', controller.listAssignments);
router.get('/notifications', controller.listNotifications);
router.patch('/notifications/:id/read', validateRequest(uuidParamsSchema, 'params'), controller.markNotificationRead);
router.post('/assignments/:id/acknowledge', validateRequest(uuidParamsSchema, 'params'), controller.acknowledge);
router.post('/assignments/:id/progress', validateRequest(uuidParamsSchema, 'params'), validateRequest(progressSchema), controller.addProgress);
router.post('/assignments/:id/completion', validateRequest(uuidParamsSchema, 'params'), validateRequest(completionSchema), controller.submitCompletion);

module.exports = router;
