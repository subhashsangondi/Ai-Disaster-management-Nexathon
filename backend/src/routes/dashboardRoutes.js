const express = require('express');
const controller = require('../controllers/dashboardController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/stats', authenticate, authorize('operator', 'admin'), controller.stats);

module.exports = router;
